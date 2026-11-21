
-- Créer le bucket privé s'il n'existe pas.
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'manuscripts',
  'manuscripts',
  false,
  23068672,
  ARRAY['application/octet-stream']::text[]
)
ON CONFLICT (id) DO NOTHING;
