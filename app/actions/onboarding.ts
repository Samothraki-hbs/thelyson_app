"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export async function completeProfile(formData: FormData) {
  // 1. Vérifier que l'utilisateur est bien connecté via Clerk
  const { userId } = await auth();
  if (!userId) throw new Error("Non autorisé");

  // 2. Récupérer les champs du formulaire
  const role = formData.get("role") as string;
  const fullName = formData.get("fullName") as string;
  const companyName = formData.get("companyName") as string;

  // 3. Initialiser Supabase en mode admin
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 4. Mettre à jour le profil
  const { error } = await supabase.from("profiles").upsert({
    id: userId,
    role: role,
    full_name: role === "Auteur" ? fullName : null,
    company_name: role === "Editeur" ? companyName : null,
  });

  if (error) {
    console.error("Erreur de mise à jour:", error);
    throw new Error("Impossible de sauvegarder le profil");
  }

  // 5. Rafraîchir la page pour faire disparaître le formulaire
  revalidatePath("/dashboard");
}
