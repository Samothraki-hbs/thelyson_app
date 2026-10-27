"use client";

import { use, useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { jsPDF } from "jspdf";

import ProjectKeySharing from "@/components/ProjectKeySharing";

import JSZip from "jszip";
import InviteCollaborator from "@/components/InviteCollaborator";
import {
  getDecryptedManuscript,
  saveBlobToComputer,
  type DownloadableVersion,
} from "@/utils/downloadEncryptedManuscript";

type Project = {
  title: string;
  author_id: string | null;
  publisher_id: string | null;
};

type Profile = {
  id: string;
  full_name: string | null;
  company_name: string | null;
};

type ManuscriptVersion = DownloadableVersion & {
  created_at: string;
  blockchain_tx_id: string | null;
};

// Évite les caractères interdits dans les noms des fichiers téléchargés.
function safeDownloadName(name: string): string {
  return name.replace(/[\\/\x00-\x1f\x7f<>:\"|?*]/g, "_").trim() || "manuscrit";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Une erreur inattendue est survenue.";
}

export default function ProjectTimeline({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { getToken, userId } = useAuth();
  const { projectId } = use(params);

  const [versions, setVersions] = useState<ManuscriptVersion[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [author, setAuthor] = useState<Profile | null>(null);
  const [publisher, setPublisher] = useState<Profile | null>(null);
  const [availableVersionKeys, setAvailableVersionKeys] = useState<Set<string>>(
    new Set(),
  );
  const [downloadingVersionId, setDownloadingVersionId] = useState<
    string | null
  >(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState("");

  // Une version n'est récupérable que si sa clé chiffrée a été
  // partagée avec le compte connecté. La clé privée reste locale.
  const hasAccessKey = (version: ManuscriptVersion) =>
    availableVersionKeys.has(version.id);

  const isEncryptedVersion = (version: ManuscriptVersion) =>
    version.encryption_version === 1 && Boolean(version.encryption_iv);

  const canDownloadVersion = (version: ManuscriptVersion) =>
    Boolean(version.storage_path) &&
    isEncryptedVersion(version) &&
    hasAccessKey(version);

  const canDownloadAll =
    versions.length > 0 && versions.every(canDownloadVersion);
  const isDownloading = downloadingVersionId !== null || isZipping;

  // Télécharger le .enc via Supabase, puis déchiffrer le manuscrit
  // exclusivement dans le navigateur du destinataire autorisé.
  const handleDownload = async (version: ManuscriptVersion) => {
    if (!userId || isDownloading) return;
    setDownloadError("");

    if (!canDownloadVersion(version)) {
      setDownloadError(
        "La clé de déchiffrement de cette version n'est pas encore disponible pour votre compte.",
      );
      return;
    }

    setDownloadingVersionId(version.id);
    try {
      const originalBlob = await getDecryptedManuscript(
        version,
        userId,
        getToken,
      );
      saveBlobToComputer(originalBlob, safeDownloadName(version.file_name));
    } catch (error: unknown) {
      console.error("Téléchargement déchiffré :", error);
      setDownloadError(getErrorMessage(error));
    } finally {
      setDownloadingVersionId(null);
    }
  };

  // Télécharger et déchiffrer TOUTES les versions AVANT
  // de construire l'archive ZIP en mémoire, côté navigateur.
  const handleDownloadAll = async () => {
    if (!userId || isDownloading) return;
    setDownloadError("");

    if (!canDownloadAll) {
      setDownloadError(
        "Certaines versions ne disposent pas encore d'une clé de déchiffrement accessible. L'archive complète n'est pas disponible.",
      );
      return;
    }

    setIsZipping(true);
    setZipProgress("");
    try {
      const zip = new JSZip();

      for (const [index, version] of versions.entries()) {
        setZipProgress(`Déchiffrement ${index + 1} / ${versions.length}...`);
        const originalBlob = await getDecryptedManuscript(
          version,
          userId,
          getToken,
        );
        const number = versions.length - index;
        const filename = safeDownloadName(
          version.file_name || `manuscrit_${number}.pdf`,
        );
        zip.file(`V${number}_${filename}`, originalBlob);
      }

      setZipProgress("Création de l'archive ZIP...");
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const projectTitle = safeDownloadName(project?.title || "Projet");
      saveBlobToComputer(zipBlob, `Thélyson_${projectTitle}.zip`);
    } catch (error: unknown) {
      console.error("Création ZIP déchiffré :", error);
      // On n'envoie jamais un ZIP incomplet lorsque l'une des versions échoue.
      setDownloadError(`Archive non créée : ${getErrorMessage(error)}`);
    } finally {
      setIsZipping(false);
      setZipProgress("");
    }
  };

  const generateCertificate = (version: ManuscriptVersion) => {
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
    doc.text(`Date de dépôt : ${dateAncrage}`, 20, 80);

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
    doc.text("Certificat généré par Thélyson", 105, 280, {
      align: "center",
    });

    // Déclenchement du téléchargement
    doc.save(`Certificat_${project?.title}_Version.pdf`);
  };

  useEffect(() => {
    let active = true;

    const fetchProjectAndVersions = async () => {
      setLoading(true);
      setLoadError("");
      try {
        if (!userId)
          throw new Error("Connectez-vous pour consulter ce projet.");
        const token = await getToken();
        if (!token)
          throw new Error("Votre session a expiré. Veuillez vous reconnecter.");

        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { global: { headers: { Authorization: `Bearer ${token}` } } },
        );

        const { data: projectData, error: projectError } = await supabase
          .from("projects")
          .select("title, author_id, publisher_id")
          .eq("id", projectId)
          .single();
        if (projectError || !projectData)
          throw new Error("Projet introuvable ou accès refusé.");

        const ids = [projectData.author_id, projectData.publisher_id].filter(
          (value): value is string => Boolean(value),
        );

        let profiles: Profile[] = [];
        if (ids.length) {
          const { data, error } = await supabase
            .from("profiles")
            .select("id, full_name, company_name")
            .in("id", ids);
          if (error) throw error;
          profiles = data ?? [];
        }

        const { data: versionsData, error: versionsError } = await supabase
          .from("versions")
          .select(
            "id, storage_path, file_name, file_hash, created_at, blockchain_tx_id, encryption_iv, encryption_version",
          )
          .eq("project_id", projectId)
          .order("created_at", { ascending: false });
        if (versionsError) throw versionsError;
        const fetchedVersions = (versionsData ?? []) as ManuscriptVersion[];

        let keyIds: string[] = [];
        if (fetchedVersions.length > 0) {
          const { data: keyData, error: keyError } = await supabase
            .from("version_access_keys")
            .select("version_id")
            .eq("user_id", userId)
            .in(
              "version_id",
              fetchedVersions.map((v) => v.id),
            );
          if (keyError) throw keyError;
          keyIds = (keyData ?? []).map((item) => item.version_id as string);
        }

        if (active) {
          setProject(projectData);
          setVersions(fetchedVersions);
          setAvailableVersionKeys(new Set(keyIds));
          setAuthor(
            profiles.find((p) => p.id === projectData.author_id) ?? null,
          );
          setPublisher(
            profiles.find((p) => p.id === projectData.publisher_id) ?? null,
          );
        }
      } catch (error: unknown) {
        console.error("Chargement projet :", error);
        if (active) setLoadError(getErrorMessage(error));
      } finally {
        if (active) setLoading(false);
      }
    };

    void fetchProjectAndVersions();
    return () => {
      active = false;
    };
  }, [projectId, getToken, userId]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl p-10 text-sm text-zinc-500">
        Chargement de la frise...
      </div>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <Link href="/dashboard" className="text-sm text-zinc-500">
          ← Retour aux projets
        </Link>
        <p
          role="alert"
          className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {loadError}
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-zinc-900">
      <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10">
        {/* NAVIGATION */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <span aria-hidden="true">←</span>
          Retour aux projets
        </Link>

        {/* EN-TÊTE DU PROJET */}
        <header className="mt-8 mb-8 border-b border-zinc-200 pb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Projet littéraire
          </p>

          <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">
            {project?.title || "Projet inconnu"}
          </h1>

          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Consultez les versions de votre manuscrit et leurs preuves
            d'antériorité.
          </p>

          {/* ACTIONS DU PROJET */}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            {/* Invitation d'un collaborateur */}
            {project && (!project.author_id || !project.publisher_id) && (
              <InviteCollaborator projectId={projectId} />
            )}

            {/* Téléchargement de toutes les versions */}

            {/* Téléchargement de toutes les versions */}
            {versions.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadAll}
                disabled={isDownloading || !canDownloadAll}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true">↓</span>
                {isZipping
                  ? zipProgress || "Préparation du ZIP..."
                  : "Tout télécharger"}
              </button>
            )}

            {/* Ajout d'une nouvelle version */}
            <Link
              href={`/dashboard/upload?projectId=${projectId}`}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
            >
              <span className="text-lg leading-none" aria-hidden="true">
                +
              </span>
              Ajouter une version
            </Link>
          </div>

          {!canDownloadAll && versions.length > 0 && (
            <p className="mt-4 text-xs leading-5 text-amber-700">
              Certains documents ne sont pas encore déchiffrables depuis ce
              compte. Leurs clés devront être partagées par le collaborateur qui
              les possède avant de créer une archive complète.
            </p>
          )}

          {downloadError && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {downloadError}
            </p>
          )}
        </header>

        {/* COLLABORATEURS */}
        <section aria-label="Collaborateurs du projet" className="mb-14">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Auteur */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-emerald-700">
                Auteur
              </p>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-lg text-emerald-700">
                  <span aria-hidden="true">✎</span>
                </div>

                <div className="min-w-0">
                  <p className="break-words text-sm font-semibold text-zinc-900">
                    {author
                      ? author.full_name || author.company_name
                      : "Chargement..."}
                  </p>

                  <p className="mt-1 text-xs text-zinc-500">
                    Créateur du manuscrit
                  </p>
                </div>
              </div>
            </div>

            {/* Éditeur */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5">
              <p className="mb-4 text-xs font-semibold uppercase tracking-widest text-amber-700">
                Éditeur
              </p>

              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-lg text-amber-700">
                  <span aria-hidden="true">▤</span>
                </div>

                <div className="min-w-0">
                  {publisher ? (
                    <>
                      <p className="break-words text-sm font-semibold text-zinc-900">
                        {publisher.company_name || publisher.full_name}
                      </p>

                      <p className="mt-1 text-xs text-zinc-500">
                        Maison d'édition
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-zinc-500">
                        Aucun éditeur associé
                      </p>

                      <p className="mt-1 text-xs text-zinc-400">
                        En attente d'association
                      </p>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PARTAGE CRYPTOGRAPHIQUE AUTOMATIQUE */}
        <ProjectKeySharing projectId={projectId} />

        {/* HISTORIQUE DES VERSIONS */}
        <section>
          <div className="mb-8 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
              Historique des versions
            </h2>

            <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {versions.length} {versions.length > 1 ? "versions" : "version"}
            </span>
          </div>

          {versions.length === 0 ? (
            /* ÉTAT VIDE */
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
              <div className="mb-4 text-3xl" aria-hidden="true">
                📄
              </div>

              <h3 className="text-lg font-semibold text-zinc-900">
                Aucune version déposée
              </h3>

              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                Ajoutez votre premier brouillon pour commencer à constituer
                l'historique de votre manuscrit.
              </p>

              <Link
                href={`/dashboard/upload?projectId=${projectId}`}
                className="mt-6 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
              >
                + Ajouter un brouillon
              </Link>
            </div>
          ) : (
            /* FRISE CHRONOLOGIQUE */
            <div className="relative ml-3 border-l border-zinc-200">
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
                  <div
                    key={version.id}
                    className="relative mb-5 ml-7 last:mb-0"
                  >
                    {/* Point de la frise */}
                    <span
                      aria-hidden="true"
                      className="absolute -left-[35px] top-7 h-3.5 w-3.5 rounded-full border-[3px] border-[#FAFAFA] bg-zinc-500"
                    />

                    {/* CARTE DE VERSION */}
                    <article className="rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 sm:p-6">
                      {/* EN-TÊTE DE LA VERSION */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-zinc-400">
                            Version {versions.length - index}
                          </p>

                          <h3 className="break-words text-lg font-semibold tracking-tight text-zinc-900">
                            {version.file_name ||
                              `Version ${versions.length - index}`}
                          </h3>
                        </div>

                        <time
                          dateTime={version.created_at}
                          className="shrink-0 text-xs text-zinc-400"
                        >
                          {date}
                        </time>
                      </div>

                      {/* INFORMATIONS TECHNIQUES */}
                      <div className="mt-6 space-y-5">
                        {/* Empreinte SHA-256 */}
                        <div>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                            Empreinte SHA-256
                          </p>

                          <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-3">
                            <p className="break-all font-mono text-xs leading-5 text-zinc-600">
                              {version.file_hash}
                            </p>
                          </div>
                        </div>

                        {/* Ancrage blockchain */}

                        {/* Ancrage blockchain */}
                        <div>
                          {version.blockchain_tx_id ? (
                            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4">
                              <div className="mb-3 flex flex-wrap items-center gap-2">
                                <span
                                  className="text-violet-600"
                                  aria-hidden="true"
                                >
                                  ◈
                                </span>

                                <h4 className="text-sm font-semibold text-zinc-900">
                                  Ancrage blockchain
                                </h4>

                                <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-[10px] font-medium text-violet-700">
                                  Transaction référencée
                                </span>
                              </div>

                              <p className="mb-3 text-xs leading-5 text-zinc-600">
                                Une transaction blockchain est associée à cette
                                version du manuscrit.
                              </p>

                              <a
                                href={`https://amoy.polygonscan.com/tx/${version.blockchain_tx_id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-semibold text-violet-700 transition-colors hover:text-violet-900 hover:underline"
                              >
                                Consulter sur Polygonscan
                                <span aria-hidden="true">↗</span>
                              </a>

                              <p className="mt-2 break-all font-mono text-[10px] leading-5 text-zinc-400">
                                {version.blockchain_tx_id}
                              </p>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                              <h4 className="mb-2 text-sm font-semibold text-zinc-700">
                                Ancrage blockchain
                              </h4>

                              <div className="flex items-center gap-2">
                                <span className="h-2 w-2 rounded-full bg-amber-400" />
                                <span className="text-xs text-zinc-500">
                                  Ancrage en attente
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ACTIONS DE LA VERSION */}
                      {version.storage_path && (
                        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-5">
                          {/* Télécharger le document original */}
                          <button
                            type="button"
                            onClick={() => handleDownload(version)}
                            disabled={
                              !canDownloadVersion(version) || isDownloading
                            }
                            title={
                              !canDownloadVersion(version)
                                ? "Accès à la clé de ce document en attente"
                                : undefined
                            }
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 transition-colors hover:border-blue-300 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <span aria-hidden="true">↓</span>
                            {downloadingVersionId === version.id
                              ? "Déchiffrement..."
                              : "Télécharger l'original"}
                          </button>
                          {!canDownloadVersion(version) && (
                            <p className="w-full text-xs text-amber-700">
                              {isEncryptedVersion(version)
                                ? "Accès au document en attente : sa clé n'a pas encore été partagée avec vous."
                                : "Cette version ne dispose pas des paramètres de chiffrement attendus."}
                            </p>
                          )}

                          {/* Télécharger le certificat PDF */}
                          <button
                            type="button"
                            onClick={() => generateCertificate(version)}
                            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition-colors hover:border-red-300 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                          >
                            <span aria-hidden="true">▤</span>
                            Certificat PDF
                          </button>
                        </div>
                      )}
                    </article>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
