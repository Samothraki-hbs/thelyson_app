"use client";

import { useState, Suspense } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useSearchParams, useRouter } from "next/navigation";
// NOUVEAU : Import de notre Server Action Tatum
import { anchorDocumentToBlockchain } from "@/app/actions/anchor";

// 1. La fonction de hachage cryptographique
async function calculateSHA256(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}

function UploadForm() {
  const { getToken, userId } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const prefilledProjectId = searchParams.get("projectId");

  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !userId || !prefilledProjectId) {
      setStatus("Erreur : Fichier manquant ou ID du projet introuvable.");
      return;
    }

    setIsUploading(true);
    setStatus("Calcul de l'empreinte et sécurisation en cours...");

    try {
      const token = await getToken();
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );

      // 1. Calcul du Hash avant l'envoi
      const fileHash = await calculateSHA256(file);
      console.log("Empreinte unique du document :", fileHash);

      // 2. Nettoyage du nom du fichier
      const safeFileName = file.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "-")
        .toLowerCase();

      const storagePath = `${userId}/${safeFileName}`;

      // 3. Envoi vers le bucket Supabase
      setStatus("Upload du document dans le coffre-fort...");
      const { error: uploadError } = await supabase.storage
        .from("manuscripts")
        .upload(storagePath, file, { upsert: false });

      if (uploadError) throw uploadError;

      // 4. MODIFICATION : Enregistrement initial en base pour obtenir l'ID
      setStatus("Préparation du certificat...");
      const { data: versionData, error: dbError } = await supabase
        .from("versions")
        .insert([
          {
            project_id: prefilledProjectId,
            storage_path: storagePath,
            file_hash: fileHash,
            // blockchain_tx_id est vide pour l'instant
          },
        ])
        .select(); // Le .select() est crucial pour récupérer l'ID généré par Supabase

      if (dbError) throw dbError;

      const nouvelleVersionId = versionData[0].id;

      // 5. MODIFICATION : Ancrage sur la blockchain via Tatum (Server Action)
      setStatus("Ancrage sur la blockchain Polygon en cours...");
      const anchorResult = await anchorDocumentToBlockchain(
        nouvelleVersionId,
        fileHash,
      );

      if (!anchorResult.success) {
        throw new Error(`Erreur d'ancrage : ${anchorResult.error}`);
      }

      // 6. Succès et redirection
      setStatus(`Fichier sécurisé et ancré ! Réf TX : ${anchorResult.txId}`);

      // Redirection retardée pour laisser le temps de lire le message
      setTimeout(() => router.push("/dashboard"), 3000);
    } catch (error: any) {
      console.error(error);
      setStatus(`Erreur : ${error.message}`);
      setIsUploading(false);
    }
  };

  if (!prefilledProjectId) {
    return (
      <div className="p-10 text-center text-red-600">
        Veuillez sélectionner un projet depuis le tableau de bord pour uploader
        un fichier.
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl border shadow-sm">
      <form onSubmit={handleUpload} className="flex flex-col gap-6">
        <div>
          <label className="block text-sm font-medium mb-2">
            Fichier (.pdf ou .docx) :
          </label>
          <input
            type="file"
            accept=".pdf,.docx"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="w-full border p-2 rounded"
          />
        </div>

        <button
          type="submit"
          disabled={!file || isUploading}
          className="bg-blue-600 text-white p-3 rounded-lg font-medium disabled:bg-gray-300 hover:bg-blue-700 transition-colors"
        >
          {isUploading
            ? "Sécurisation en cours..."
            : "Uploader et certifier le brouillon"}
        </button>
      </form>

      {status && (
        <div
          className={`mt-4 p-4 rounded font-mono text-sm ${status.includes("Erreur") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700 break-all"}`}
        >
          {status}
        </div>
      )}
    </div>
  );
}

export default function UploadPage() {
  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Déposer un brouillon</h1>
      <Suspense
        fallback={
          <div className="p-10 text-center">Chargement de l'interface...</div>
        }
      >
        <UploadForm />
      </Suspense>
    </div>
  );
}
