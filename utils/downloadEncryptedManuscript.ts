import { createClient } from "@supabase/supabase-js";

import { getLocalIdentity } from "@/utils/localCryptoKeys";
import { decryptManuscript } from "@/utils/manuscriptCrypto";

export type DownloadableVersion = {
  id: string;
  storage_path: string;
  file_name: string;
  file_hash: string;
  encryption_iv: string | null;
  encryption_version: number | null;
};

type GetToken = () => Promise<string | null>;

// Conversion Base64 vers ArrayBuffer compatible Web Crypto.
function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return buffer;
}

function getMimeType(name: string): string {
  return name.toLowerCase().endsWith(".pdf")
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

/**
 * Télécharge et déchiffre un manuscrit.
 * Le document original reste uniquement dans le navigateur.
 */
export async function getDecryptedManuscript(
  version: DownloadableVersion,
  userId: string,
  getToken: GetToken,
): Promise<Blob> {
  if (version.encryption_version !== 1 || !version.encryption_iv) {
    throw new Error(
      "Cette version ne possède pas les paramètres de chiffrement attendus.",
    );
  }

  // 1. Retrouver la clé privée locale.
  const identity = await getLocalIdentity(userId);

  if (!identity) {
    throw new Error("La clé de ce coffre-fort est absente de ce navigateur.");
  }

  // 2. Connexion Supabase avec le jeton Clerk.
  const token = await getToken();

  if (!token) {
    throw new Error("Veuillez vous reconnecter.");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    },
  );

  // 3. Récupérer la clé AES chiffrée pour cet utilisateur.
  const { data: accessKey, error: keyError } = await supabase
    .from("version_access_keys")
    .select("encrypted_key")
    .eq("version_id", version.id)
    .eq("user_id", userId)
    .single();

  if (keyError || !accessKey) {
    throw new Error("Vous ne possédez pas de clé d'accès pour cette version.");
  }

  // 4. Déchiffrer la clé AES avec la clé privée locale.
  const wrappedBuffer = base64ToArrayBuffer(accessKey.encrypted_key);

  const encryptionKey = await crypto.subtle.unwrapKey(
    "raw",
    wrappedBuffer,
    identity.privateKey,
    "RSA-OAEP",
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt"],
  );

  // 5. Récupérer le fichier chiffré depuis Supabase.
  const { data: encryptedBlob, error: downloadError } = await supabase.storage
    .from("manuscripts")
    .download(version.storage_path);

  if (downloadError || !encryptedBlob) {
    throw new Error("Impossible de télécharger le fichier chiffré.");
  }

  // 6. Déchiffrer et vérifier le SHA-256 original.
  return decryptManuscript(
    encryptedBlob,
    encryptionKey,
    version.encryption_iv,
    version.file_hash,
    getMimeType(version.file_name),
  );
}

/**
 * Déclenche le téléchargement d'un Blob dans le navigateur.
 */
export function saveBlobToComputer(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 30_000);
}
