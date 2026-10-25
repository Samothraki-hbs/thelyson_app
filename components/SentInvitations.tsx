"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  getMySentInvitations,
  cancelProjectInvitation,
  type SentInvitation,
  type SentInvitationStatus,
} from "@/app/actions/sentInvitations";

const statusStyles: Record<
  SentInvitationStatus,
  { label: string; classes: string }
> = {
  pending: {
    label: "En attente",
    classes: "bg-amber-50 text-amber-700 border-amber-200",
  },
  accepted: {
    label: "Acceptée",
    classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  declined: {
    label: "Refusée",
    classes: "bg-red-50 text-red-700 border-red-200",
  },
  cancelled: {
    label: "Annulée",
    classes: "bg-zinc-100 text-zinc-600 border-zinc-200",
  },
  expired: {
    label: "Expirée",
    classes: "bg-zinc-100 text-zinc-500 border-zinc-200",
  },
};

export default function SentInvitations() {
  const router = useRouter();

  const [invitations, setInvitations] = useState<SentInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const data = await getMySentInvitations();

        if (active) {
          setInvitations(data);
        }
      } catch {
        if (active) {
          setError("Impossible de charger vos invitations.");
        }
      } finally {
        if (active) setLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  const handleCancel = async (id: string) => {
    if (processingId) return;

    setProcessingId(id);
    setError("");

    try {
      const result = await cancelProjectInvitation(id);

      if (!result.success) {
        setError(result.error ?? "Impossible d'annuler cette invitation.");
        return;
      }

      setInvitations((current) =>
        current.map((invitation) =>
          invitation.id === id
            ? { ...invitation, status: "cancelled" }
            : invitation,
        ),
      );

      router.refresh();
    } catch {
      setError("Impossible d'annuler cette invitation.");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <section className="mt-12">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-semibold tracking-tight">
          Invitations envoyées
        </h2>

        {!loading && (
          <span className="rounded-md bg-zinc-200/70 px-2 py-0.5 text-xs font-medium text-zinc-600">
            {invitations.length}
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-zinc-400">Chargement des invitations...</p>
      ) : invitations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-200 bg-white p-8 text-center">
          <p className="text-sm text-zinc-500">
            Vous n'avez pas encore envoyé d'invitation.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {invitations.map((invitation) => {
            const status = statusStyles[invitation.status];

            const date = new Date(invitation.createdAt).toLocaleDateString(
              "fr-FR",
            );

            return (
              <article
                key={invitation.id}
                className="rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300"
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-3">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${status.classes}`}
                      >
                        {status.label}
                      </span>

                      <span className="text-xs text-zinc-400">
                        Envoyée le {date}
                      </span>
                    </div>

                    <h3 className="break-words text-base font-semibold text-zinc-900">
                      {invitation.projectTitle}
                    </h3>

                    <p className="mt-2 text-sm text-zinc-500">
                      Invitation envoyée à{" "}
                      <span className="font-medium text-zinc-800">
                        {invitation.recipientName}
                      </span>
                    </p>

                    <p className="mt-1 text-xs text-zinc-400">
                      Rôle proposé :{" "}
                      {invitation.invitedAs === "Auteur" ? "Auteur" : "Éditeur"}
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/projects/${invitation.projectId}`}
                      className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100"
                    >
                      Voir le projet ↗
                    </Link>

                    {invitation.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => handleCancel(invitation.id)}
                        disabled={processingId !== null}
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {processingId === invitation.id
                          ? "Annulation..."
                          : "Annuler l'invitation"}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
