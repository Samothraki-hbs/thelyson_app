"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

export type SentInvitationStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired";

export type SentInvitation = {
  id: string;
  projectId: string;
  projectTitle: string;
  recipientName: string;
  invitedAs: "Auteur" | "Editeur";
  status: SentInvitationStatus;
  createdAt: string;
};

type InvitationRow = {
  id: string;
  project_id: string;
  invitee_id: string;
  status: SentInvitationStatus;
  created_at: string;
  expires_at: string;
};

function adminClient() {
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

// ============================================
// 1. INVITATIONS ENVOYÉES
// ============================================

export async function getMySentInvitations(): Promise<SentInvitation[]> {
  const { userId } = await auth();

  if (!userId) return [];

  const supabase = adminClient();

  const { data, error } = await supabase
    .from("project_invitations")
    .select("id, project_id, invitee_id, status, created_at, expires_at")
    .eq("inviter_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("Invitations envoyées :", error);
    throw new Error("Impossible de charger les invitations.");
  }

  const invitations = (data ?? []) as InvitationRow[];

  if (invitations.length === 0) return [];

  const projectIds = [...new Set(invitations.map((i) => i.project_id))];

  const recipientIds = [...new Set(invitations.map((i) => i.invitee_id))];

  // Ne récupérer que les données nécessaires.
  const [projectsResult, profilesResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, title, author_id, publisher_id")
      .in("id", projectIds),

    supabase
      .from("profiles")
      .select("id, full_name, company_name")
      .in("id", recipientIds),
  ]);

  if (projectsResult.error) throw projectsResult.error;
  if (profilesResult.error) throw profilesResult.error;

  const projectMap = new Map((projectsResult.data ?? []).map((p) => [p.id, p]));

  const profileMap = new Map((profilesResult.data ?? []).map((p) => [p.id, p]));

  const now = Date.now();

  return invitations.flatMap((invitation) => {
    const project = projectMap.get(invitation.project_id);

    if (!project) return [];

    let invitedAs: "Auteur" | "Editeur";

    if (project.author_id === userId) {
      invitedAs = "Editeur";
    } else if (project.publisher_id === userId) {
      invitedAs = "Auteur";
    } else {
      return [];
    }

    const profile = profileMap.get(invitation.invitee_id);

    const recipientName =
      invitedAs === "Auteur"
        ? profile?.full_name || profile?.company_name
        : profile?.company_name || profile?.full_name;

    // Afficher comme expirée une invitation
    // dont la date limite est dépassée.
    const status: SentInvitationStatus =
      invitation.status === "pending" &&
      new Date(invitation.expires_at).getTime() <= now
        ? "expired"
        : invitation.status;

    return [
      {
        id: invitation.id,
        projectId: invitation.project_id,
        projectTitle: project.title,
        recipientName: recipientName || "Utilisateur Thélyson",
        invitedAs,
        status,
        createdAt: invitation.created_at,
      },
    ];
  });
}

// ============================================
// 2. ANNULER UNE INVITATION
// ============================================

export async function cancelProjectInvitation(invitationId: string) {
  const { userId } = await auth();

  if (!userId) {
    return {
      success: false,
      error: "Vous devez être connecté.",
    };
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(invitationId)) {
    return {
      success: false,
      error: "Invitation invalide.",
    };
  }

  try {
    const supabase = adminClient();

    // L'annulation est une mise à jour conditionnelle.
    // Seul l'expéditeur peut annuler.
    // Une invitation acceptée ne peut plus être annulée.
    const { data, error } = await supabase
      .from("project_invitations")
      .update({
        status: "cancelled",
        responded_at: new Date().toISOString(),
      })
      .eq("id", invitationId)
      .eq("inviter_id", userId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("project_id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return {
        success: false,
        error: "Cette invitation ne peut plus être annulée.",
      };
    }

    revalidatePath("/dashboard");
    revalidatePath("/dashboard/invitations");
    revalidatePath(`/dashboard/projects/${data.project_id}`);

    return {
      success: true,
      message: "Invitation annulée.",
    };
  } catch (error: unknown) {
    console.error("Annulation invitation :", error);

    return {
      success: false,
      error: "Impossible d'annuler l'invitation.",
    };
  }
}

// ============================================
// 3. COMPTEUR DES INVITATIONS REÇUES
// ============================================

export async function getMyPendingInvitationCount(): Promise<number> {
  const { userId } = await auth();

  if (!userId) return 0;

  const supabase = adminClient();

  const { count, error } = await supabase
    .from("project_invitations")
    .select("id", {
      count: "exact",
      head: true,
    })
    .eq("invitee_id", userId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());

  if (error) {
    console.error("Compteur invitations :", error);
    throw new Error("Impossible de compter les invitations.");
  }

  return count ?? 0;
}
