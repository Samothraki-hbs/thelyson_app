"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type KeyToShare = {
  versionId: string;
  senderWrappedKey: string;
};

export type KeySharingPlan =
  | { kind: "no-collaborator" }
  | { kind: "collaborator-not-ready" }
  | { kind: "consent-not-confirmed" }
  | {
      kind: "ready";
      recipientId: string;
      recipientPublicKey: JsonWebKey;
      keysToShare: KeyToShare[];
      waitingForOther: number;
      missingForBoth: number;
    };

type ShareKeyResult =
  | { success: true; inserted: boolean }
  | { success: false; error: string };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function requireProjectMembers(projectId: string, userId: string) {
  if (!UUID_PATTERN.test(projectId)) {
    throw new Error("Identifiant de projet invalide.");
  }

  const supabase = adminClient();
  const { data: project, error } = await supabase
    .from("projects")
    .select("author_id, publisher_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw error;
  if (
    !project ||
    (project.author_id !== userId && project.publisher_id !== userId)
  ) {
    throw new Error("Vous n'avez pas accès à ce projet.");
  }

  const recipientId =
    project.author_id === userId ? project.publisher_id : project.author_id;

  return { supabase, recipientId };
}

/** Liste des versions que CET utilisateur peut partager avec son binôme. */
export async function getProjectKeySharingPlan(
  projectId: string,
): Promise<KeySharingPlan> {
  const { userId } = await auth();
  if (!userId) throw new Error("Connexion nécessaire.");

  const { supabase, recipientId } = await requireProjectMembers(
    projectId,
    userId,
  );
  if (!recipientId) return { kind: "no-collaborator" };

  // Ne partager qu'après une véritable acceptation de l'invitation.
  const { data: accepted, error: acceptedError } = await supabase
    .from("project_invitations")
    .select("id, inviter_id, invitee_id")
    .eq("project_id", projectId)
    .eq("status", "accepted")
    .limit(20);
  if (acceptedError) throw acceptedError;
  if (
    !(accepted ?? []).some(
      (invitation) =>
        (invitation.inviter_id === userId &&
          invitation.invitee_id === recipientId) ||
        (invitation.invitee_id === userId &&
          invitation.inviter_id === recipientId),
    )
  ) {
    return { kind: "consent-not-confirmed" };
  }

  const { data: recipientIdentity, error: identityError } = await supabase
    .from("user_crypto_keys")
    .select("public_key_jwk")
    .eq("user_id", recipientId)
    .maybeSingle();
  if (identityError) throw identityError;
  if (!recipientIdentity) return { kind: "collaborator-not-ready" };

  // Limite explicite du MVP : ne jamais ignorer silencieusement des versions.
  const { data: versions, error: versionsError } = await supabase
    .from("versions")
    .select("id")
    .eq("project_id", projectId)
    .eq("encryption_version", 1)
    .order("created_at", { ascending: false })
    .limit(501);
  if (versionsError) throw versionsError;
  if ((versions ?? []).length > 500) {
    throw new Error(
      "Ce projet dépasse la limite actuelle de partage (500 versions).",
    );
  }

  const versionIds = (versions ?? []).map((v) => v.id as string);
  if (versionIds.length === 0) {
    return {
      kind: "ready",
      recipientId,
      recipientPublicKey: recipientIdentity.public_key_jwk as JsonWebKey,
      keysToShare: [],
      waitingForOther: 0,
      missingForBoth: 0,
    };
  }

  const { data: keyRows, error: keysError } = await supabase
    .from("version_access_keys")
    .select("version_id, user_id, encrypted_key")
    .in("version_id", versionIds)
    .in("user_id", [userId, recipientId])
    .limit(1001);
  if (keysError) throw keysError;
  if ((keyRows ?? []).length > 1000) {
    throw new Error("Trop de clés d'accès pour cette opération.");
  }

  const myKeys = new Map<string, string>();
  const theirKeys = new Set<string>();
  for (const key of keyRows ?? []) {
    if (key.user_id === userId) myKeys.set(key.version_id, key.encrypted_key);
    if (key.user_id === recipientId) theirKeys.add(key.version_id);
  }

  const keysToShare: KeyToShare[] = [];
  let waitingForOther = 0;
  let missingForBoth = 0;

  for (const versionId of versionIds) {
    const myKey = myKeys.get(versionId);
    const theirKey = theirKeys.has(versionId);
    if (myKey && !theirKey) {
      keysToShare.push({ versionId, senderWrappedKey: myKey });
    } else if (!myKey && theirKey) {
      waitingForOther++;
    } else if (!myKey && !theirKey) {
      missingForBoth++;
    }
  }

  return {
    kind: "ready",
    recipientId,
    recipientPublicKey: recipientIdentity.public_key_jwk as JsonWebKey,
    keysToShare,
    waitingForOther,
    missingForBoth,
  };
}

/** Persiste une enveloppe RSA créée dans le navigateur du détenteur. */
export async function shareVersionKey(
  projectId: string,
  versionId: string,
  recipientId: string,
  recipientModulus: string,
  wrappedKeyBase64: string,
): Promise<ShareKeyResult> {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "Connexion nécessaire." };

  if (
    !UUID_PATTERN.test(projectId) ||
    !UUID_PATTERN.test(versionId) ||
    typeof recipientId !== "string" ||
    !recipientId ||
    typeof recipientModulus !== "string" ||
    !recipientModulus ||
    typeof wrappedKeyBase64 !== "string" ||
    wrappedKeyBase64.length !== 512 ||
    !/^[A-Za-z0-9+/]+$/.test(wrappedKeyBase64)
  ) {
    return { success: false, error: "Paramètres de partage invalides." };
  }

  try {
    // L'opération SQL effectue la vérification des membres, de la version,
    // de la clé émettrice et du destinataire dans une même transaction.
    const supabase = adminClient();
    const { data, error } = await supabase.rpc("share_version_access_key", {
      p_sender_id: userId,
      p_project_id: projectId,
      p_version_id: versionId,
      p_recipient_id: recipientId,
      p_recipient_modulus: recipientModulus,
      p_wrapped_key: wrappedKeyBase64,
    });
    if (error) throw error;
    return { success: true, inserted: data === true };
  } catch (error) {
    console.error("Partage de clé Thélyson :", error);
    return {
      success: false,
      error: "Le partage sécurisé de cette version a échoué.",
    };
  }
}
