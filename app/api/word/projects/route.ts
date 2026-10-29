import { clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const WORD_ORIGIN = "https://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": WORD_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Cache-Control": "no-store",
  Vary: "Origin",
};

function json(data: object, status: number) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

// Autoriser les requêtes du complément Word.
export async function OPTIONS(request: Request) {
  if (
    process.env.NODE_ENV !== "development" ||
    request.headers.get("origin") !== WORD_ORIGIN
  ) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Récupérer les projets accessibles à l'utilisateur connecté.
export async function GET(request: Request) {
  // Cette version fonctionne uniquement en développement.
  if (process.env.NODE_ENV !== "development") {
    return json({ error: "Route indisponible." }, 404);
  }

  if (request.headers.get("origin") !== WORD_ORIGIN) {
    return json({ error: "Origine non autorisée." }, 403);
  }

  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return json({ error: "Jeton OAuth manquant." }, 401);
  }

  try {
    // 1. Vérifier le jeton OAuth auprès de Clerk.
    const client = await clerkClient();

    const authentication = await client.authenticateRequest(request, {
      acceptsToken: "oauth_token",
    });

    if (!authentication.isAuthenticated) {
      console.warn(
        "Thélyson Word : refus OAuth :",
        authentication.reason ?? "Raison non précisée",
      );

      return json({ error: "Connexion non autorisée." }, 401);
    }

    const identity = authentication.toAuth();

    if (identity.tokenType !== "oauth_token") {
      return json({ error: "Type de jeton invalide." }, 401);
    }

    const expectedClientId = process.env.THELYSON_WORD_OAUTH_CLIENT_ID;

    if (
      !identity.userId ||
      !expectedClientId ||
      identity.clientId !== expectedClientId ||
      !identity.scopes.includes("profile")
    ) {
      return json({ error: "Autorisation insuffisante." }, 403);
    }

    const userId = identity.userId;

    // 2. Accéder à Supabase uniquement depuis le serveur.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Configuration serveur manquante." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 3. Vérifier le profil, comme sur le site Thélyson.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      return json({ error: "Profil Thélyson introuvable." }, 403);
    }

    if (profile.role !== "Auteur" && profile.role !== "Editeur") {
      return json({ error: "Profil Thélyson incomplet." }, 403);
    }

    // 4. Retrouver les projets avec les mêmes droits que le site.
    const { data: projects, error: projectsError } = await supabase
      .from("projects")
      .select("id, title, created_at")
      .or(`author_id.eq.${userId},publisher_id.eq.${userId}`)
      .order("created_at", { ascending: false });

    if (projectsError) {
      return json({ error: "Impossible de récupérer les projets." }, 500);
    }

    // Récupérer uniquement la clé publique RSA
    // de l'utilisateur authentifié par Clerk.
    const { data: cryptoIdentity, error: cryptoError } = await supabase
      .from("user_crypto_keys")
      .select("public_key_jwk")
      .eq("user_id", userId)
      .maybeSingle();

    if (cryptoError) {
      return json({ error: "Impossible de récupérer la clé publique." }, 500);
    }

    // Conserver les projets et ajouter la clé publique.
    // Si aucune identité n'existe, retourner null.
    return json(
      {
        projects: projects ?? [],
        publicKeyJwk: cryptoIdentity?.public_key_jwk ?? null,
      },
      200,
    );

    // 5. Envoyer à Word uniquement les données nécessaires.
    return json({ projects: projects ?? [] }, 200);
  } catch {
    return json(
      { error: "Erreur lors de la vérification de la connexion." },
      500,
    );
  }
}

export async function POST(request: Request) {
  // La route reste limitée au développement.
  if (process.env.NODE_ENV !== "development") {
    return json({ error: "Route indisponible." }, 404);
  }

  if (request.headers.get("origin") !== WORD_ORIGIN) {
    return json({ error: "Origine non autorisée." }, 403);
  }

  if (!request.headers.get("authorization")?.startsWith("Bearer ")) {
    return json({ error: "Jeton OAuth manquant." }, 401);
  }

  try {
    // 1. Vérifier l'identité de l'utilisateur Word.
    const client = await clerkClient();

    const authentication = await client.authenticateRequest(request, {
      acceptsToken: "oauth_token",
    });

    if (!authentication.isAuthenticated) {
      return json({ error: "Connexion non autorisée." }, 401);
    }

    const identity = authentication.toAuth();

    const expectedClientId = process.env.THELYSON_WORD_OAUTH_CLIENT_ID;

    if (
      identity.tokenType !== "oauth_token" ||
      !identity.userId ||
      !expectedClientId ||
      identity.clientId !== expectedClientId ||
      !identity.scopes.includes("profile")
    ) {
      return json({ error: "Autorisation insuffisante." }, 403);
    }

    const userId = identity.userId;

    // 2. Vérifier le titre envoyé depuis Word.
    if (!request.headers.get("content-type")?.startsWith("application/json")) {
      return json({ error: "Format de requête invalide." }, 415);
    }

    let body: unknown;

    try {
      const rawBody = await request.text();

      if (rawBody.length > 2048) {
        return json({ error: "Requête trop volumineuse." }, 413);
      }

      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "Données JSON invalides." }, 400);
    }

    if (
      !body ||
      typeof body !== "object" ||
      !("title" in body) ||
      typeof body.title !== "string"
    ) {
      return json({ error: "Titre du projet manquant." }, 400);
    }

    const title = body.title.trim();

    if (!title || title.length > 200) {
      return json(
        { error: "Le titre doit contenir entre 1 et 200 caractères." },
        400,
      );
    }

    // 3. Accéder à la base de données côté serveur.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: "Configuration serveur manquante." }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    // 4. Vérifier le rôle réel de l'utilisateur.
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (
      profileError ||
      !profile ||
      (profile.role !== "Auteur" && profile.role !== "Editeur")
    ) {
      return json({ error: "Profil Thélyson incomplet ou non autorisé." }, 403);
    }

    // 5. Respecter la distinction auteur / éditeur.
    const creator =
      profile.role === "Editeur"
        ? { publisher_id: userId }
        : { author_id: userId };

    // 6. Créer le projet dans la même table que le site.
    const { data: newProject, error: creationError } = await supabase
      .from("projects")
      .insert({
        title,
        ...creator,
      })
      .select("id, title, created_at")
      .single();

    if (creationError || !newProject) {
      return json({ error: "Impossible de créer le projet." }, 500);
    }

    return json({ project: newProject }, 201);
  } catch {
    return json({ error: "Erreur lors de la création du projet." }, 500);
  }
}
