import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { UserButton, SignOutButton } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

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
    <div className="p-10 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <h1 className="text-3xl font-bold">Tableau de bord</h1>
        <UserButton />
      </div>

      <div className="mb-8 p-4 bg-gray-50 rounded-lg">
        <p>
          Connecté en tant que : <strong>{profile.role}</strong>
        </p>
        <p>Nom enregistré : {profile.full_name || profile.company_name}</p>
      </div>

      {/* 3. Section des projets */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Mes Projets</h2>
          <Link
            href="/dashboard/projects/new"
            className="px-4 py-2 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors"
          >
            + Nouveau projet
          </Link>
          {/* Le bouton central d'upload a été retiré d'ici */}
        </div>

        {projects && projects.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex flex-col justify-between p-5 border rounded-xl shadow-sm bg-white hover:shadow-md transition-shadow group"
              >
                {/* 1. Zone principale cliquable (mène à la frise) */}
                <Link
                  href={`/dashboard/projects/${project.id}`}
                  className="block flex-grow mb-4"
                >
                  <h3 className="font-bold text-lg mb-2 group-hover:text-blue-600 transition-colors">
                    {project.title}
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Créé le :{" "}
                    {new Date(project.created_at).toLocaleDateString("fr-FR")}
                  </p>
                  <span className="text-sm text-blue-600 font-medium">
                    Voir l'historique →
                  </span>
                </Link>

                {/* 2. Bouton d'action rapide (Upload) */}
                <div className="pt-4 border-t mt-auto">
                  <Link
                    href={`/dashboard/upload?projectId=${project.id}`}
                    className="block text-center w-full py-2 bg-blue-50 text-blue-600 font-medium rounded-lg border border-blue-200 hover:bg-blue-100 transition-colors"
                  >
                    + Ajouter un brouillon
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-300 rounded-xl">
            <p className="text-gray-500 mb-4">
              Vous n'avez pas encore créé de projet.
            </p>
            <Link
              href="/dashboard/projects/new"
              className="text-green-600 font-medium hover:underline"
            >
              Commencer par créer votre première œuvre
            </Link>
          </div>
        )}
      </div>

      <div className="mt-12 border-t pt-8">
        <SignOutButton>
          <button className="px-4 py-2 text-sm bg-red-100 text-red-600 font-medium rounded hover:bg-red-200 transition-colors">
            Me déconnecter
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
