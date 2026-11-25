"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRAPPED_KEY_PATTERN = /^[A-Za-z0-9+/]{512}$/;

type PreparedVersion = {
  versionId: string;
  senderWrappedKey: string;
};

export type PreparedInvitationKey = {
  version_id: string;
  encrypted_key: string;
};

type PreparationResult =
  | {
      success: true;
      recipientPublicKey: JsonWebKey;
      versions: PreparedVersion[];
    }
  | { success: false; error: string };

type InvitationResult =
  | { success: true; message: string }
  | { success: false; error: string };

class ExpectedError extends Error {}

function describeError(error: unknown) {
  console.error("Préparation d'invitation Orélien :", error);
  return error instanceof ExpectedError
    ? error.message
    : "Une erreur technique empêche la préparation de l'invitation.";
}

/** Validation côté serveur, exécutée à la préparation ET à la confirmation. */
async function requireInvitationContext(projectId: string, email: string) {
  const { userId } = await auth();
  if (!userId) throw new ExpectedError("Veuillez vous connecter.");

  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (
    !UUID_PATTERN.test(projectId) ||
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    throw new ExpectedError("Projet ou adresse e-mail invalide.");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("author_id, publisher_id")
    .eq("id", projectId)
    .maybeSingle();
  if (projectError) throw projectError;
  if (!project || (project.author_id !== userId && project.publisher_id !== userId)) {
    throw new ExpectedError("Vous n'avez pas accès à ce projet.");
  }

  const isAuthor = project.author_id === userId;
  if (isAuthor ? project.publisher_id !== null : project.author_id !== null) {
    throw new ExpectedError("Ce projet possède déjà deux collaborateurs.");
  }

  const { data: ownProfile, error: ownError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (ownError) throw ownError;
  const expectedOwnRole = isAuthor ? "Auteur" : "Editeur";
  const expectedRecipientRole = isAuthor ? "Editeur" : "Auteur";
  if (ownProfile?.role !== expectedOwnRole) {
    throw new ExpectedError("Votre rôle ne correspond pas au projet.");
  }

  const clerk = await clerkClient();
  const users = await clerk.users.getUserList({ emailAddress: [normalizedEmail] });
  const recipient = users.data.find((person) =>
    person.emailAddresses.some(
      (address) =>
        address.emailAddress.toLowerCase() === normalizedEmail &&
        address.verification?.status === "verified",
    ),
  );
  if (!recipient || recipient.id === userId) {
    throw new ExpectedError("Destinataire introuvable ou non éligible.");
  }

  const { data: recipientProfile, error: roleError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", recipient.id)
    .maybeSingle();
  if (roleError) throw roleError;
  if (recipientProfile?.role !== expectedRecipientRole) {
    throw new ExpectedError(`Le destinataire doit avoir le rôle ${expectedRecipientRole}.`);
  }

  const { data: cryptoIdentity, error: cryptoError } = await supabase
    .from("user_crypto_keys")
    .select("public_key_jwk")
    .eq("user_id", recipient.id)
    .maybeSingle();
  if (cryptoError) throw cryptoError;
  const publicKey = cryptoIdentity?.public_key_jwk as JsonWebKey | undefined;
  if (
    !publicKey || publicKey.kty !== "RSA" ||
    typeof publicKey.n !== "string" || publicKey.e !== "AQAB"
  ) {
    throw new ExpectedError(
      "Le destinataire doit d'abord préparer son coffre-fort depuis son compte.",
    );
  }

  return { supabase, userId, recipientId: recipient.id, publicKey };
}

/** Préparer sans publier l'invitation. Aucune écriture en base. */
export async function prepareCollaboratorInvitation(
  projectId: string,
  email: string,
): Promise<PreparationResult> {
  try {
    const { supabase, userId, publicKey } = await requireInvitationContext(projectId, email);

    const { data: versions, error: versionsError } = await supabase
      .from("versions")
      .select("id, encryption_version")
      .eq("project_id", projectId)
      .limit(501);
    if (versionsError) throw versionsError;
    if ((versions ?? []).length > 500) {
      throw new ExpectedError("Le partage est limité à 500 versions par projet.");
    }
    if ((versions ?? []).some((v) => v.encryption_version !== 1)) {
      throw new ExpectedError("Le projet contient une version non compatible avec ce partage.");
    }

    const ids = (versions ?? []).map((v) => v.id as string);
    if (ids.length === 0) {
      return { success: true, recipientPublicKey: publicKey, versions: [] };
    }

    const { data: accessKeys, error: accessError } = await supabase
      .from("version_access_keys")
      .select("version_id, encrypted_key")
      .eq("user_id", userId)
      .in("version_id", ids)
      .limit(501);
    if (accessError) throw accessError;

    const byVersion = new Map(
      (accessKeys ?? []).map((k) => [k.version_id as string, k.encrypted_key as string]),
    );
    const prepared: PreparedVersion[] = [];
    for (const versionId of ids) {
      const senderWrappedKey = byVersion.get(versionId);
      if (!senderWrappedKey || !WRAPPED_KEY_PATTERN.test(senderWrappedKey)) {
        throw new ExpectedError(
          "Une version ne possède pas de clé accessible sur cet appareil : invitation non créée.",
        );
      }
      prepared.push({ versionId, senderWrappedKey });
    }

    return { success: true, recipientPublicKey: publicKey, versions: prepared };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}

/** Publier seulement si toutes les enveloppes sont prêtes et cohérentes. */
export async function addCollaborator(
  projectId: string,
  email: string,
  recipientModulus: string,
  preparedKeys: PreparedInvitationKey[],
): Promise<InvitationResult> {
  try {
    if (
      typeof recipientModulus !== "string" ||
      !Array.isArray(preparedKeys) || preparedKeys.length > 500 ||
      preparedKeys.some(
        (k) => !k || !UUID_PATTERN.test(k.version_id) ||
          !WRAPPED_KEY_PATTERN.test(k.encrypted_key),
      )
    ) {
      throw new ExpectedError("Données cryptographiques de l'invitation invalides.");
    }

    // Ne jamais accepter un recipientId fourni par le navigateur.
    const { supabase, userId, recipientId, publicKey } =
      await requireInvitationContext(projectId, email);
    if (publicKey.n !== recipientModulus) {
      throw new ExpectedError("La clé publique du destinataire a changé.");
    }

    // La fonction SQL vérifie toutes les versions et effectue l'insertion
    // des enveloppes ET de l'invitation dans une unique transaction.
    const { data, error } = await supabase.rpc(
      "create_prepared_project_invitation",
      {
        p_inviter_id: userId,
        p_project_id: projectId,
        p_invitee_id: recipientId,
        p_recipient_modulus: recipientModulus,
        p_keys: preparedKeys,
      },
    );
    if (error) throw error;
    if (typeof data !== "string") {
      throw new Error("Identifiant d'invitation manquant.");
    }

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/projects/${projectId}`);
    return {
      success: true,
      message: "Invitation et clés chiffrées préparées. En attente de l'accord du collaborateur.",
    };
  } catch (error) {
    return { success: false, error: describeError(error) };
  }
}
