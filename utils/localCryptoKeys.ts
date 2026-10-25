/**
 * Thélyson — Moteur cryptographique local
 *
 * Ce module ne communique avec aucun serveur.
 *
 * ATTENTION :
 * La gestion persistante et le partage sécurisé
 * des clés restent à implémenter.
 */

// Convertir un ArrayBuffer en empreinte hexadécimale
async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Convertir un IV en Base64
function encodeIV(iv: Uint8Array): string {
  return btoa(String.fromCharCode(...iv));
}

// Reconstruire un IV depuis Base64
function decodeIV(value: string): Uint8Array {
  const bytes = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

  if (bytes.length !== 12) {
    throw new Error("Paramètre de chiffrement invalide.");
  }

  return bytes;
}

export type EncryptedManuscript = {
  encryptedBlob: Blob;
  encryptionKey: CryptoKey;
  ivBase64: string;
  fileHash: string;
};

/**
 * Chiffrement local d'un manuscrit.
 */
export async function encryptManuscript(
  file: File,
): Promise<EncryptedManuscript> {
  if (!crypto?.subtle) {
    throw new Error(
      "Votre navigateur ne prend pas en charge le chiffrement sécurisé.",
    );
  }

  // 1. Lire le manuscrit original.
  const originalBuffer = await file.arrayBuffer();

  // 2. Calculer le SHA-256 AVANT le chiffrement.
  const fileHash = await sha256Hex(originalBuffer);

  // 3. Générer une clé AES-256 propre au fichier.
  const encryptionKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  // 4. Générer un IV aléatoire de 96 bits.
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // 5. Chiffrer le contenu du manuscrit.
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    encryptionKey,
    originalBuffer,
  );

  // 6. Construire le fichier chiffré.
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

/**
 * Déchiffrement local d'un manuscrit.
 *
 * Nécessite la même clé et le même IV
 * que ceux utilisés lors du chiffrement.
 */

export async function decryptManuscript(
  encryptedBlob: Blob,
  encryptionKey: CryptoKey,
  ivBase64: string,
  expectedHash: string,
  originalMimeType: string,
): Promise<Blob> {
  // 1. Reconstruire l'IV
  const ivBytes = decodeIV(ivBase64);

  // Correction TypeScript :
  // utiliser explicitement un ArrayBuffer
  const iv = new ArrayBuffer(ivBytes.byteLength);
  new Uint8Array(iv).set(ivBytes);

  // 2. Lire les données chiffrées
  const encryptedBuffer = await encryptedBlob.arrayBuffer();

  // 3. Déchiffrer localement
  const decryptedBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      tagLength: 128,
    },
    encryptionKey,
    encryptedBuffer,
  );

  // 4. Vérifier l'intégrité du document original
  const actualHash = await sha256Hex(decryptedBuffer);

  if (actualHash !== expectedHash) {
    throw new Error("L'empreinte du manuscrit ne correspond pas.");
  }

  // 5. Restituer le document original
  return new Blob([decryptedBuffer], { type: originalMimeType });
}

/**
 * Thélyson — Clés cryptographiques locales
 *
 * La clé privée reste dans le navigateur.
 * Ne jamais l'envoyer au serveur.
 */

const DB_NAME = "thelyson-crypto-v1";
const STORE_NAME = "identities";

export type LocalIdentity = {
  userId: string;
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
};

// Ouvrir le stockage local du navigateur.
function openDatabase(): Promise<IDBDatabase> {
  if (
    !globalThis.isSecureContext ||
    !globalThis.crypto?.subtle ||
    !globalThis.indexedDB
  ) {
    return Promise.reject(
      new Error(
        "Le chiffrement nécessite un navigateur compatible et une connexion sécurisée.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, {
          keyPath: "userId",
        });
      }
    };

    request.onsuccess = () => resolve(request.result);

    request.onerror = () =>
      reject(request.error || new Error("Erreur IndexedDB."));
  });
}

// Retrouver la clé de l'utilisateur actuel.
export async function getLocalIdentity(
  userId: string,
): Promise<LocalIdentity | null> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");

    const request = transaction.objectStore(STORE_NAME).get(userId);

    request.onsuccess = () => {
      resolve((request.result as LocalIdentity) || null);
    };

    request.onerror = () =>
      reject(request.error || new Error("Lecture impossible."));

    transaction.oncomplete = () => db.close();
    transaction.onabort = () => db.close();
  });
}

// Enregistrer une identité sans écraser une identité existante.
async function saveLocalIdentity(identity: LocalIdentity): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onabort = () => {
      const error = transaction.error;
      db.close();
      reject(error || new Error("Enregistrement impossible."));
    };

    transaction.objectStore(STORE_NAME).add(identity);
  });
}

// Générer une identité seulement si elle n'existe pas.
export async function createLocalIdentity(
  userId: string,
): Promise<LocalIdentity> {
  const existing = await getLocalIdentity(userId);

  if (existing) return existing;

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-OAEP",
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    false, // Clé privée non exportable
    ["wrapKey", "unwrapKey"],
  );

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const identity: LocalIdentity = {
    userId,
    publicKeyJwk,
    privateKey: keyPair.privateKey,
  };

  try {
    await saveLocalIdentity(identity);
    return identity;
  } catch (error) {
    // Si un autre onglet a créé l'identité entre-temps,
    // utiliser celle qui a déjà été enregistrée.
    const saved = await getLocalIdentity(userId);

    if (saved) return saved;

    throw error;
  }
}

// Vérifier localement que les clés fonctionnent.
export async function testLocalEncryption(
  identity: LocalIdentity,
): Promise<boolean> {
  // Importer la clé publique.
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    identity.publicKeyJwk,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["wrapKey"],
  );

  // Générer une clé temporaire AES-256.
  const aesKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );

  // Protéger la clé AES avec la clé publique.
  const wrappedKey = await crypto.subtle.wrapKey(
    "raw",
    aesKey,
    publicKey,
    "RSA-OAEP",
  );

  // Récupérer la clé AES avec la clé privée locale.
  const restoredKey = await crypto.subtle.unwrapKey(
    "raw",
    wrappedKey,
    identity.privateKey,
    "RSA-OAEP",
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["decrypt"],
  );

  // Tester avec un texte fictif.
  const originalText = "Test de chiffrement Thélyson";

  const originalBytes = new TextEncoder().encode(originalText);

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    aesKey,
    originalBytes,
  );

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    restoredKey,
    encrypted,
  );

  const result = new TextDecoder().decode(decrypted);

  return result === originalText && identity.privateKey.extractable === false;
}
