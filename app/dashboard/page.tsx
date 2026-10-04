import Link from "next/link"; // importation du composant Link qui sert à la navigation entre les pages
import { auth } from "@clerk/nextjs/server";
import { UserButton, SignOutButton } from "@clerk/nextjs"; // 1. Importation des boutons Clerk
import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export default async function DashboardPage() {
  const { userId } = await auth();
  if (!userId) redirect("/");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (!profile || !profile.role) {
    redirect("/onboarding");
  }

  return (
    <div className="p-10">
      {/* 2. En-tête avec titre et bouton de profil */}
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <h1 className="text-3xl font-bold">Tableau de bord</h1>

        {/* OPTION 1 : L'avatar de profil avec menu de déconnexion intégré */}
        <UserButton />
      </div>

      <p className="mt-4">
        Connecté en tant que : <strong>{profile.role}</strong>
      </p>
      <p>Nom enregistré : {profile.full_name || profile.company_name}</p>
      <Link
        href="/dashboard/projects/new"
        className="inline-block px-6 py-3 bg-green-600 text-white font-medium rounded-lg hover:bg-green-700 transition-colors mr-4"
      >
        + Nouveau projet
      </Link>
      {/* OPTION 2 : Un bouton de déconnexion personnalisé et isolé */}
      <div className="mt-8 bg-blue-50 p-6 rounded-lg border border-blue-100">
        <h2 className="text-xl font-semibold mb-4">Gestion des manuscrits</h2>
        <Link
          href="/dashboard/upload"
          className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          + Uploader un fichier
        </Link>
      </div>

      <div className="mt-12">
        <SignOutButton>
          <button className="px-4 py-2 bg-red-600 text-white font-medium rounded hover:bg-red-700 transition-colors">
            Me déconnecter
          </button>
        </SignOutButton>
      </div>
    </div>
  );
}
