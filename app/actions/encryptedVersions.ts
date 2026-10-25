"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

type SaveEncryptedVersionInput = {
  projectId: string;
  storagePath: string;
  fileName: string;
  fileHash: string;
  ivBase64: string;
  wrappedKeyBase64: string;
};

type SaveResult =
  | { success: true; versionId: string }
  | { success: false; error: string };

export async function saveEncryptedVersion(
  input: SaveEncryptedVersionInput,
): Promise<SaveResult> {
  const { userId } = await auth();

  if (!userId) {
    return {
      success: false,
      error: "Vous devez être connecté.",
    };
  }

  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (
    !input ||
    typeof input.projectId !== "string" ||
    !uuidRegex.test(input.projectId) ||
    typeof input.storagePath !== "string" ||
    input.storagePath !==
      `${input.projectId}/${input.storagePath.split("/")[1]}` ||
    !new RegExp(`^${input.projectId}/[0-9a-f-]{36}\\.enc$`, "i").test(
      input.storagePath,
    ) ||
    typeof input.fileName !== "string" ||
    input.fileName.length > 255 ||
    !/\.(pdf|docx)$/i.test(input.fileName) ||
    typeof input.fileHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(input.fileHash) ||
    typeof input.ivBase64 !== "string" ||
    !/^[A-Za-z0-9+/]{16}$/.test(input.ivBase64) ||
    typeof input.wrappedKeyBase64 !== "string" ||
    !/^[A-Za-z0-9+/]{512}$/.test(input.wrappedKeyBase64)
  ) {
    return {
      success: false,
      error: "Données du dépôt invalides.",
    };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // Vérifier explicitement les droits du déposant.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("author_id, publisher_id")
      .eq("id", input.projectId)
      .maybeSingle();

    if (projectError || !project) {
      return {
        success: false,
        error: "Projet introuvable.",
      };
    }

    if (project.author_id !== userId && project.publisher_id !== userId) {
      return {
        success: false,
        error: "Vous n'avez pas accès à ce projet.",
      };
    }

    // Vérifier que le fichier chiffré a bien été envoyé.
    const { data: fileInfo, error: storageError } = await supabase.storage
      .from("manuscripts")
      .info(input.storagePath);

    if (storageError || !fileInfo) {
      return {
        success: false,
        error: "Fichier chiffré introuvable.",
      };
    }

    // Limite pour les tests : 20 Mo + marge AES-GCM.

    const fileSize = fileInfo.size;

    // Vérifier que Supabase renvoie bien une taille valide
    if (
      typeof fileSize !== "number" ||
      !Number.isFinite(fileSize) ||
      fileSize < 17 ||
      fileSize > 20 * 1024 * 1024 + 16
    ) {
      return {
        success: false,
        error: "Taille du document chiffré invalide.",
      };
    }

    if (fileInfo.contentType !== "application/octet-stream") {
      return {
        success: false,
        error: "Format du fichier stocké invalide.",
      };
    }

    // Enregistrement atomique de la version et de sa clé.
    const { data, error } = await supabase.rpc("save_encrypted_version", {
      p_user_id: userId,
      p_project_id: input.projectId,
      p_storage_path: input.storagePath,
      p_file_name: input.fileName,
      p_file_hash: input.fileHash.toLowerCase(),
      p_encryption_iv: input.ivBase64,
      p_wrapped_key: input.wrappedKeyBase64,
    });

    if (error) throw error;

    if (typeof data !== "string") {
      throw new Error("Identifiant de version manquant.");
    }

    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/projects/${input.projectId}`);

    return {
      success: true,
      versionId: data,
    };
  } catch (error: unknown) {
    const supabaseError = error as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    };

    // Afficher le détail de l'erreur dans le terminal
    console.error("ERREUR SUPABASE - VERSION CHIFFRÉE", {
      code: supabaseError?.code,
      message: supabaseError?.message,
      details: supabaseError?.details,
      hint: supabaseError?.hint,
    });

    return {
      success: false,
      error:
        process.env.NODE_ENV === "development"
          ? `Erreur Supabase (${supabaseError?.code ?? "inconnue"}) : ${
              supabaseError?.message ?? "Erreur inconnue"
            }`
          : "Impossible d'enregistrer la version chiffrée.",
    };
  }
}
