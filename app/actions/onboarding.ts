"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export async function completeProfile(formData: FormData) {
  const { userId } = await auth();
  if (!userId) throw new Error("Non autorisé");

  // Valider les données côté serveur.
  const role = formData.get("role");

  if (role !== "Auteur" && role !== "Editeur") {
    throw new Error("Rôle invalide.");
  }

  const fullNameValue = formData.get("fullName");
  const companyNameValue = formData.get("companyName");

  const fullName =
    typeof fullNameValue === "string" ? fullNameValue.trim() : "";

  const companyName =
    typeof companyNameValue === "string" ? companyNameValue.trim() : "";

  if (role === "Auteur" && !fullName) {
    throw new Error("Le nom est obligatoire.");
  }

  if (role === "Editeur" && !companyName) {
    throw new Error("La maison d'édition est obligatoire.");
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // Vérifier le rôle déjà enregistré.
  const { data: existing, error: readError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (readError) {
    throw new Error("Impossible de vérifier le profil.");
  }

  // Un rôle déjà défini ne peut pas être changé
  // depuis le formulaire d'inscription.
  if (existing?.role && existing.role !== role) {
    throw new Error("Le rôle du profil ne peut pas être modifié.");
  }

  const { error } = await supabase.from("profiles").upsert({
    id: userId,
    role,
    full_name: role === "Auteur" ? fullName : null,
    company_name: role === "Editeur" ? companyName : null,
  });

  if (error) {
    console.error("Erreur de mise à jour :", error);
    throw new Error("Impossible de sauvegarder le profil.");
  }

  revalidatePath("/dashboard");
}
