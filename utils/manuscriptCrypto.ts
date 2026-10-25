/**
 * THÉLYSON — Chiffrement des manuscrits
 *
 * Chiffrement AES-256-GCM directement
 * dans le navigateur de l'utilisateur.
 *
 * Aucun document original ni clé de
 * déchiffrement n'est envoyé au serveur
 * par ces fonctions.
 */

// ==========================================
// 1. CALCUL DE L'EMPREINTE SHA-256
// ==========================================

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);

  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ==========================================
// 2. CONVERSION DE L'IV EN BASE64
// ==========================================

function encodeIV(iv: ArrayBuffer): string {
  const bytes = new Uint8Array(iv);

  return btoa(
    Array.from(bytes)
      .map((byte) => String.fromCharCode(byte))
      .join(""),
  );
}

function decodeIV(value: string): ArrayBuffer {
  const binary = atob(value);

  if (binary.length !== 12) {
    throw new Error("Paramètre de chiffrement invalide.");
  }

  const buffer = new ArrayBuffer(12);
  const bytes = new Uint8Array(buffer);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return buffer;
}

// ==========================================
// 3. TYPE DU MANUSCRIT CHIFFRÉ
// ==========================================

export type EncryptedManuscript = {
  encryptedBlob: Blob;
  encryptionKey: CryptoKey;
  ivBase64: string;
  fileHash: string;
};

// ==========================================
// 4. CHIFFRER UN MANUSCRIT
// ==========================================

export async function encryptManuscript(
  file: File,
): Promise<EncryptedManuscript> {
  if (!crypto?.subtle) {
    throw new Error(
      "Ce navigateur ne prend pas en charge le chiffrement sécurisé.",
    );
  }

  // Étape 1 : lire le fichier original
  const originalBuffer = await file.arrayBuffer();

  // Étape 2 : calculer son empreinte SHA-256
  // AVANT le chiffrement
  const fileHash = await sha256Hex(originalBuffer);

  // Étape 3 : générer une clé AES-256
  // propre à ce manuscrit
  const encryptionKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  // Étape 4 : générer un IV aléatoire
  // de 12 octets (96 bits)
  const iv = new ArrayBuffer(12);

  crypto.getRandomValues(new Uint8Array(iv));

  // Étape 5 : chiffrer le manuscrit
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    encryptionKey,
    originalBuffer,
  );

  // Étape 6 : transformer en fichier chiffré
  const encryptedBlob = new Blob([encryptedBuffer], {
    type: "application/octet-stream",
  });

  return {
    encryptedBlob,
    encryptionKey,
    ivBase64: encodeIV(iv),
    fileHash,
  };
}

// ==========================================
// 5. DÉCHIFFRER UN MANUSCRIT
// ==========================================

export async function decryptManuscript(
  encryptedBlob: Blob,
  encryptionKey: CryptoKey,
  ivBase64: string,
  expectedHash: string,
  originalMimeType: string,
): Promise<Blob> {
  if (!crypto?.subtle) {
    throw new Error("Ce navigateur ne prend pas en charge le déchiffrement.");
  }

  // Étape 1 : reconstruire l'IV
  const iv = decodeIV(ivBase64);

  // Étape 2 : récupérer le contenu chiffré
  const encryptedBuffer = await encryptedBlob.arrayBuffer();

  // Étape 3 : déchiffrer le manuscrit
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    encryptionKey,
    encryptedBuffer,
  );

  // Étape 4 : recalculer l'empreinte SHA-256
  const actualHash = await sha256Hex(decryptedBuffer);

  // Étape 5 : vérifier que le fichier
  // correspond exactement à l'original
  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(
      "L'empreinte SHA-256 du manuscrit ne correspond pas au document original.",
    );
  }

  // Étape 6 : restituer le fichier original
  return new Blob([decryptedBuffer], {
    type: originalMimeType,
  });
}
