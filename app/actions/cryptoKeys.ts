"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

type Result = { success: true } | { success: false; error: string };

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

// Vérifier le format de la clé publique.
function validatePublicKey(jwk: JsonWebKey): JsonWebKey | null {
  if (
    !jwk ||
    jwk.kty !== "RSA" ||
    typeof jwk.n !== "string" ||
    jwk.e !== "AQAB"
  ) {
    return null;
  }

  // Refuser toute clé contenant des paramètres privés.
  const privateFields = ["d", "p", "q", "dp", "dq", "qi", "oth"];

  if (
    privateFields.some((field) =>
      Object.prototype.hasOwnProperty.call(jwk, field),
    )
  ) {
    return null;
  }

  // Validation de l'encodage du module RSA.
  if (!/^[A-Za-z0-9_-]+$/.test(jwk.n)) {
    return null;
  }

  const modulus = Buffer.from(jwk.n, "base64url");

  if (modulus.length !== 384 || modulus.toString("base64url") !== jwk.n) {
    return null;
  }

  // Ne conserver que les champs publics autorisés.
  return {
    kty: "RSA",
    n: jwk.n,
    e: jwk.e,
    alg: "RSA-OAEP-256",
    ext: true,
    key_ops: ["wrapKey"],
  };
}

// Lire la clé publique du compte Clerk connecté.
export async function getMyRegisteredPublicKey(): Promise<JsonWebKey | null> {
  const { userId } = await auth();

  if (!userId) {
    throw new Error("Utilisateur non connecté.");
  }

  const supabase = adminClient();

  const { data, error } = await supabase
    .from("user_crypto_keys")
    .select("public_key_jwk")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Impossible de consulter l'identité cryptographique.");
  }

  return data?.public_key_jwk || null;
}

// Enregistrer la clé publique une seule fois.
export async function registerMyPublicKey(
  submittedKey: JsonWebKey,
): Promise<Result> {
  const { userId } = await auth();

  if (!userId) {
    return {
      success: false,
      error: "Utilisateur non connecté.",
    };
  }

  const publicKey = validatePublicKey(submittedKey);

  if (!publicKey) {
    return {
      success: false,
      error: "Clé publique invalide.",
    };
  }

  const supabase = adminClient();

  try {
    // Vérifier si une clé existe déjà.
    const { data: existing, error: readError } = await supabase
      .from("user_crypto_keys")
      .select("public_key_jwk")
      .eq("user_id", userId)
      .maybeSingle();

    if (readError) throw readError;

    if (existing) {
      const stored = existing.public_key_jwk as JsonWebKey;

      if (stored.n === publicKey.n && stored.e === publicKey.e) {
        return { success: true };
      }

      return {
        success: false,
        error:
          "Une autre identité cryptographique est déjà enregistrée pour ce compte.",
      };
    }

    // Enregistrer uniquement la clé publique.
    const { error: insertError } = await supabase
      .from("user_crypto_keys")
      .insert({
        user_id: userId,
        public_key_jwk: publicKey,
        algorithm: "RSA-OAEP-3072-SHA256",
      });

    if (insertError) {
      // En cas de création simultanée dans deux onglets,
      // vérifier quelle clé a été enregistrée.
      if (insertError.code === "23505") {
        const { data: concurrent } = await supabase
          .from("user_crypto_keys")
          .select("public_key_jwk")
          .eq("user_id", userId)
          .maybeSingle();

        if (
          concurrent?.public_key_jwk?.n === publicKey.n &&
          concurrent?.public_key_jwk?.e === publicKey.e
        ) {
          return { success: true };
        }

        return {
          success: false,
          error:
            "Une autre clé a été enregistrée simultanément. Aucune clé n'a été remplacée.",
        };
      }

      throw insertError;
    }

    return { success: true };
  } catch (error) {
    console.error("Erreur création clé publique :", error);

    return {
      success: false,
      error:
        "Impossible d'enregistrer la clé publique. Vérifiez que votre profil Thélyson existe.",
    };
  }
}
