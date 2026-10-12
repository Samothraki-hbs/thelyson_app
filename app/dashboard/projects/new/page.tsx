"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { addCollaborator } from "@/app/actions/inviteCollaborator";

type UserRole = "Auteur" | "Editeur";

type Status = {
  type: "info" | "warning" | "error";
  message: string;
};

export default function NewProjectPage() {
  const { getToken, userId, isLoaded } = useAuth();
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [collaboratorEmail, setCollaboratorEmail] = useState("");
  const [role, setRole] = useState<UserRole | null>(null);
  const [isLoadingRole, setIsLoadingRole] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  // 1. Charger le rôle de l'utilisateur connecté.
  useEffect(() => {
    if (!isLoaded) return;

    let cancelled = false;

    const loadRole = async () => {
      if (!userId) {
        setIsLoadingRole(false);
        setStatus({
          type: "error",
          message: "Veuillez vous connecter.",
        });
        return;
      }

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

        const { data: profile, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();

        if (error) throw error;

        if (
          !profile ||
          (profile.role !== "Auteur" && profile.role !== "Editeur")
        ) {
          throw new Error(
            "Veuillez compléter votre profil avant de créer un projet.",
          );
        }

        if (!cancelled) {
          setRole(profile.role as UserRole);
        }
      } catch (error: unknown) {
        if (!cancelled) {
          setStatus({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : "Impossible de charger votre profil.",
          });
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRole(false);
        }
      }
    };

    void loadRole();

    return () => {
      cancelled = true;
    };
  }, [getToken, userId, isLoaded]);

  // 2. Créer le projet et éventuellement associer un collaborateur.
  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !userId || !role || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setStatus({
      type: "info",
      message: "Création du projet en cours...",
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

      // Assigner le créateur à son rôle.
      const creator =
        role === "Editeur" ? { publisher_id: userId } : { author_id: userId };

      // Créer le projet et récupérer son identifiant.
      const { data: newProject, error } = await supabase
        .from("projects")
        .insert({
          title: title.trim(),
          ...creator,
        })
        .select("id")
        .single();

      if (error) throw error;

      if (!newProject) {
        throw new Error("Impossible de récupérer le nouveau projet.");
      }

      // 3. Associer le collaborateur si une adresse est renseignée.
      if (collaboratorEmail.trim()) {
        setStatus({
          type: "info",
          message: "Association du collaborateur...",
        });

        let collaboratorError: string | null = null;

        try {
          const result = await addCollaborator(
            newProject.id,
            collaboratorEmail.trim(),
          );

          if (!result.success) {
            collaboratorError = result.error;
          }
        } catch {
          collaboratorError =
            "Le service d'association est momentanément indisponible.";
        }

        if (collaboratorError) {
          // Le projet existe déjà : ne pas recommencer
          // sa création en cas d'échec de l'association.
          setStatus({
            type: "warning",
            message:
              "Le projet a bien été créé, mais le collaborateur " +
              "n'a pas pu être associé : " +
              collaboratorError +
              " Vous pourrez l'ajouter depuis la page du projet. " +
              "Redirection vers le tableau de bord...",
          });

          setTimeout(() => {
            router.replace("/dashboard");
          }, 4500);

          return;
        }
      }

      // 4. Retour au tableau de bord.
      router.replace("/dashboard");
    } catch (error: unknown) {
      console.error("Erreur de création :", error);

      setStatus({
        type: "error",
        message:
          error instanceof Error
            ? error.message
            : "Impossible de créer le projet.",
      });

      setIsSubmitting(false);
    }
  };

  // Couleurs et intitulés adaptés au rôle recherché.
  const isLinkingAuthor = role === "Editeur";

  const collaboratorLabel = isLinkingAuthor ? "auteur" : "éditeur";

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-zinc-900">
      <div className="mx-auto w-full max-w-3xl px-6 py-12 sm:px-10">
        {/* NAVIGATION */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <span aria-hidden="true">←</span>
          Retour aux projets
        </Link>

        {/* EN-TÊTE */}
        <header className="mb-10 mt-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Votre bibliothèque
          </p>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Nouveau projet
          </h1>

          <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-500">
            Créez une nouvelle œuvre littéraire et associez éventuellement un
            collaborateur à votre projet.
          </p>
        </header>

        {/* FORMULAIRE */}
        <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
          {/* En-tête du formulaire */}
          <div className="border-b border-zinc-100 px-6 py-5 sm:px-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-xl text-zinc-600">
                <span aria-hidden="true">▤</span>
              </div>

              <div>
                <h2 className="text-sm font-semibold text-zinc-900">
                  Informations du projet
                </h2>
                <p className="mt-1 text-xs text-zinc-400">
                  Création d'une nouvelle œuvre littéraire
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleCreateProject}>
            <div className="space-y-8 px-6 py-8 sm:px-8">
              {/* TITRE DE L'ŒUVRE */}
              <div>
                <label
                  htmlFor="project-title"
                  className="mb-2 block text-sm font-semibold text-zinc-800"
                >
                  Titre de l'œuvre
                  <span className="ml-1 text-red-500">*</span>
                </label>

                <input
                  id="project-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex. : Le Seigneur des Anneaux"
                  required
                  autoFocus
                  disabled={isSubmitting}
                  className="w-full rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-100 disabled:bg-zinc-50"
                />

                <p className="mt-2 text-xs leading-5 text-zinc-400">
                  Ce titre identifiera votre œuvre dans votre bibliothèque.
                </p>
              </div>

              {/* SÉPARATION */}
              <div className="border-t border-zinc-100" />

              {/* COLLABORATION */}
              <div>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-semibold text-zinc-900">
                    Collaboration
                  </h3>

                  <span className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-500">
                    Facultatif
                  </span>
                </div>

                <p className="mb-5 text-sm leading-6 text-zinc-500">
                  Vous pouvez associer dès maintenant un autre utilisateur
                  Thélyson à votre œuvre.
                </p>

                {isLoadingRole ? (
                  <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-5">
                    <p className="text-sm text-zinc-400">
                      Chargement de votre profil...
                    </p>
                  </div>
                ) : role ? (
                  /* Encadré dynamique auteur / éditeur */
                  <div
                    className={`rounded-xl border p-5 ${
                      isLinkingAuthor
                        ? "border-emerald-200 bg-emerald-50/60"
                        : "border-amber-200 bg-amber-50/60"
                    }`}
                  >
                    <div className="mb-4 flex items-center gap-3">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full text-lg ${
                          isLinkingAuthor
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-amber-100 text-amber-700"
                        }`}
                      >
                        <span aria-hidden="true">
                          {isLinkingAuthor ? "✎" : "▤"}
                        </span>
                      </div>

                      <div>
                        <p
                          className={`text-xs font-semibold uppercase tracking-widest ${
                            isLinkingAuthor
                              ? "text-emerald-700"
                              : "text-amber-700"
                          }`}
                        >
                          Associer un {collaboratorLabel}
                        </p>

                        <p className="mt-1 text-xs text-zinc-500">
                          À votre nouveau projet
                        </p>
                      </div>
                    </div>

                    <label
                      htmlFor="collaborator-email"
                      className="mb-2 block text-sm font-medium text-zinc-700"
                    >
                      Adresse e-mail du collaborateur
                    </label>

                    <input
                      id="collaborator-email"
                      type="email"
                      value={collaboratorEmail}
                      onChange={(e) => setCollaboratorEmail(e.target.value)}
                      placeholder={`E-mail de l'${collaboratorLabel}`}
                      disabled={isSubmitting}
                      className={`w-full rounded-lg border bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:ring-2 ${
                        isLinkingAuthor
                          ? "border-emerald-200 focus:border-emerald-400 focus:ring-emerald-100"
                          : "border-amber-200 focus:border-amber-400 focus:ring-amber-100"
                      }`}
                    />

                    <p className="mt-3 text-xs leading-5 text-zinc-500">
                      Le collaborateur doit posséder un compte Thélyson avec le
                      rôle{" "}
                      <span className="font-semibold">
                        {isLinkingAuthor ? "Auteur" : "Éditeur"}
                      </span>
                      .
                    </p>
                  </div>
                ) : null}

                <p className="mt-4 text-xs leading-5 text-zinc-400">
                  Vous pourrez également associer un collaborateur plus tard
                  depuis la page du projet.
                </p>
              </div>

              {/* MESSAGES D'ÉTAT */}
              {status && (
                <div
                  role={status.type === "error" ? "alert" : "status"}
                  aria-live="polite"
                  className={`rounded-lg border px-4 py-3 text-sm leading-6 ${
                    status.type === "error"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : status.type === "warning"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600"
                  }`}
                >
                  {status.message}
                </div>
              )}
            </div>

            {/* ACTIONS */}
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/60 px-6 py-5 sm:px-8">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
              >
                Annuler
              </Link>

              <button
                type="submit"
                disabled={
                  !title.trim() || !role || isLoadingRole || isSubmitting
                }
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
              >
                {isSubmitting ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    Création...
                  </>
                ) : (
                  <>
                    <span aria-hidden="true" className="text-lg leading-none">
                      +
                    </span>
                    Créer le projet
                  </>
                )}
              </button>
            </div>
          </form>
        </section>

        {/* NOTE INFORMATIVE */}
        <div className="mt-6 flex items-start gap-3 px-1">
          <span className="mt-0.5 text-zinc-400" aria-hidden="true">
            ◈
          </span>

          <p className="text-xs leading-6 text-zinc-400">
            Après la création, votre projet sera disponible dans votre tableau
            de bord. Vous pourrez y déposer les différentes versions de votre
            manuscrit et constituer leur historique d'antériorité.
          </p>
        </div>
      </div>
    </main>
  );
}
