-- Orelien — correctif jalon 3.6-bis (Development uniquement)
-- Supprime la répétition PostgreSQL invalide {512} dans
-- la fonction de création des invitations et la contrainte des clés.
-- À exécuter dans SQL Editor puis à conserver comme migration Git.
-- Ne touche ni aux buckets Storage ni aux versions existantes.

BEGIN;

-- 1. Corriger la fonction existante sans modifier ses autres contrôles.
DO $repair$
DECLARE
  function_sql text;
  old_rule text := $old$k.encrypted_key !~ '^[A-Za-z0-9+/]{512}$'$old$;
  new_rule text := $new$(length(k.encrypted_key) <> 512 OR k.encrypted_key !~ '^[A-Za-z0-9+/]+$')$new$;
BEGIN
  SELECT pg_get_functiondef(
    to_regprocedure(
      'public.create_prepared_project_invitation(text,uuid,text,text,jsonb)'
    )
  )
  INTO function_sql;

  IF function_sql IS NULL THEN
    RAISE EXCEPTION 'La fonction create_prepared_project_invitation est introuvable.';
  END IF;

  IF position(old_rule IN function_sql) = 0 THEN
    RAISE EXCEPTION 'La règle SQL attendue est introuvable : aucune modification effectuée.';
  END IF;

  EXECUTE replace(function_sql, old_rule, new_rule);
END;
$repair$;

-- 2. Corriger la contrainte de stockage des enveloppes RSA.
ALTER TABLE public.pending_invitation_keys
  DROP CONSTRAINT pending_invitation_key_format;

ALTER TABLE public.pending_invitation_keys
  ADD CONSTRAINT pending_invitation_key_format
  CHECK (
    length(encrypted_key) = 512
    AND encrypted_key ~ '^[A-Za-z0-9+/]+$'
  );

COMMIT;
