"use client";

// NOUVEAU : Import de 'use' depuis react
import { useEffect, useState, use } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";

// NOUVEAU : Typage de la promesse
export default function ProjectTimeline({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { getToken } = useAuth();

  // NOUVEAU : Déballage (unwrapping) de la promesse avec React.use()
  const resolvedParams = use(params);
  const projectId = resolvedParams.projectId;

  const [versions, setVersions] = useState<any[]>([]);
  const [project, setProject] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProjectAndVersions() {
      try {
        const token = await getToken();
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { global: { headers: { Authorization: `Bearer ${token}` } } },
        );

        // Utilisation du projectId déballé
        const { data: projectData } = await supabase
          .from("projects")
          .select("title")
          .eq("id", projectId)
          .single();

        if (projectData) setProject(projectData);

        // Utilisation du projectId déballé
        const { data: versionsData } = await supabase
          .from("versions")
          .select("*")
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });

        if (versionsData) setVersions(versionsData);
      } catch (error) {
        console.error("Erreur de chargement:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchProjectAndVersions();
  }, [projectId, getToken]); // Remplacement de params.projectId par projectId dans les dépendances

  if (loading)
    return <div className="p-10 text-center">Chargement de la frise...</div>;

  return (
    <div className="p-10 max-w-3xl mx-auto">
      <div className="flex justify-between items-center mb-12">
        <div>
          <Link
            href="/dashboard"
            className="text-blue-600 hover:underline text-sm mb-2 inline-block"
          >
            ← Retour aux projets
          </Link>
          <h1 className="text-3xl font-bold">
            Projet : {project?.title || "Inconnu"}
          </h1>
        </div>

        {/* CORRECTION DE L'ERREUR ICI */}
        <Link
          href={`/dashboard/upload?projectId=${projectId}`}
          className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition"
        >
          + Ajouter une version
        </Link>
      </div>

      {versions.length === 0 ? (
        <div className="bg-gray-50 border p-6 rounded-lg text-center text-gray-500">
          Aucun brouillon n'a encore été déposé pour ce projet.
        </div>
      ) : (
        <div className="relative border-l-2 border-blue-200 ml-4 mt-6">
          {versions.map((version, index) => {
            const date = new Date(version.created_at).toLocaleDateString(
              "fr-FR",
              {
                day: "numeric",
                month: "long",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              },
            );

            return (
              <div key={version.id} className="mb-10 ml-8 relative">
                {/* Le point sur la frise */}
                <span className="absolute flex items-center justify-center w-4 h-4 bg-blue-600 rounded-full -left-[39px] top-1 ring-4 ring-white"></span>

                <div className="bg-white p-5 rounded-xl border shadow-sm hover:shadow-md transition">
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-bold text-lg text-gray-900">
                      Version {versions.length - index}
                    </h3>
                    <span className="text-sm text-gray-500 bg-gray-100 px-3 py-1 rounded-full">
                      {date}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-sm">
                    <p className="text-gray-600 flex flex-col">
                      <span className="font-semibold text-xs uppercase tracking-wide text-gray-500">
                        Empreinte (Hash)
                      </span>
                      <span className="font-mono bg-gray-50 p-1 rounded break-all">
                        {version.file_hash}
                      </span>
                    </p>

                    {version.blockchain_tx_id ? (
                      <p className="text-green-700 flex flex-col mt-3">
                        <span className="font-semibold text-xs uppercase tracking-wide">
                          Ancrage Blockchain
                        </span>
                        <a
                          href={`https://amoy.polygonscan.com/tx/${version.blockchain_tx_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-blue-600 hover:underline flex items-center gap-1 break-all"
                        >
                          {version.blockchain_tx_id} ↗
                        </a>
                      </p>
                    ) : (
                      <p className="text-amber-600 text-xs font-medium mt-2">
                        Ancrage en attente...
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
