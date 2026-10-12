"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export type PendingInvitation = {
  id: string;
  projectId: string;
  projectTitle: string;
  inviterName: string;
  invitedAs: "Auteur" | "Editeur";
  createdAt: string;
};

type InvitationRow = {
  id: string;
  project_id: string;
  inviter_id: string;
  created_at: string;
};

type ProjectRow = {
  id: string;
  title: string;
  author_id: string | null;
  publisher_id: string | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  company_name: string | null;
};

type RpcResponse = {
  success: boolean;
  message: string;
  project_id?: string;
};

type ActionResult =
  | { success: true; message: string }
  | { success: false; error: string };

// Client Supabase privilégié : serveur uniquement.
function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

// ==================================================
// 1. RÉCUPÉRER MES INVITATIONS
// ==================================================

export async function getMyPendingInvitations(): Promise<PendingInvitation[]> {
  const { userId } = await auth();

  if (!userId) {
    return [];
  }

  const supabase = createAdminClient();

  // Uniquement les invitations destinées
  // à l'utilisateur Clerk actuellement connecté.
  const { data, error } = await supabase
    .from("project_invitations")
    .select("id, project_id, inviter_id, created_at")
    .eq("invitee_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Erreur invitations :", error);
    throw new Error("Impossible de charger les invitations.");
  }

  const invitations = (data ?? []) as InvitationRow[];

  if (invitations.length === 0) {
    return [];
  }

  // Récupérer uniquement les titres des projets.
  const projectIds = [...new Set(invitations.map((item) => item.project_id))];

  const { data: projectsData, error: projectsError } = await supabase
    .from("projects")
    .select("id, title, author_id, publisher_id")
    .in("id", projectIds);

  if (projectsError) throw projectsError;

  const projects = (projectsData ?? []) as ProjectRow[];

  const projectMap = new Map(projects.map((project) => [project.id, project]));

  // Récupérer les noms des expéditeurs.
  const inviterIds = [...new Set(invitations.map((item) => item.inviter_id))];

  const { data: profilesData, error: profilesError } = await supabase
    .from("profiles")
    .select("id, full_name, company_name")
    .in("id", inviterIds);

  if (profilesError) throw profilesError;

  const profiles = (profilesData ?? []) as ProfileRow[];

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));

  // Construire une réponse limitée aux données
  // nécessaires pour afficher les notifications.
  return invitations.flatMap((invitation) => {
    const project = projectMap.get(invitation.project_id);

    if (!project) return [];

    const profile = profileMap.get(invitation.inviter_id);

    let invitedAs: "Auteur" | "Editeur";

    if (project.author_id === invitation.inviter_id) {
      invitedAs = "Editeur";
    } else if (project.publisher_id === invitation.inviter_id) {
      invitedAs = "Auteur";
    } else {
      return [];
    }

    const inviterName =
      invitedAs === "Auteur"
        ? profile?.company_name || profile?.full_name
        : profile?.full_name || profile?.company_name;

    return [
      {
        id: invitation.id,
        projectId: invitation.project_id,
        projectTitle: project.title,
        inviterName: inviterName || "Utilisateur Thélyson",
        invitedAs,
        createdAt: invitation.created_at,
      },
    ];
  });
}

// ==================================================
// 2. ACCEPTER OU REFUSER UNE INVITATION
// ==================================================

export async function respondToInvitation(
  invitationId: string,
  decision: "accept" | "decline",
): Promise<ActionResult> {
  const { userId } = await auth();

  if (!userId) {
    return {
      success: false,
      error: "Vous devez être connecté.",
    };
  }

  // Validation des paramètres fournis par le navigateur.
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (
    !uuidPattern.test(invitationId) ||
    (decision !== "accept" && decision !== "decline")
  ) {
    return {
      success: false,
      error: "Demande invalide.",
    };
  }

  try {
    const supabase = createAdminClient();

    // L'identité du destinataire provient de Clerk,
    // jamais d'un paramètre envoyé par le client.
    const { data, error } = await supabase.rpc(
      "respond_to_project_invitation",
      {
        p_invitation_id: invitationId,
        p_invitee_id: userId,
        p_accept: decision === "accept",
      },
    );

    if (error) throw error;

    const response = data as RpcResponse | null;

    if (!response?.success) {
      return {
        success: false,
        error: response?.message || "Impossible de traiter cette invitation.",
      };
    }

    // Actualiser les pages après la décision.
    revalidatePath("/dashboard");

    if (response.project_id) {
      revalidatePath(`/dashboard/projects/${response.project_id}`);
    }

    return {
      success: true,
      message: response.message,
    };
  } catch (error: unknown) {
    console.error("Erreur réponse invitation :", error);

    return {
      success: false,
      error: "Une erreur technique est survenue. Veuillez réessayer.",
    };
  }
}
