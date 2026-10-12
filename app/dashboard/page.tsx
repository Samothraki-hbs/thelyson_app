import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton, SignOutButton } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import PendingInvitations from "@/components/PendingInvitations";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Récupération du profil
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profile || !profile.role) {
    redirect("/onboarding");
  }

  // 2. NOUVEAU : Récupération des projets de l'auteur (classés du plus récent au plus ancien)
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .or(`author_id.eq.${userId},publisher_id.eq.${userId}`)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-zinc-900">
      <div className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-10">
        {/* En-tête du tableau de bord */}
        <header className="mb-12">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Espace {profile.role}
          </p>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Tableau de bord
          </h1>

          <p className="mt-3 text-sm leading-6 text-zinc-500">
            Bienvenue,{" "}
            <span className="font-medium text-zinc-800">
              {profile.full_name || profile.company_name}
            </span>
            . Retrouvez vos manuscrits et leurs différentes versions.
          </p>
        </header>

        {/* INVITATIONS REÇUES */}
        <PendingInvitations />

        {/* Section des projets */}
        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-5">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold tracking-tight">
                Mes projets
              </h2>
              <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-600">
                {projects?.length ?? 0}
              </span>
            </div>

            <Link
              href="/dashboard/projects/new"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
            >
              <span className="text-lg leading-none">+</span>
              Nouveau projet
            </Link>
          </div>

          {projects && projects.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {projects.map((project) => (
                <article
                  key={project.id}
                  className="flex min-h-[220px] flex-col rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
                >
                  {/* Icône du document */}
                  <div className="mb-5">
                    <span
                      className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-100 text-xl"
                      aria-hidden="true"
                    >
                      📄
                    </span>
                  </div>

                  {/* Accès à l'historique */}
                  <Link
                    href={`/dashboard/projects/${project.id}`}
                    className="group block flex-1"
                  >
                    <h3 className="break-words text-lg font-semibold tracking-tight group-hover:underline group-hover:underline-offset-4">
                      {project.title}
                    </h3>

                    <p className="mt-2 text-sm text-zinc-400">
                      Créé le{" "}
                      {new Date(project.created_at).toLocaleDateString("fr-FR")}
                    </p>

                    <p className="mt-4 text-sm text-zinc-600 transition-colors group-hover:text-zinc-900">
                      Voir l'historique <span aria-hidden="true">↗</span>
                    </p>
                  </Link>

                  {/* Dépôt d'une nouvelle version */}
                  <div className="mt-5 border-t border-zinc-100 pt-4">
                    <Link
                      href={`/dashboard/upload?projectId=${project.id}`}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-100"
                    >
                      <span className="text-base leading-none">+</span>
                      Ajouter un brouillon
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            /* Aucun projet */
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center">
              <div className="mb-4 text-3xl">📄</div>

              <h3 className="text-lg font-semibold">
                Votre bibliothèque est vide
              </h3>

              <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-zinc-500">
                Créez votre premier projet pour commencer à conserver les
                versions de votre manuscrit.
              </p>

              <Link
                href="/dashboard/projects/new"
                className="mt-6 inline-flex rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700"
              >
                Créer mon premier projet
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
