"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

export async function addCollaborator(projectId: string, email: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "Non autorisé." };

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Vérifier le projet et la place de l'utilisateur actuel
    const { data: project, error: fetchError } = await supabase
      .from("projects")
      .select("author_id, publisher_id")
      .eq("id", projectId)
      .single();

    if (fetchError || !project) throw new Error("Projet introuvable.");

    // Déterminer le rôle de l'utilisateur qui fait l'invitation
    const isCurrentUserAuthor = project.author_id === userId;
    const isCurrentUserPublisher = project.publisher_id === userId;

    if (!isCurrentUserAuthor && !isCurrentUserPublisher) {
      return {
        success: false,
        error: "Vous n'avez pas les droits sur ce projet.",
      };
    }

    // 2. Chercher le collaborateur invité dans Clerk via son email
    const client = await clerkClient();
    const users = await client.users.getUserList({ emailAddress: [email] });

    if (users.data.length === 0) {
      return {
        success: false,
        error: "Ce collaborateur doit d'abord se créer un compte.",
      };
    }

    const invitedUserId = users.data[0].id;

    // 3. Assigner le collaborateur à la bonne place (la place opposée)
    const updateData = isCurrentUserAuthor
      ? { publisher_id: invitedUserId }
      : { author_id: invitedUserId };

    const { error: updateError } = await supabase
      .from("projects")
      .update(updateData)
      .eq("id", projectId);

    if (updateError) throw updateError;

    return { success: true, message: "Collaborateur ajouté avec succès !" };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
