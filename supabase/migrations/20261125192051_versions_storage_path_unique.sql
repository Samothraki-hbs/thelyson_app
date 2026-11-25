-- Orélien — Jalon 3.8.2
-- Empêcher deux versions de référencer le même objet Storage.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS versions_storage_path_unique
ON public.versions (storage_path)
WHERE storage_path IS NOT NULL;

COMMIT;