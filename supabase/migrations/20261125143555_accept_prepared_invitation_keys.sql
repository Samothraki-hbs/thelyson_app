-- Orélien — Jalon 3.6-bis.3
-- Attribution atomique des clés préparées lors de l'acceptation d'une invitation.
-- À exécuter UNIQUEMENT dans Supabase Development, via SQL Editor.
--
-- Pré-requis :
--   public.pending_invitation_keys (3.6-bis.1)
--   public.create_prepared_project_invitation (3.6-bis.2)
--
-- Ce script remplace une fonction EXISTANTE. Il ne touche pas aux buckets.

BEGIN;

CREATE OR REPLACE FUNCTION public.respond_to_project_invitation (
  p_invitation_id uuid,
  p_invitee_id    text,
  p_accept        boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invitation public.project_invitations%ROWTYPE;
  v_project public.projects%ROWTYPE;
  v_expected_role text;
  v_inviter_role text;
  v_actual_role text;
  v_total_versions integer;
  v_prepared_keys integer;
  v_inserted_keys integer;
BEGIN
  -- 1. Vérifier les paramètres.
  IF p_invitation_id IS NULL
     OR p_invitee_id IS NULL
     OR btrim(p_invitee_id) = ''
     OR p_accept IS NULL
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Paramètres invalides.'
    );
  END IF;

  -- 2. Verrouiller l'invitation pour empêcher deux réponses concurrentes.
  SELECT *
    INTO v_invitation
  FROM public.project_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Invitation introuvable.'
    );
  END IF;

  IF v_invitation.invitee_id IS DISTINCT FROM p_invitee_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Vous ne pouvez pas répondre à cette invitation.'
    );
  END IF;

  IF v_invitation.status <> 'pending' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Cette invitation a déjà été traitée.'
    );
  END IF;

  -- 3. Expiration : ne jamais activer les clés.
  IF v_invitation.expires_at <= now() THEN
    UPDATE public.project_invitations
    SET status = 'expired', responded_at = now()
    WHERE id = p_invitation_id;

    DELETE FROM public.pending_invitation_keys
    WHERE invitation_id = p_invitation_id;

    RETURN jsonb_build_object(
      'success', false,
      'message', 'Cette invitation a expiré.'
    );
  END IF;

  -- 4. Refus : supprimer les enveloppes en attente.
  IF p_accept = false THEN
    UPDATE public.project_invitations
    SET status = 'declined', responded_at = now()
    WHERE id = p_invitation_id;

    DELETE FROM public.pending_invitation_keys
    WHERE invitation_id = p_invitation_id;

    RETURN jsonb_build_object(
      'success', true,
      'message', 'Invitation refusée.'
    );
  END IF;

  -- 5. Acceptation : verrouiller le projet.
  SELECT *
    INTO v_project
  FROM public.projects
  WHERE id = v_invitation.project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Le projet n’existe plus.'
    );
  END IF;

  -- 6. Vérifier que l'expéditeur contrôle encore le projet
  -- et que la place du destinataire est disponible.
  IF v_project.author_id = v_invitation.inviter_id
     AND v_project.publisher_id IS NULL
  THEN
    v_expected_role := 'Editeur';
    v_inviter_role := 'Auteur';

  ELSIF v_project.publisher_id = v_invitation.inviter_id
     AND v_project.author_id IS NULL
  THEN
    v_expected_role := 'Auteur';
    v_inviter_role := 'Editeur';

  ELSE
    UPDATE public.project_invitations
    SET status = 'cancelled', responded_at = now()
    WHERE id = p_invitation_id;

    DELETE FROM public.pending_invitation_keys
    WHERE invitation_id = p_invitation_id;

    RETURN jsonb_build_object(
      'success', false,
      'message', 'Cette collaboration n’est plus disponible.'
    );
  END IF;

  -- 7. Vérifier à nouveau les rôles des deux parties.
  SELECT role INTO v_actual_role
  FROM public.profiles
  WHERE id = v_invitation.inviter_id;

  IF v_actual_role IS DISTINCT FROM v_inviter_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Le rôle de l’expéditeur n’est plus valide.'
    );
  END IF;

  SELECT role INTO v_actual_role
  FROM public.profiles
  WHERE id = p_invitee_id;

  IF v_actual_role IS DISTINCT FROM v_expected_role THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Votre rôle ne correspond pas à cette invitation.'
    );
  END IF;

  -- 8. Vérifier que toutes les versions ACTUELLES sont prises en charge,
  -- et qu'aucune version ne manque dans les clés préparées.
  SELECT count(*) INTO v_total_versions
  FROM public.versions
  WHERE project_id = v_project.id;

  SELECT count(*) INTO v_prepared_keys
  FROM public.pending_invitation_keys
  WHERE invitation_id = p_invitation_id;

  IF v_total_versions > 500
     OR v_total_versions <> v_prepared_keys
     OR EXISTS (
       SELECT 1
       FROM public.versions v
       WHERE v.project_id = v_project.id
         AND (
           v.encryption_version IS DISTINCT FROM 1
           OR NOT EXISTS (
             SELECT 1
             FROM public.pending_invitation_keys pik
             WHERE pik.invitation_id = p_invitation_id
               AND pik.version_id = v.id
           )
         )
     )
     OR EXISTS (
       SELECT 1
       FROM public.pending_invitation_keys pik
       LEFT JOIN public.versions v
         ON v.id = pik.version_id
       WHERE pik.invitation_id = p_invitation_id
         AND (
           v.id IS NULL
           OR v.project_id IS DISTINCT FROM v_project.id
           OR v.encryption_version IS DISTINCT FROM 1
           OR NOT EXISTS (
             SELECT 1
             FROM public.version_access_keys sender_key
             WHERE sender_key.version_id = pik.version_id
               AND sender_key.user_id = v_invitation.inviter_id
           )
         )
     )
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'message',
      'Les clés de partage ne couvrent pas toutes les versions du projet. Contactez l’expéditeur avant d’accepter.'
    );
  END IF;

  -- 9. Associer B au projet (toujours dans la même transaction).
  IF v_expected_role = 'Auteur' THEN
    UPDATE public.projects
    SET author_id = p_invitee_id
    WHERE id = v_project.id
      AND author_id IS NULL
      AND publisher_id = v_invitation.inviter_id;
  ELSE
    UPDATE public.projects
    SET publisher_id = p_invitee_id
    WHERE id = v_project.id
      AND publisher_id IS NULL
      AND author_id = v_invitation.inviter_id;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Association impossible';
  END IF;

  -- 10. Accorder les clés à B.
  -- Pas de ON CONFLICT : tout doublon inattendu doit annuler la transaction.
  INSERT INTO public.version_access_keys (
    version_id, user_id, encrypted_key
  )
  SELECT
    pik.version_id, p_invitee_id, pik.encrypted_key
  FROM public.pending_invitation_keys pik
  WHERE pik.invitation_id = p_invitation_id;

  GET DIAGNOSTICS v_inserted_keys = ROW_COUNT;

  IF v_inserted_keys <> v_total_versions THEN
    RAISE EXCEPTION 'Attribution incomplète des clés : annulation';
  END IF;

  -- 11. Valider l'invitation et retirer les enveloppes temporaires.
  UPDATE public.project_invitations
  SET status = 'accepted', responded_at = now()
  WHERE id = p_invitation_id;

  DELETE FROM public.pending_invitation_keys
  WHERE invitation_id = p_invitation_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Invitation acceptée avec succès.',
    'project_id', v_project.id
  );
END;
$function$;

-- Interdire l'appel direct par les rôles non privilégiés.
REVOKE ALL ON FUNCTION public.respond_to_project_invitation(uuid, text, boolean)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.respond_to_project_invitation(uuid, text, boolean)
TO service_role;

COMMIT;
