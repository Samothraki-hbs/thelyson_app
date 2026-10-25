"use client";

import { useState, Suspense } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { encryptManuscript } from "@/utils/manuscriptCrypto";

import { getLocalIdentity, createLocalIdentity } from "@/utils/localCryptoKeys";

import {
  getMyRegisteredPublicKey,
  registerMyPublicKey,
} from "@/app/actions/cryptoKeys";

import { saveEncryptedVersion } from "@/app/actions/encryptedVersions";

import {
  getDecryptedManuscript,
  saveBlobToComputer,
  type DownloadableVersion,
} from "@/utils/downloadEncryptedManuscript";

import { anchorDocumentToBlockchain } from "@/app/actions/anchor";

type Status = {
  type: "info" | "success" | "warning" | "error";
  message: string;
};

const MAX_FILE_SIZE = 20 * 1024 * 1024;

function UploadForm() {
  const { getToken, userId } = useAuth();
  const searchParams = useSearchParams();

  const projectId = searchParams.get("projectId");

  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);

  const [status, setStatus] = useState<Status | null>(null);

  const [lastVersion, setLastVersion] = useState<DownloadableVersion | null>(
    null,
  );

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file || !userId || !projectId || isUploading) {
      return;
    }

    if (!/\.(pdf|docx)$/i.test(file.name)) {
      setStatus({
        type: "error",
        message: "Seuls les fichiers PDF et DOCX sont acceptés.",
      });
      return;
    }

    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      setStatus({
        type: "error",
        message:
          "Le fichier doit être non vide et ne pas dépasser 20 Mo pour ce test.",
      });
      return;
    }

    setIsUploading(true);
    setLastVersion(null);

    setStatus({
      type: "info",
      message: "Préparation de votre coffre-fort...",
    });

    try {
      const token = await getToken();

      if (!token) {
        throw new Error("Veuillez vous reconnecter.");
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        },
      );

      // 1. Vérifier l'identité cryptographique.
      const registeredKey = await getMyRegisteredPublicKey();

      let identity = await getLocalIdentity(userId);

      if (registeredKey) {
        if (
          !identity ||
          identity.publicKeyJwk.n !== registeredKey.n ||
          identity.publicKeyJwk.e !== registeredKey.e
        ) {
          throw new Error(
            "Ce navigateur ne possède pas la clé privée correspondant à votre coffre-fort.",
          );
        }
      } else {
        identity = identity || (await createLocalIdentity(userId));

        const registration = await registerMyPublicKey(identity.publicKeyJwk);

        if (!registration.success) {
          throw new Error(registration.error);
        }
      }

      if (!identity) {
        throw new Error(
          "Impossible de préparer votre identité cryptographique.",
        );
      }

      // 2. Chiffrer le manuscrit localement.
      setStatus({
        type: "info",
        message: "Chiffrement du manuscrit sur votre appareil...",
      });

      const { encryptedBlob, encryptionKey, ivBase64, fileHash } =
        await encryptManuscript(file);

      // 3. Protéger la clé AES avec la clé publique.
      const publicKey = await crypto.subtle.importKey(
        "jwk",
        identity.publicKeyJwk,
        {
          name: "RSA-OAEP",
          hash: "SHA-256",
        },
        true,
        ["wrapKey"],
      );

      const wrappedBuffer = await crypto.subtle.wrapKey(
        "raw",
        encryptionKey,
        publicKey,
        "RSA-OAEP",
      );

      const wrappedKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(wrappedBuffer)),
      );

      // 4. Créer un nom de stockage opaque.
      // Le nom réel reste dans les métadonnées de la version.
      const storagePath = `${projectId}/${crypto.randomUUID()}.enc`;

      // 5. Envoyer UNIQUEMENT le fichier chiffré.
      setStatus({
        type: "info",
        message: "Enregistrement du document chiffré...",
      });

      const { error: uploadError } = await supabase.storage
        .from("manuscripts")
        .upload(storagePath, encryptedBlob, {
          contentType: "application/octet-stream",
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // 6. Enregistrer la version et sa clé chiffrée.
      const saved = await saveEncryptedVersion({
        projectId,
        storagePath,
        fileName: file.name,
        fileHash,
        ivBase64,
        wrappedKeyBase64,
      });

      if (!saved.success) {
        throw new Error(
          `${saved.error} Le fichier chiffré a été envoyé, mais son enregistrement n'est pas terminé.`,
        );
      }

      const version: DownloadableVersion = {
        id: saved.versionId,
        storage_path: storagePath,
        file_name: file.name,
        file_hash: fileHash,
        encryption_iv: ivBase64,
        encryption_version: 1,
      };

      setLastVersion(version);

      // 7. Ancrer le SHA-256 ORIGINAL sur Polygon.
      setStatus({
        type: "info",
        message: "Ancrage blockchain en cours...",
      });

      try {
        const anchorResult = await anchorDocumentToBlockchain(
          saved.versionId,
          fileHash,
        );

        if (!anchorResult.success) {
          throw new Error(anchorResult.error || "Ancrage non confirmé.");
        }

        setStatus({
          type: "success",
          message:
            "Manuscrit chiffré et enregistré. Transaction blockchain transmise. Vous pouvez maintenant tester le téléchargement.",
        });
      } catch {
        setStatus({
          type: "warning",
          message:
            "Le manuscrit chiffré est enregistré, mais l'ancrage blockchain n'a pas été confirmé. Ne redéposez pas le document : son ancrage devra être vérifié ou relancé.",
        });
      }
    } catch (error: unknown) {
      console.error("Erreur de dépôt :", error);

      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de déposer le manuscrit.",
      });
    } finally {
      setIsUploading(false);
    }
  };

  // TEST : restituer le document original depuis Supabase.
  const handleTestDownload = async () => {
    if (!lastVersion || !userId || isTesting) return;

    setIsTesting(true);

    try {
      const originalBlob = await getDecryptedManuscript(
        lastVersion,
        userId,
        getToken,
      );

      saveBlobToComputer(originalBlob, lastVersion.file_name);

      setStatus({
        type: "success",
        message:
          "Test réussi : le manuscrit a été téléchargé, déchiffré localement et son empreinte SHA-256 a été vérifiée.",
      });
    } catch (error: unknown) {
      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Échec du test de déchiffrement.",
      });
    } finally {
      setIsTesting(false);
    }
  };

  if (!projectId) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        Sélectionnez d'abord un projet depuis votre tableau de bord.
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-200 bg-white">
      <div className="border-b border-zinc-100 px-6 py-5">
        <h2 className="text-sm font-semibold text-zinc-900">
          Nouvelle version
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Votre document sera chiffré avant son envoi.
        </p>
      </div>

      <form onSubmit={handleUpload} className="space-y-6 p-6">
        <div>
          <label
            htmlFor="manuscript-file"
            className="mb-3 block text-sm font-medium text-zinc-800"
          >
            Choisir un manuscrit
          </label>

          <input
            id="manuscript-file"
            type="file"
            accept=".pdf,.docx"
            disabled={isUploading}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setLastVersion(null);
              setStatus(null);
            }}
            className="block w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700 file:mr-4 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-zinc-700 hover:file:bg-zinc-100"
          />
          <p className="mt-2 text-xs text-zinc-400">
            PDF ou DOCX, 20 Mo maximum pour ce prototype.
          </p>
        </div>

        <div className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4">
          <span className="text-emerald-700">◈</span>

          <p className="text-xs leading-5 text-emerald-800">
            <strong>Protection automatique.</strong> Le manuscrit sera chiffré
            sur votre appareil. Seule sa version chiffrée sera envoyée au
            stockage.
          </p>
        </div>

        <button
          type="submit"
          disabled={!file || isUploading}
          className="w-full rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
        >
          {isUploading
            ? "Sécurisation en cours..."
            : "Déposer et certifier le manuscrit"}
        </button>
      </form>

      {(status || lastVersion) && (
        <div className="space-y-4 border-t border-zinc-100 p-6">
          {status && (
            <div
              role={status.type === "error" ? "alert" : "status"}
              aria-live="polite"
              className={`rounded-lg border p-4 text-sm leading-6 ${
                status.type === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : status.type === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : status.type === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-zinc-200 bg-zinc-50 text-zinc-600"
              }`}
            >
              {status.message}
            </div>
          )}

          {lastVersion && (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleTestDownload}
                disabled={isTesting || isUploading}
                className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50"
              >
                {isTesting ? "Déchiffrement..." : "↓ Tester le téléchargement"}
              </button>

              <Link
                href={`/dashboard/projects/${projectId}`}
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
              >
                Voir le projet
              </Link>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function UploadPage() {
  return (
    <main className="min-h-screen bg-[#FAFAFA] text-zinc-900">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          href="/dashboard"
          className="text-sm font-medium text-zinc-500 hover:text-zinc-900"
        >
          ← Retour aux projets
        </Link>

        <header className="mb-8 mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Coffre-fort
          </p>

          <h1 className="text-3xl font-semibold tracking-tight">
            Déposer un manuscrit
          </h1>

          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Conservez une nouvelle version de votre œuvre et préparez sa preuve
            d'antériorité.
          </p>
        </header>

        <Suspense
          fallback={<p className="text-sm text-zinc-500">Chargement...</p>}
        >
          <UploadForm />
        </Suspense>
      </div>
    </main>
  );
}
