"use client";

// NOUVEAU : Import de 'use' depuis react
import { useEffect, useState, use } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { jsPDF } from "jspdf";
import JSZip from "jszip"; // <-- CETTE LIGNE EST INDISPENSABLE
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

  // NOUVEAU : Fonction pour générer le lien de téléchargement sécurisé
  const handleDownload = async (storagePath: string) => {
    if (!storagePath) return alert("Fichier introuvable.");

    try {
      const token = await getToken();
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );

      // Création d'une URL temporaire valide 60 secondes seulement
      const { data, error } = await supabase.storage
        .from("manuscripts")
        .createSignedUrl(storagePath, 60);

      if (error) throw error;

      // Ouvre le lien pour déclencher le téléchargement du document
      if (data?.signedUrl) {
        window.open(data.signedUrl, "_blank");
      }
    } catch (error) {
      console.error("Erreur de téléchargement :", error);
      alert("Impossible d'accéder au document sécurisé.");
    }
  };

  const [isZipping, setIsZipping] = useState(false); // Pour afficher un état de chargement

  const handleDownloadAll = async () => {
    if (versions.length === 0) return alert("Aucun fichier à télécharger.");
    setIsZipping(true);

    try {
      const token = await getToken();
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );

      // 1. Extraire tous les chemins de stockage des versions de ce projet
      const paths = versions.map((v) => v.storage_path).filter(Boolean);

      // 2. Demander à Supabase de générer des URL signées pour TOUS ces chemins d'un coup
      const { data: urlsData, error } = await supabase.storage
        .from("manuscripts")
        .createSignedUrls(paths, 60);

      if (error) throw error;

      // 3. Initialiser la création du dossier ZIP
      const zip = new JSZip();

      // 4. Télécharger chaque fichier et l'ajouter au ZIP
      // (Nous utilisons une boucle for...of pour gérer l'asynchrone proprement)
      for (let i = 0; i < urlsData.length; i++) {
        const item = urlsData[i];
        if (!item.signedUrl) continue;

        // On télécharge le contenu du fichier
        const response = await fetch(item.signedUrl);
        const blob = await response.blob();

        // On récupère le nom original du fichier à partir de son chemin
        // Exemple: "user_123/mon-brouillon.pdf" -> "mon-brouillon.pdf"
        const fileName = paths[i].split("/").pop() || `document_${i}`;

        // Pour éviter d'écraser des fichiers qui auraient le même nom, on ajoute le numéro de version
        const versionNumber = versions.length - i;
        const finalFileName = `V${versionNumber}_${fileName}`;

        // Ajout au dossier ZIP
        zip.file(finalFileName, blob);
      }

      // 5. Générer l'archive finale et déclencher le téléchargement
      const zipContent = await zip.generateAsync({ type: "blob" });

      // Petite astuce native pour forcer le téléchargement du blob sans librairie supplémentaire
      const downloadUrl = window.URL.createObjectURL(zipContent);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `Archive_Projet_${project?.title || "Complet"}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl); // Nettoyage de la mémoire
    } catch (error) {
      console.error("Erreur lors de la création de l'archive :", error);
      alert("Impossible de créer l'archive ZIP.");
    } finally {
      setIsZipping(false);
    }
  };

  const generateCertificate = (version: any) => {
    // Initialisation du document A4
    const doc = new jsPDF();

    // Titre du document
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("CERTIFICAT D'ANTÉRIORITÉ", 105, 30, { align: "center" });

    // Sous-titre / Explication légale
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text(
      "Ce document atteste de l'existence et de l'intégrité d'une œuvre littéraire",
      105,
      40,
      { align: "center" },
    );
    doc.text(
      "à une date certaine, via un ancrage sur la blockchain publique Polygon.",
      105,
      45,
      { align: "center" },
    );

    // Ligne de séparation
    doc.setLineWidth(0.5);
    doc.line(20, 55, 190, 55);

    // Détails de l'œuvre
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Projet : ${project?.title || "Non renseigné"}`, 20, 70);

    const dateAncrage = new Date(version.created_at).toLocaleString("fr-FR");
    doc.text(`Date d'ancrage : ${dateAncrage}`, 20, 80);

    // Bloc : Empreinte cryptographique
    doc.setFont("helvetica", "bold");
    doc.text("Empreinte cryptographique (Hash SHA-256) :", 20, 100);
    doc.setFont("courier", "normal");
    doc.setFontSize(10);
    // On découpe le hash s'il est trop long pour la page
    const splitHash = doc.splitTextToSize(version.file_hash, 170);
    doc.text(splitHash, 20, 108);

    // Bloc : Preuve Blockchain
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Identifiant de transaction (Blockchain Polygon) :", 20, 130);
    doc.setFont("courier", "normal");
    doc.setFontSize(10);

    if (version.blockchain_tx_id) {
      doc.text(version.blockchain_tx_id, 20, 138);

      // Lien cliquable dans le PDF vers l'explorateur public
      const verificationUrl = `https://amoy.polygonscan.com/tx/${version.blockchain_tx_id}`;
      doc.setTextColor(0, 0, 255); // Texte en bleu
      doc.text(
        "-> Cliquer ici pour vérifier la transaction sur l'explorateur public",
        20,
        150,
      );
      doc.link(20, 146, 170, 5, { url: verificationUrl });
    } else {
      doc.setTextColor(255, 0, 0);
      doc.text("Ancrage en cours de validation...", 20, 138);
    }

    // Pied de page
    doc.setTextColor(150, 150, 150);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Certificat généré par [Nom de votre application]", 105, 280, {
      align: "center",
    });

    // Déclenchement du téléchargement
    doc.save(`Certificat_${project?.title}_Version.pdf`);
  };

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

        <div className="flex gap-3">
          {/* NOUVEAU BOUTON TELECHARGER TOUT */}
          {versions.length > 0 && (
            <button
              onClick={handleDownloadAll}
              disabled={isZipping}
              className="bg-gray-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-gray-900 transition disabled:bg-gray-400"
            >
              {isZipping ? "Création du .zip..." : "↓ Tout télécharger"}
            </button>
          )}

          <Link
            href={`/dashboard/upload?projectId=${projectId}`}
            className="bg-green-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-green-700 transition"
          >
            + Ajouter une version
          </Link>
        </div>
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

                    {/* NOUVEAU : Bouton de téléchargement du fichier original */}
                    {version.storage_path && (
                      <div className="mt-4 pt-4 border-t border-gray-100">
                        <button
                          onClick={() => handleDownload(version.storage_path)}
                          className="text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2"
                        >
                          ↓ Télécharger le document original
                        </button>
                        <button
                          onClick={() => generateCertificate(version)}
                          className="text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-4 py-2 rounded-lg transition-colors inline-flex items-center gap-2 mt-2"
                        >
                          📄 Obtenir le certificat PDF
                        </button>
                      </div>
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
