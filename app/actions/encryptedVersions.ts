"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export type SaveEncryptedVersionInput = {
  projectId: string;
  storagePath: string;
  fileName: string;
  fileHash: string;
  ivBase64: string;
  wrappedKeyBase64: string;
};

export type SaveResult =
  | { success: true; versionId: string; recovered: boolean }
  | { success: false; error: string; requiresReview: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalidInput(input: SaveEncryptedVersionInput): boolean {
  return (
    !input ||
    typeof input.projectId !== "string" ||
    !UUID.test(input.projectId) ||
    typeof input.storagePath !== "string" ||
    !new RegExp(
      `^${input.projectId}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.enc$`,
      "i",
    ).test(input.storagePath) ||
    typeof input.fileName !== "string" ||
    input.fileName.trim().length === 0 ||
    input.fileName.length > 255 ||
    !/\.(pdf|docx)$/i.test(input.fileName) ||
    typeof input.fileHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.fileHash) ||
    typeof input.ivBase64 !== "string" ||
    !/^[A-Za-z0-9+/]{16}$/.test(input.ivBase64) ||
    typeof input.wrappedKeyBase64 !== "string" ||
    !/^[A-Za-z0-9+/]{512}$/.test(input.wrappedKeyBase64)
  );
}

type Existing =
  | { kind: "absent" }
  | { kind: "match"; versionId: string }
  | { kind: "conflict" };

/**
 * Retrouver une version déjà enregistrée.
 * N'est appelée qu'après authentification et vérification
 * de l'appartenance de l'utilisateur au projet.
 */
async function findExisting(
  db: SupabaseClient,
  input: SaveEncryptedVersionInput,
  userId: string,
): Promise<Existing> {
  const { data: version, error } = await db
    .from("versions")
    .select("id, file_name, file_hash, encryption_iv, encryption_version")
    .eq("project_id", input.projectId)
    .eq("storage_path", input.storagePath)
    .maybeSingle();

  if (error) throw error;
  if (!version) return { kind: "absent" };

  const { data: ownKey, error: keyError } = await db
    .from("version_access_keys")
    .select("encrypted_key")
    .eq("version_id", version.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (keyError) throw keyError;

  const identical =
    version.file_name === input.fileName &&
    version.file_hash?.toLowerCase() === input.fileHash.toLowerCase() &&
    version.encryption_iv === input.ivBase64 &&
    version.encryption_version === 1 &&
    ownKey?.encrypted_key === input.wrappedKeyBase64;

  return identical
    ? { kind: "match", versionId: version.id as string }
    : { kind: "conflict" };
}

function success(
  projectId: string,
  versionId: string,
  recovered: boolean,
): SaveResult {
  try {
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/projects/${projectId}`);
  } catch (error) {
    // Une erreur d'actualisation ne doit pas invalider
    // une version déjà enregistrée.
    console.warn("Orélien : revalidation après dépôt non confirmée :", error);
  }

  return { success: true, versionId, recovered };
}

export async function saveEncryptedVersion(
  input: SaveEncryptedVersionInput,
): Promise<SaveResult> {
  const { userId } = await auth();

  if (!userId) {
    return {
      success: false,
      error: "Veuillez vous reconnecter.",
      requiresReview: false,
    };
  }

  if (invalidInput(input)) {
    return {
      success: false,
      error: "Données du dépôt invalides.",
      requiresReview: false,
    };
  }

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );

  try {
    // 1. Vérifier les droits sur le projet.
    const { data: project, error: projectError } = await db
      .from("projects")
      .select("author_id, publisher_id")
      .eq("id", input.projectId)
      .maybeSingle();

    if (projectError) throw projectError;

    if (
      !project ||
      (project.author_id !== userId && project.publisher_id !== userId)
    ) {
      return {
        success: false,
        error: "Accès au projet refusé.",
        requiresReview: false,
      };
    }

    // 2. Vérifier si une version existe déjà.
    const existing = await findExisting(db, input, userId);

    if (existing.kind === "match") {
      return success(input.projectId, existing.versionId, true);
    }

    if (existing.kind === "conflict") {
      return {
        success: false,
        error:
          "Ce chemin chiffré est déjà associé à une autre " +
          "version ou clé. Vérification manuelle nécessaire.",
        requiresReview: true,
      };
    }

    // 3. Vérifier le fichier dans Storage.
    const { data: fileInfo, error: storageError } = await db.storage
      .from("manuscripts")
      .info(input.storagePath);

    if (storageError || !fileInfo) {
      return {
        success: false,
        error: "Le fichier chiffré n'a pas pu être vérifié " + "dans Storage.",
        requiresReview: true,
      };
    }

    if (
      typeof fileInfo.size !== "number" ||
      !Number.isFinite(fileInfo.size) ||
      fileInfo.size < 17 ||
      fileInfo.size > 20 * 1024 * 1024 + 16 ||
      fileInfo.contentType !== "application/octet-stream"
    ) {
      return {
        success: false,
        error:
          "Le fichier chiffré possède une taille " + "ou un type invalide.",
        requiresReview: true,
      };
    }

    // 4. Enregistrement atomique version + clé.
    try {
      const { data, error } = await db.rpc("save_encrypted_version", {
        p_user_id: userId,
        p_project_id: input.projectId,
        p_storage_path: input.storagePath,
        p_file_name: input.fileName,
        p_file_hash: input.fileHash.toLowerCase(),
        p_encryption_iv: input.ivBase64,
        p_wrapped_key: input.wrappedKeyBase64,
      });

      if (error) throw error;

      if (typeof data !== "string" || !UUID.test(data)) {
        throw new Error("Identifiant de version manquant ou invalide.");
      }

      return success(input.projectId, data, false);
    } catch (rpcError) {
      // La transaction SQL a peut-être réussi,
      // même si sa réponse n'est jamais arrivée.
      console.warn("Orélien : réponse de sauvegarde incertaine :", rpcError);

      try {
        const after = await findExisting(db, input, userId);

        if (after.kind === "match") {
          return success(input.projectId, after.versionId, true);
        }

        if (after.kind === "conflict") {
          return {
            success: false,
            error:
              "Une version existe avec ce chemin, " +
              "mais ses données ne correspondent pas.",
            requiresReview: true,
          };
        }
      } catch (lookupError) {
        console.warn(
          "Orélien : vérification après échec impossible :",
          lookupError,
        );
      }

      return {
        success: false,
        error:
          "Enregistrement non confirmé. Utilisez la reprise " +
          "du même dépôt, sans renvoyer le fichier.",
        requiresReview: true,
      };
    }
  } catch (error) {
    console.error("Orélien : contrôle de dépôt non confirmé :", error);

    return {
      success: false,
      error:
        "Impossible de vérifier l'enregistrement. " +
        "N'envoyez pas une deuxième fois le document " +
        "avant contrôle.",
      requiresReview: true,
    };
  }
}
