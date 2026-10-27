import { ensureCryptoIdentity } from "@/utils/ensureCryptoIdentity";
import {
  getProjectKeySharingPlan,
  shareVersionKey,
} from "@/app/actions/shareProjectKeys";

export type KeySyncResult =
  | { kind: "no-collaborator" }
  | { kind: "collaborator-not-ready" }
  | { kind: "consent-not-confirmed" }
  | {
      kind: "done";
      shared: number;
      waitingForOther: number;
      missingForBoth: number;
    };

function base64ToBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Tout le déchiffrement et le rechiffrement des clés AES est effectué
 * dans le navigateur de l'utilisateur déjà autorisé.
 */
export async function syncProjectKeys(
  projectId: string,
  userId: string,
  onProgress?: (shared: number, total: number) => void,
): Promise<KeySyncResult> {
  const identity = await ensureCryptoIdentity(userId);
  const plan = await getProjectKeySharingPlan(projectId);

  if (plan.kind !== "ready") return { kind: plan.kind };

  const { recipientId, recipientPublicKey, keysToShare } = plan;
  if (
    recipientPublicKey.kty !== "RSA" ||
    typeof recipientPublicKey.n !== "string" ||
    recipientPublicKey.e !== "AQAB"
  ) {
    throw new Error("La clé publique du collaborateur est invalide.");
  }

  if (keysToShare.length > 0) {
    const recipientKey = await crypto.subtle.importKey(
      "jwk",
      recipientPublicKey,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["wrapKey"],
    );

    let shared = 0;
    for (const { versionId, senderWrappedKey } of keysToShare) {
      // Clé AES temporairement réexportable en mémoire pour la ré-envelopper.
      const aesKey = await crypto.subtle.unwrapKey(
        "raw",
        base64ToBuffer(senderWrappedKey),
        identity.privateKey,
        "RSA-OAEP",
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );

      const wrapped = await crypto.subtle.wrapKey(
        "raw",
        aesKey,
        recipientKey,
        "RSA-OAEP",
      );

      const result = await shareVersionKey(
        projectId,
        versionId,
        recipientId,
        recipientPublicKey.n,
        bufferToBase64(wrapped),
      );
      if (!result.success) throw new Error(result.error);

      shared++;
      onProgress?.(shared, keysToShare.length);
    }

    return {
      kind: "done",
      shared,
      waitingForOther: plan.waitingForOther,
      missingForBoth: plan.missingForBoth,
    };
  }

  return {
    kind: "done",
    shared: 0,
    waitingForOther: plan.waitingForOther,
    missingForBoth: plan.missingForBoth,
  };
}
