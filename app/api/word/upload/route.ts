import { clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const WORD_ORIGIN = "https://localhost:3000";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_ENCRYPTED_SIZE = MAX_FILE_SIZE + 16;

const corsHeaders = {
  "Access-Control-Allow-Origin": WORD_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

function json(data: unknown, status: number) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");

  if (origin && origin !== WORD_ORIGIN) {
    return json({ error: "Origine non autorisée." }, 403);
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: Request) {
  // 1. Vérifier l'origine du complément Word.
  const origin = request.headers.get("origin");

  if (origin && origin !== WORD_ORIGIN) {
    return json({ error: "Origine non autorisée." }, 403);
  }

  // 2. Vérifier le jeton OAuth Clerk.
  const oauthClientId = process.env.THELYSON_WORD_OAUTH_CLIENT_ID;

  if (!oauthClientId) {
    return json({ error: "Configuration OAuth Word manquante." }, 500);
  }

  try {
    const clerk = await clerkClient();

    const requestState = await clerk.authenticateRequest(request, {
      acceptsToken: "oauth_token",
    });

    if (!requestState.isAuthenticated) {
      return json({ error: "Connexion requise." }, 401);
    }

    const identity = requestState.toAuth();

    if (
      identity.tokenType !== "oauth_token" ||
      !identity.userId ||
      identity.clientId !== oauthClientId ||
      !identity.scopes.includes("profile")
    ) {
      return json({ error: "Autorisation Word invalide." }, 401);
    }

    const userId = identity.userId;

    // 3. Contrôler le format de la requête.
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.startsWith("multipart/form-data")) {
      return json({ error: "Un formulaire multipart est attendu." }, 415);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? 0);

    // Première limite, avant de lire le formulaire.
    if (declaredLength > MAX_ENCRYPTED_SIZE + 65536) {
      return json({ error: "Requête trop volumineuse." }, 413);
    }

    const form = await request.formData();

    const projectId = form.get("projectId");
    const fileName = form.get("fileName");
    const fileHash = form.get("fileHash");
    const ivBase64 = form.get("ivBase64");
    const wrappedKeyBase64 = form.get("wrappedKeyBase64");
    const encryptedFile = form.get("encryptedFile");

    // 4. Vérifier les informations du manuscrit.
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (typeof projectId !== "string" || !uuidPattern.test(projectId)) {
      return json({ error: "Identifiant de projet invalide." }, 400);
    }

    if (
      typeof fileName !== "string" ||
      fileName.length > 255 ||
      !/\.docx$/i.test(fileName) ||
      /[\\/]/.test(fileName)
    ) {
      return json({ error: "Nom de document DOCX invalide." }, 400);
    }

    if (typeof fileHash !== "string" || !/^[a-f0-9]{64}$/.test(fileHash)) {
      return json({ error: "Empreinte SHA-256 invalide." }, 400);
    }

    if (typeof ivBase64 !== "string" || !/^[A-Za-z0-9+/]{16}$/.test(ivBase64)) {
      return json({ error: "IV AES-GCM invalide." }, 400);
    }

    if (
      typeof wrappedKeyBase64 !== "string" ||
      !/^[A-Za-z0-9+/]{512}$/.test(wrappedKeyBase64)
    ) {
      return json({ error: "Clé AES protégée invalide." }, 400);
    }

    if (
      !(encryptedFile instanceof File) ||
      encryptedFile.size <= 16 ||
      encryptedFile.size > MAX_ENCRYPTED_SIZE ||
      encryptedFile.type !== "application/octet-stream"
    ) {
      return json(
        { error: "Fichier chiffré invalide ou trop volumineux." },
        400,
      );
    }

    // 5. Utiliser Supabase uniquement côté serveur.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Configuration du stockage manquante." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 6. Vérifier le profil de l'utilisateur.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (
      profileError ||
      !profile ||
      !["Auteur", "Editeur"].includes(profile.role)
    ) {
      return json({ error: "Profil Thélyson non autorisé." }, 403);
    }

    // 7. Vérifier le projet et ses propriétaires.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, author_id, publisher_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) {
      return json({ error: "Impossible de vérifier le projet." }, 500);
    }

    if (
      !project ||
      (project.author_id !== userId && project.publisher_id !== userId)
    ) {
      return json({ error: "Accès au projet refusé." }, 403);
    }

    // Les projets déjà liés à deux utilisateurs sont
    // temporairement exclus du dépôt Word.
    if (project.author_id && project.publisher_id) {
      return json(
        {
          error: "Le dépôt Word sur un projet partagé n'est pas encore activé.",
        },
        409,
      );
    }

    // 8. Vérifier que la clé publique du compte existe.
    const { data: cryptoIdentity, error: cryptoError } = await supabase
      .from("user_crypto_keys")
      .select("public_key_jwk")
      .eq("user_id", userId)
      .maybeSingle();

    if (cryptoError) {
      return json({ error: "Impossible de vérifier la clé publique." }, 500);
    }

    if (!cryptoIdentity?.public_key_jwk) {
      return json(
        {
          error: "Aucune clé publique RSA enregistrée pour ce compte.",
        },
        409,
      );
    }

    // 9. Créer un chemin de stockage opaque.
    // Même convention que le dépôt Thélyson Web.
    const storagePath = `${projectId}/${crypto.randomUUID()}.enc`;

    // 10. Envoyer uniquement le manuscrit chiffré.
    const { error: uploadError } = await supabase.storage
      .from("manuscripts")
      .upload(storagePath, encryptedFile, {
        contentType: "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      console.error(
        "Thélyson Word : échec du stockage chiffré",
        uploadError.message,
      );

      return json(
        { error: "Impossible de stocker le manuscrit chiffré." },
        502,
      );
    }

    // 11. Enregistrer la version et la clé AES protégée.
    // Réutiliser la fonction SQL du dépôt Web.
    try {
      const { error: saveError } = await supabase.rpc(
        "save_encrypted_version",
        {
          p_user_id: userId,
          p_project_id: projectId,
          p_storage_path: storagePath,
          p_file_name: fileName,
          p_file_hash: fileHash,
          p_encryption_iv: ivBase64,
          p_wrapped_key: wrappedKeyBase64,
        },
      );

      if (saveError) {
        throw new Error(saveError.message);
      }
    } catch (error) {
      console.error("Thélyson Word : enregistrement SQL non confirmé", error);

      // Ne pas supprimer automatiquement le fichier :
      // une réponse réseau ambiguë pourrait masquer
      // un enregistrement SQL pourtant réussi.
      return json(
        {
          error:
            "Le fichier chiffré a été envoyé, mais l'enregistrement " +
            "de la version n'est pas confirmé. Ne redéposez pas " +
            "le manuscrit avant vérification.",
          storagePath,
          requiresReview: true,
        },
        500,
      );
    }

    // 12. Vérifier que la version existe réellement.
    const { data: savedVersion, error: lookupError } = await supabase
      .from("versions")
      .select("id")
      .eq("project_id", projectId)
      .eq("storage_path", storagePath)
      .maybeSingle();

    if (lookupError || !savedVersion) {
      console.error(
        "Thélyson Word : version enregistrée mais non vérifiée",
        lookupError?.message ?? "Version introuvable",
      );

      return json(
        {
          error:
            "L'enregistrement a été effectué mais sa vérification " +
            "n'a pas abouti. Ne redéposez pas le manuscrit.",
          storagePath,
          requiresReview: true,
        },
        500,
      );
    }

    // 13. Confirmer uniquement l'enregistrement chiffré.
    // Aucun ancrage blockchain à cette étape.
    return json(
      {
        success: true,
        versionId: savedVersion.id,
        storagePath,
        blockchainAnchored: false,
        message:
          "Manuscrit chiffré enregistré. " +
          "Ancrage blockchain non encore effectué.",
      },
      201,
    );
  } catch (error) {
    console.error("Thélyson Word : erreur API dépôt", error);

    return json({ error: "Impossible de vérifier la demande de dépôt." }, 500);
  }
}
