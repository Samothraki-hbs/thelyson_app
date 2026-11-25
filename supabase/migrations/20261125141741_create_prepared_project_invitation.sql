
-- Jalon 3.6-bis.2
-- Création atomique d'une invitation avec ses clés préparées.
-- Cette fonction n'est accessible qu'au serveur service_role.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_prepared_project_invitation(
  p_inviter_id text,
  p_project_id uuid,
  p_invitee_id text,
  p_recipient_modulus text,
  p_keys jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_project public.projects%ROWTYPE;
  v_invitation_id uuid;
  v_expected_inviter_role text;
  v_expected_invitee_role text;
  v_version_count integer;
BEGIN
  -- 1. Contrôler les paramètres.
  IF p_inviter_id IS NULL OR p_invitee_id IS NULL
     OR p_inviter_id = p_invitee_id
     OR p_recipient_modulus IS NULL
     OR jsonb_typeof(p_keys) IS DISTINCT FROM 'array'
  THEN
    RAISE EXCEPTION 'Paramètres d''invitation invalides';
  END IF;

  IF jsonb_array_length(p_keys) > 500 THEN
    RAISE EXCEPTION 'Limite de 500 versions dépassée';
  END IF;

  -- 2. Verrouiller le projet pendant l'opération.
  SELECT *
    INTO v_project
  FROM public.projects
  WHERE id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Projet introuvable';
  END IF;

  -- 3. Vérifier les rôles et la place disponible.
  IF v_project.author_id = p_inviter_id
     AND v_project.publisher_id IS NULL THEN

    v_expected_inviter_role := 'Auteur';
    v_expected_invitee_role := 'Editeur';

  ELSIF v_project.publisher_id = p_inviter_id
     AND v_project.author_id IS NULL THEN

    v_expected_inviter_role := 'Editeur';
    v_expected_invitee_role := 'Auteur';

  ELSE
    RAISE EXCEPTION 'Invitation non autorisée pour ce projet';
  END IF;

  IF (
    SELECT role FROM public.profiles
    WHERE id = p_inviter_id
  ) IS DISTINCT FROM v_expected_inviter_role
  OR (
    SELECT role FROM public.profiles
    WHERE id = p_invitee_id
  ) IS DISTINCT FROM v_expected_invitee_role
  THEN
    RAISE EXCEPTION 'Rôles des collaborateurs incompatibles';
  END IF;

  -- 4. Vérifier la clé publique actuelle du destinataire.
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_crypto_keys
    WHERE user_id = p_invitee_id
      AND public_key_jwk ->> 'n' = p_recipient_modulus
      AND public_key_jwk ->> 'e' = 'AQAB'
  ) THEN
    RAISE EXCEPTION 'Clé publique du destinataire absente ou modifiée';
  END IF;

  -- 5. Refuser les versions non prises en charge.
  IF EXISTS (
    SELECT 1
    FROM public.versions
    WHERE project_id = p_project_id
      AND encryption_version IS DISTINCT FROM 1
  ) THEN
    RAISE EXCEPTION 'Version non compatible avec ce partage';
  END IF;

  SELECT count(*) INTO v_version_count
  FROM public.versions
  WHERE project_id = p_project_id
    AND encryption_version = 1;

  -- 6. Vérifier que toutes les versions ont une clé.
  IF v_version_count > 500
     OR jsonb_array_length(p_keys) <> v_version_count
  THEN
    RAISE EXCEPTION 'Préparation des clés incomplète';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_keys)
      AS k(version_id uuid, encrypted_key text)
    LEFT JOIN public.versions v
      ON v.id = k.version_id
      AND v.project_id = p_project_id
      AND v.encryption_version = 1
    LEFT JOIN public.version_access_keys a
      ON a.version_id = k.version_id
      AND a.user_id = p_inviter_id
    WHERE
      k.version_id IS NULL
      OR k.encrypted_key IS NULL
      OR k.encrypted_key !~ '^[A-Za-z0-9+/]{512}$'
      OR v.id IS NULL
      OR a.version_id IS NULL
  ) OR (
    SELECT count(DISTINCT k.version_id)
    FROM jsonb_to_recordset(p_keys)
      AS k(version_id uuid, encrypted_key text)
  ) <> v_version_count
  THEN
    RAISE EXCEPTION 'Clés préparées invalides ou manquantes';
  END IF;

  -- 7. Expirer les anciennes invitations échues.
  UPDATE public.project_invitations
  SET status = 'expired'
  WHERE project_id = p_project_id
    AND status = 'pending'
    AND expires_at <= now();

  IF EXISTS (
    SELECT 1
    FROM public.project_invitations
    WHERE project_id = p_project_id
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'Une invitation est déjà en attente';
  END IF;

  -- 8. Créer l'invitation.
  INSERT INTO public.project_invitations (
    project_id, inviter_id, invitee_id, status
  )
  VALUES (
    p_project_id, p_inviter_id, p_invitee_id, 'pending'
  )
  RETURNING id INTO v_invitation_id;

  -- 9. Enregistrer toutes les enveloppes préparées.
  INSERT INTO public.pending_invitation_keys (
    invitation_id, version_id, encrypted_key
  )
  SELECT
    v_invitation_id,
    k.version_id,
    k.encrypted_key
  FROM jsonb_to_recordset(p_keys)
    AS k(version_id uuid, encrypted_key text);

  RETURN v_invitation_id;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.create_prepared_project_invitation(
    text, uuid, text, text, jsonb
  )
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.create_prepared_project_invitation(
    text, uuid, text, text, jsonb
  )
TO service_role;

COMMIT;
