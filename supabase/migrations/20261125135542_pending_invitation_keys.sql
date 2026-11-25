
-- Jalon 3.6-bis : préparation anticipée des clés
-- avant acceptation de l'invitation.

CREATE TABLE public.pending_invitation_keys (
  invitation_id UUID NOT NULL
    REFERENCES public.project_invitations(id)
    ON DELETE CASCADE,

  version_id UUID NOT NULL
    REFERENCES public.versions(id)
    ON DELETE CASCADE,

  encrypted_key TEXT NOT NULL
    CONSTRAINT pending_invitation_key_format
    CHECK (
      encrypted_key ~ '^[A-Za-z0-9+/]{512}$'
    ),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  PRIMARY KEY (invitation_id, version_id)
);

-- Aucun utilisateur ordinaire ne peut lire cette table.
ALTER TABLE public.pending_invitation_keys
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES
ON TABLE public.pending_invitation_keys
FROM PUBLIC, anon, authenticated;

-- Seul le serveur privilégié y accède.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.pending_invitation_keys
TO service_role;
