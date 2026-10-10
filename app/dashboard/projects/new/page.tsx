"use client";

import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

export default function NewProjectPage() {
  const { getToken, userId } = useAuth();
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !userId) return;

    setIsSubmitting(true);
    setStatus("Création du projet en cours...");

    try {
      const token = await getToken();
      if (!token) throw new Error("Veuillez vous reconnecter.");
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      );

      // Lire le rôle enregistré dans le profil de l'utilisateur connecté.
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();

      if (profileError) throw profileError;
      if (!profile || (profile.role !== "Auteur" && profile.role !== "Editeur")) {
        throw new Error("Veuillez compléter votre profil avant de créer un projet.");
      }

      const creator =
        profile.role === "Editeur"
          ? { publisher_id: userId }
          : { author_id: userId };

      // Assigner le créateur à la colonne correspondant à son rôle.
      const { error } = await supabase.from("projects").insert([
        {
          title: title.trim(),
          ...creator,
        },
      ]);

      if (error) throw error;

      setStatus(
        "Projet créé avec succès ! Redirection vers l'espace de dépôt...",
      );

      // Redirection automatique vers la page d'upload après 1,5 seconde
      setTimeout(() => {
        router.push("/dashboard/upload");
      }, 1500);
    } catch (error: unknown) {
      console.error(error);
      setStatus(
        `Erreur : ${error instanceof Error ? error.message : "Impossible de créer le projet."}`,
      );
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-10 max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Créer un nouveau projet</h1>

      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <form onSubmit={handleCreateProject} className="flex flex-col gap-6">
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-700">
              Titre de l’œuvre :
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Le Seigneur des Anneaux"
              className="w-full border p-3 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              required
            />
          </div>

          <button
            type="submit"
            disabled={!title.trim() || isSubmitting}
            className="bg-blue-600 text-white p-3 rounded-lg font-medium disabled:bg-gray-300 hover:bg-blue-700 transition-colors"
          >
            {isSubmitting ? "Création..." : "Créer le projet"}
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
