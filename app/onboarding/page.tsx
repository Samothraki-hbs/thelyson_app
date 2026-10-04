"use client"; // permet d'utiliser des hooks React côté client

import { useState } from "react";
import { useRouter } from "next/navigation"; // hook pour la navigation
import { completeProfile } from "../actions/onboarding"; // Assure-toi que le chemin est correct

export default function OnboardingPage() {
  const router = useRouter(); // Hook pour la navigation
  const [role, setRole] = useState<"Auteur" | "Editeur" | "">("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    const formData = new FormData(e.currentTarget);

    try {
      await completeProfile(formData);
      // Redirection vers le dashboard une fois le profil complété avec succès
      router.push("/dashboard");
    } catch (err) {
      console.error("Erreur lors de l'enregistrement :", err);
      alert("Erreur lors de la mise à jour.");
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-20 p-6 bg-white rounded-lg shadow-md">
      <h1 className="text-2xl font-bold mb-6">Bienvenue ! Qui êtes-vous ?</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block mb-2 font-medium">Je suis un :</label>
          <select
            name="role"
            required
            className="w-full border p-2 rounded"
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
          >
            <option value="" disabled>
              Sélectionnez un rôle
            </option>
            <option value="Auteur">Auteur (Je dépose des manuscrits)</option>
            <option value="Editeur">
              Éditeur (Je consulte des manuscrits)
            </option>
          </select>
        </div>

        {role === "Auteur" && (
          <div>
            <label className="block mb-2 font-medium">
              Nom complet (ou nom de plume)
            </label>
            <input
              type="text"
              name="fullName"
              required
              className="w-full border p-2 rounded"
            />
          </div>
        )}

        {role === "Editeur" && (
          <div>
            <label className="block mb-2 font-medium">
              Nom de la maison d'édition
            </label>
            <input
              type="text"
              name="companyName"
              required
              className="w-full border p-2 rounded"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={isLoading}
          className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:bg-blue-400"
        >
          {isLoading ? "Enregistrement..." : "Terminer mon inscription"}
        </button>
      </form>
    </div>
  );
}
