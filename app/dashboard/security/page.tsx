"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

import {
  getLocalIdentity,
  createLocalIdentity,
  testLocalEncryption,
} from "@/utils/localCryptoKeys";

import {
  getMyRegisteredPublicKey,
  registerMyPublicKey,
} from "@/app/actions/cryptoKeys";

export default function SecurityPage() {
  const { userId, isLoaded } = useAuth();

  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState("");

  const handleInitialize = async () => {
    if (!userId || loading) return;

    setLoading(true);
    setSuccess(false);
    setMessage("Vérification du coffre-fort...");

    try {
      // Vérifier si une clé est déjà enregistrée.
      const registeredKey = await getMyRegisteredPublicKey();

      // Rechercher la clé privée sur cet appareil.
      let identity = await getLocalIdentity(userId);

      if (registeredKey) {
        if (!identity) {
          throw new Error(
            "Ce compte possède déjà une identité cryptographique, mais sa clé privée est absente de ce navigateur.",
          );
        }

        if (
          identity.publicKeyJwk.n !== registeredKey.n ||
          identity.publicKeyJwk.e !== registeredKey.e
        ) {
          throw new Error(
            "Les clés locales ne correspondent pas à celles enregistrées pour ce compte.",
          );
        }
      } else {
        // Première utilisation : créer les clés si nécessaire.
        identity = identity || (await createLocalIdentity(userId));

        const result = await registerMyPublicKey(identity.publicKeyJwk);

        if (!result.success) {
          throw new Error(result.error);
        }
      }

      // Relire la clé depuis IndexedDB.
      const persistedIdentity = await getLocalIdentity(userId);

      if (!persistedIdentity) {
        throw new Error("La clé privée n'a pas été conservée.");
      }

      // Tester le chiffrement et le déchiffrement.
      const testOk = await testLocalEncryption(persistedIdentity);

      if (!testOk) {
        throw new Error("Le test de chiffrement a échoué.");
      }

      setSuccess(true);
      setMessage(
        "Votre coffre-fort cryptographique est prêt. Le test de chiffrement et de déchiffrement a réussi.",
      );
    } catch (error: unknown) {
      setMessage(
        error instanceof Error ? error.message : "Une erreur est survenue.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-zinc-900">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href="/dashboard"
          className="text-sm text-zinc-500 hover:text-zinc-900"
        >
          ← Retour au tableau de bord
        </Link>

        <header className="mb-8 mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Sécurité
          </p>

          <h1 className="text-3xl font-semibold tracking-tight">
            Protection de votre coffre-fort
          </h1>

          <p className="mt-4 text-sm leading-6 text-zinc-500">
            Thélyson prépare votre appareil pour protéger vos futurs manuscrits.
          </p>
        </header>

        <section className="rounded-xl border border-zinc-200 bg-white p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-50 text-xl text-emerald-700">
              ♢
            </div>

            <div>
              <h2 className="font-semibold">Protection locale</h2>
              <p className="mt-1 text-xs text-zinc-500">
                Configuration automatique
              </p>
            </div>
          </div>

          <p className="mb-6 text-sm leading-6 text-zinc-600">
            Aucune manipulation technique n'est nécessaire. Le chiffrement sera
            effectué automatiquement sur votre appareil.
          </p>

          <button
            type="button"
            onClick={handleInitialize}
            disabled={!isLoaded || !userId || loading}
            className="w-full rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
          >
            {loading ? "Configuration en cours..." : "Vérifier la protection"}
          </button>

          {message && (
            <div
              role={success ? "status" : "alert"}
              className={`mt-5 rounded-lg border p-4 text-sm leading-6 ${
                success
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-zinc-200 bg-zinc-50 text-zinc-700"
              }`}
            >
              {success ? "✓ " : ""}
              {message}
            </div>
          )}
        </section>

        <p className="mt-6 text-xs leading-5 text-amber-700">
          Version de test : les clés privées ne sont pas encore récupérables sur
          un autre appareil. Ne déposez pas de documents confidentiels tant que
          le système complet n'est pas validé.
        </p>
      </div>
    </main>
  );
}
