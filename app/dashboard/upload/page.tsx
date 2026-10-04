"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";

export default function UploadPage() {
  const { getToken, userId } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string>("");
  const [projectId, setProjectId] = useState<string>(""); // Temporaire pour le test

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !userId || !projectId) {
      setStatus(
        "Veuillez sélectionner un fichier et renseigner l'ID du projet.",
      );
      return;
    }

    setStatus("Upload en cours...");

    try {
      // 1. Récupération du jeton Clerk
      const token = await getToken();

      // 2. Initialisation sécurisée de Supabase
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      );

      // 3. Lien avec le bucket Supabase : on envoie le fichier local
      const storagePath = `${userId}/${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("manuscripts")
        .upload(storagePath, file, {
          upsert: false,
        });

      if (uploadError) throw uploadError;

      // 4. Lien avec la base de données : on enregistre la version
      const { error: dbError } = await supabase.from("versions").insert([
        {
          project_id: projectId,
          storage_path: storagePath,
          file_hash: "en_attente_calcul_J8", // En attendant la suite
        },
      ]);

      if (dbError) throw dbError;

      setStatus(
        "Fichier uploadé et version enregistrée avec succès dans le coffre-fort !",
      );
      setFile(null);
    } catch (error: any) {
      console.error(error);
      setStatus(`Erreur : ${error.message}`);
    }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Déposer un brouillon</h1>

      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <form onSubmit={handleUpload} className="flex flex-col gap-6">
          {/* Section temporaire : l'ID du projet */}
          <div>
            <label className="block text-sm font-medium mb-2">
              ID du projet (UUID) :
            </label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="Ex: 550e8400-e29b-41d4-a716-446655440000"
              className="w-full border p-2 rounded"
            />
            <p className="text-xs text-gray-500 mt-1">
              Nécessaire car la table versions exige un project_id.
            </p>
          </div>

          {/* Lien 1 : Fichiers locaux de l'ordinateur */}
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

          {/* Lien 2 : Déclenchement de l'envoi vers le bucket */}
          <button
            type="submit"
            disabled={!file || !projectId}
            className="bg-blue-600 text-white p-3 rounded-lg font-medium disabled:bg-gray-300 hover:bg-blue-700 transition-colors"
          >
            Uploader vers le coffre-fort
          </button>
        </form>

        {status && (
          <div
            className={`mt-4 p-4 rounded ${status.includes("Erreur") ? "bg-red-50 text-red-700" : "bg-green-50 text-green-700"}`}
          >
            {status}
          </div>
        )}
      </div>
    </div>
  );
}
