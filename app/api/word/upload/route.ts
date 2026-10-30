import { clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { anchorVersionForUser } from "@/lib/server/anchorVersion";

export const runtime = "nodejs";

const WORD_ORIGIN = "https://localhost:3000";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_ENCRYPTED_SIZE = MAX_FILE_SIZE + 16;

const corsHeaders = {
  "Access-Control-Allow-Origin": WORD_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
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
export async function GET(request: Request) {
  // 1. Vérifier l'origine du complément Word.
  const origin = request.headers.get("origin");

  if (origin && origin !== WORD_ORIGIN) {
    return json({ error: "Origine non autorisée." }, 403);
  }

  const oauthClientId = process.env.THELYSON_WORD_OAUTH_CLIENT_ID;

  if (!oauthClientId) {
    return json({ error: "Configuration OAuth Word manquante." }, 500);
  }

  try {
    // 2. Vérifier l'identité OAuth Clerk.
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

    // 3. Identifier le projet demandé.
    const projectId = new URL(request.url).searchParams.get("projectId");

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!projectId || !uuidPattern.test(projectId)) {
      return json({ error: "Identifiant de projet invalide." }, 400);
    }

    // 4. Accéder à Supabase côté serveur uniquement.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Configuration Supabase manquante." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // 5. Vérifier que l'utilisateur appartient au projet.
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("author_id, publisher_id")
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

    // 6. Identifier l'autre membre du projet.
    const recipientId =
      project.author_id === userId ? project.publisher_id : project.author_id;

    if (!recipientId || recipientId === userId) {
      return json({ kind: "no-collaborator" }, 200);
    }

    // 7. Exiger une invitation réellement acceptée.
    const { data: invitations, error: invitationError } = await supabase
      .from("project_invitations")
      .select("inviter_id, invitee_id")
      .eq("project_id", projectId)
      .eq("status", "accepted")
      .limit(20);

    if (invitationError) {
      return json({ error: "Impossible de vérifier le consentement." }, 500);
    }

    const consentConfirmed = (invitations ?? []).some(
      (invitation) =>
        (invitation.inviter_id === userId &&
          invitation.invitee_id === recipientId) ||
        (invitation.invitee_id === userId &&
          invitation.inviter_id === recipientId),
    );

    if (!consentConfirmed) {
      return json({ kind: "consent-not-confirmed" }, 200);
    }

    // 8. Récupérer uniquement la clé publique du collaborateur.
    const { data: recipientIdentity, error: keyError } = await supabase
      .from("user_crypto_keys")
      .select("public_key_jwk")
      .eq("user_id", recipientId)
      .maybeSingle();

    if (keyError) {
      return json({ error: "Impossible de vérifier la clé RSA." }, 500);
    }

    if (!recipientIdentity?.public_key_jwk) {
      return json({ kind: "collaborator-not-ready" }, 200);
    }

    // 9. Renvoyer la clé publique au complément Word.
    // Aucune clé privée ni clé AES en clair.
    return json(
      {
        kind: "ready",
        recipientId,
        recipientPublicKeyJwk: recipientIdentity.public_key_jwk,
      },
      200,
    );
  } catch (error) {
    console.error("Thélyson Word : vérification du partage", error);

    return json({ error: "Impossible de vérifier le partage." }, 500);
  }
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
    const recipientModulus = form.get("recipientModulus");
    const recipientWrappedKeyBase64 = form.get("recipientWrappedKeyBase64");

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

    // Préparer le partage si le projet possède un collaborateur.
    // Tous les contrôles ont lieu AVANT l'envoi Storage.

    const recipientId =
      project.author_id === userId ? project.publisher_id : project.author_id;

    let recipientSharing: {
      recipientId: string;
      recipientModulus: string;
      wrappedKey: string;
    } | null = null;

    if (recipientId && recipientId !== userId) {
      // 1. Exiger les deux informations de partage.
      if (
        typeof recipientModulus !== "string" ||
        !/^[A-Za-z0-9_-]{512}$/.test(recipientModulus) ||
        typeof recipientWrappedKeyBase64 !== "string" ||
        !/^[A-Za-z0-9+/]{512}$/.test(recipientWrappedKeyBase64)
      ) {
        return json(
          {
            error:
              "Les données de chiffrement du collaborateur sont absentes ou invalides.",
          },
          400,
        );
      }

      // 2. Vérifier une invitation acceptée entre
      // les deux membres exacts du projet.
      const { data: invitations, error: invitationError } = await supabase
        .from("project_invitations")
        .select("id")
        .eq("project_id", projectId)
        .eq("status", "accepted")
        .in("inviter_id", [userId, recipientId])
        .in("invitee_id", [userId, recipientId])
        .limit(1);

      if (invitationError) {
        return json(
          {
            error: "Impossible de vérifier le consentement du collaborateur.",
          },
          500,
        );
      }

      if (!invitations?.length) {
        return json(
          {
            error: "L'invitation du collaborateur n'est pas acceptée.",
          },
          409,
        );
      }

      // 3. Vérifier la clé publique réellement
      // enregistrée pour le collaborateur.
      const { data: recipientIdentity, error: recipientError } = await supabase
        .from("user_crypto_keys")
        .select("public_key_jwk")
        .eq("user_id", recipientId)
        .maybeSingle();

      if (recipientError) {
        return json(
          {
            error: "Impossible de vérifier la clé RSA du collaborateur.",
          },
          500,
        );
      }

      const recipientJwk = recipientIdentity?.public_key_jwk as
        | JsonWebKey
        | undefined;

      if (
        !recipientJwk ||
        recipientJwk.kty !== "RSA" ||
        recipientJwk.e !== "AQAB" ||
        recipientJwk.n !== recipientModulus
      ) {
        return json(
          {
            error:
              "La clé publique du collaborateur a changé ou n'est pas disponible. Actualisez le projet.",
          },
          409,
        );
      }

      // 4. Garder les données vérifiées pour
      // l'enregistrement après la création de la version.
      recipientSharing = {
        recipientId,
        recipientModulus,
        wrappedKey: recipientWrappedKeyBase64,
      };
    } else if (
      recipientModulus !== null ||
      recipientWrappedKeyBase64 !== null
    ) {
      // Un projet individuel ne doit pas contenir
      // d'informations de partage supplémentaires.
      return json(
        {
          error: "Informations de collaborateur inattendues.",
        },
        400,
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

    // Enregistrer l'enveloppe RSA du collaborateur
    // avec la fonction SQL déjà utilisée par Thélyson Web.
    if (recipientSharing) {
      const { error: shareError } = await supabase.rpc(
        "share_version_access_key",
        {
          p_sender_id: userId,
          p_project_id: projectId,
          p_version_id: savedVersion.id,
          p_recipient_id: recipientSharing.recipientId,
          p_recipient_modulus: recipientSharing.recipientModulus,
          p_wrapped_key: recipientSharing.wrappedKey,
        },
      );

      // Vérifier que le destinataire possède bien
      // l'enveloppe RSA attendue.
      const { data: recipientAccess, error: accessError } = shareError
        ? { data: null, error: shareError }
        : await supabase
            .from("version_access_keys")
            .select("encrypted_key")
            .eq("version_id", savedVersion.id)
            .eq("user_id", recipientSharing.recipientId)
            .maybeSingle();

      if (
        shareError ||
        accessError ||
        recipientAccess?.encrypted_key !== recipientSharing.wrappedKey
      ) {
        console.error(
          "Thélyson Word : partage de la version non confirmé",
          shareError?.message ??
            accessError?.message ??
            "Clé du collaborateur non vérifiée",
        );

        // Le manuscrit est déjà enregistré.
        // Ne pas déclencher la blockchain ni inviter
        // l'utilisateur à redéposer le document.
        return json(
          {
            success: true,
            versionId: savedVersion.id,
            storagePath,
            sharingStatus: "unconfirmed",
            blockchainSubmitted: false,
            blockchainStatus: "not_started",
            message:
              "Le manuscrit chiffré est enregistré, " +
              "mais l'accès du collaborateur n'est pas confirmé. " +
              "Ne redéposez pas le document avant vérification.",
          },
          201,
        );
      }
    }

    // 13. Ancrer l'empreinte SHA-256 sur Polygon Amoy.
    // La version est déjà enregistrée dans Supabase.
    // L'identité userId provient du jeton OAuth Clerk vérifié.

    try {
      const anchorResult = await anchorVersionForUser(
        userId,
        savedVersion.id,
        fileHash,
      );

      if (anchorResult.success) {
        return json(
          {
            success: true,
            versionId: savedVersion.id,
            storagePath,
            blockchainSubmitted: true,
            blockchainTxId: anchorResult.txId,
            blockchainStatus: "submitted",
            message:
              "Manuscrit chiffré enregistré. " +
              "Transaction Polygon Amoy transmise et " +
              "référence enregistrée. " +
              "Confirmation sur la blockchain à vérifier.",
          },
          201,
        );
      }

      // Le manuscrit reste enregistré, même si
      // l'ancrage n'a pas abouti ou reste incertain.
      console.warn("Thélyson Word : ancrage non confirmé", anchorResult.error);

      return json(
        {
          success: true,
          versionId: savedVersion.id,
          storagePath,
          blockchainSubmitted: false,
          blockchainStatus: "unconfirmed",
          blockchainWarning: anchorResult.error,
          message:
            "Manuscrit chiffré enregistré. " +
            "Ancrage blockchain non confirmé. " +
            "Ne redéposez pas le document avant vérification.",
        },
        201,
      );
    } catch (error) {
      console.error("Thélyson Word : état blockchain incertain", error);

      // Une erreur blockchain ne doit jamais faire croire
      // que l'enregistrement Supabase a échoué.
      return json(
        {
          success: true,
          versionId: savedVersion.id,
          storagePath,
          blockchainSubmitted: false,
          blockchainStatus: "unconfirmed",
          message:
            "Manuscrit chiffré enregistré. " +
            "État de l'ancrage blockchain incertain. " +
            "Ne redéposez pas le document avant vérification.",
        },
        201,
      );
    }
  } catch (error) {
    console.error("Thélyson Word : erreur API dépôt", error);

    return json({ error: "Impossible de vérifier la demande de dépôt." }, 500);
  }
}
