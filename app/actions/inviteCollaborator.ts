"use server";

import { auth, clerkClient } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

type InvitationResult =
  | { success: true; message: string }
  | { success: false; error: string };

export async function addCollaborator(
  projectId: string,
  email: string,
): Promise<InvitationResult> {
  // 1. Vérifier l'authentification Clerk
  const { userId } = await auth();

  if (!userId) {
    return {
      success: false,
      error: "Vous devez être connecté.",
    };
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (
    !projectId ||
    normalizedEmail.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
  ) {
    return {
      success: false,
      error: "Projet ou adresse e-mail invalide.",
    };
  }

  try {
    // 2. Initialiser Supabase côté serveur
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    // 3. Vérifier le projet et les droits du demandeur
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, author_id, publisher_id")
      .eq("id", projectId)
      .maybeSingle();

    if (projectError) throw projectError;

    if (!project) {
      return {
        success: false,
        error: "Ce projet est introuvable.",
      };
    }

    const isAuthor = project.author_id === userId;
    const isPublisher = project.publisher_id === userId;

    if (!isAuthor && !isPublisher) {
      return {
        success: false,
        error: "Vous n'avez pas les droits sur ce projet.",
      };
    }

    if (isAuthor && isPublisher) {
      return {
        success: false,
        error: "Configuration des rôles du projet invalide.",
      };
    }

    // 4. Déterminer le rôle recherché
    const inviterRole = isAuthor ? "Auteur" : "Editeur";
    const expectedRole = isAuthor ? "Editeur" : "Auteur";

    // Vérifier que le rôle du demandeur est cohérent
    const { data: inviterProfile, error: inviterError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .maybeSingle();

    if (inviterError) throw inviterError;

    if (inviterProfile?.role !== inviterRole) {
      return {
        success: false,
        error: "Votre profil ne correspond pas au rôle du projet.",
      };
    }

    // 5. Vérifier que la place recherchée est libre
    const occupied = isAuthor
      ? project.publisher_id !== null
      : project.author_id !== null;

    if (occupied) {
      return {
        success: false,
        error: "Ce projet possède déjà les deux collaborateurs.",
      };
    }

    // 6. Expirer les anciennes invitations dépassées
    const now = new Date().toISOString();

    const { error: expirationError } = await supabase
      .from("project_invitations")
      .update({ status: "expired" })
      .eq("project_id", projectId)
      .eq("status", "pending")
      .lte("expires_at", now);

    if (expirationError) throw expirationError;

    // Vérifier qu'aucune invitation active n'existe
    const { data: pendingInvitation, error: pendingError } = await supabase
      .from("project_invitations")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingError) throw pendingError;

    if (pendingInvitation) {
      return {
        success: false,
        error: "Une invitation est déjà en attente pour ce projet.",
      };
    }

    // 7. Rechercher le collaborateur dans Clerk
    const client = await clerkClient();

    const users = await client.users.getUserList({
      emailAddress: [normalizedEmail],
    });

    // Vérifier l'e-mail exact et son statut de vérification
    const invitedUser = users.data.find((user) =>
      user.emailAddresses.some(
        (address) =>
          address.emailAddress.toLowerCase() === normalizedEmail &&
          address.verification?.status === "verified",
      ),
    );

    if (!invitedUser) {
      return {
        success: false,
        error:
          "Aucun compte Thélyson éligible avec cette adresse e-mail vérifiée.",
      };
    }

    if (invitedUser.id === userId) {
      return {
        success: false,
        error: "Vous ne pouvez pas vous inviter vous-même.",
      };
    }

    // 8. Vérifier le rôle du destinataire
    const { data: invitedProfile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", invitedUser.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (!invitedProfile) {
      return {
        success: false,
        error: "Ce collaborateur doit d'abord compléter son profil.",
      };
    }

    if (invitedProfile.role !== expectedRole) {
      return {
        success: false,
        error:
          expectedRole === "Auteur"
            ? "Le collaborateur doit posséder un compte Auteur."
            : "Le collaborateur doit posséder un compte Éditeur.",
      };
    }

    // 9. CRÉER L'INVITATION
    // Les colonnes author_id et publisher_id
    // du projet ne sont PAS modifiées ici.

    const { error: invitationError } = await supabase
      .from("project_invitations")
      .insert({
        project_id: projectId,
        inviter_id: userId,
        invitee_id: invitedUser.id,
        status: "pending",
      });

    if (invitationError) {
      // Protection supplémentaire contre les
      // invitations concurrentes pour le même projet
      if (invitationError.code === "23505") {
        return {
          success: false,
          error: "Une invitation est déjà en attente pour ce projet.",
        };
      }

      throw invitationError;
    }

    // 10. Actualiser les pages concernées
    revalidatePath("/dashboard");
    revalidatePath(`/dashboard/projects/${projectId}`);

    return {
      success: true,
      message: "Invitation créée. En attente de l'accord du collaborateur.",
    };
  } catch (error: unknown) {
    console.error("Erreur d'invitation :", error);

    return {
      success: false,
      error:
        "Une erreur technique est survenue lors de la création de l'invitation.",
    };
  }
}
