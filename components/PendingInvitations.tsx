"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  getMyPendingInvitations,
  respondToInvitation,
  type PendingInvitation,
} from "@/app/actions/projectInvitations";

export default function PendingInvitations() {
  const router = useRouter();

  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Charger les invitations du compte connecté.
  useEffect(() => {
    let active = true;

    const loadInvitations = async () => {
      try {
        const data = await getMyPendingInvitations();

        if (active) {
          setInvitations(data);
        }
      } catch {
        if (active) {
          setError("Impossible de charger vos invitations.");
        }
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadInvitations();

    return () => {
      active = false;
    };
  }, []);

  // Répondre à une invitation.
  const handleResponse = async (
    invitationId: string,
    decision: "accept" | "decline",
  ) => {
    if (processingId) return;

    setProcessingId(invitationId);
    setError("");
    setNotice("");

    try {
      const result = await respondToInvitation(invitationId, decision);

      if (!result.success) {
        setError(result.error);
        return;
      }

      // Retirer immédiatement l'invitation traitée.
      setInvitations((current) =>
        current.filter((item) => item.id !== invitationId),
      );

      setNotice(
        decision === "accept"
          ? "Invitation acceptée. Le projet est désormais accessible depuis votre tableau de bord."
          : "Invitation refusée.",
      );

      // Actualiser aussi les projets du tableau de bord.
      router.refresh();
    } catch {
      setError("Impossible de traiter votre réponse. Réessayez.");
    } finally {
      setProcessingId(null);
    }
  };

  // Ne pas afficher une section vide.
  if (!isLoading && invitations.length === 0 && !error && !notice) {
    return null;
  }

  if (isLoading) {
    return null;
  }

  return (
    <section className="mb-12">
      {/* TITRE */}
      {invitations.length > 0 && (
        <div className="mb-5 flex items-center gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900">
            Invitations reçues
          </h2>

          <span className="rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {invitations.length}
          </span>
        </div>
      )}

      {/* MESSAGES */}
      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {notice}
        </div>
      )}

      {/* INVITATIONS */}
      <div className="space-y-4">
        {invitations.map((invitation) => {
          const busy = processingId === invitation.id;

          const date = new Date(invitation.createdAt).toLocaleDateString(
            "fr-FR",
            {
              day: "numeric",
              month: "long",
              year: "numeric",
            },
          );

          const isInvitedAsAuthor = invitation.invitedAs === "Auteur";

          return (
            <article
              key={invitation.id}
              className="rounded-xl border border-zinc-200 bg-white p-5 sm:p-6"
            >
              {/* STATUT ET DATE */}
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                  En attente de réponse
                </span>

                <time
                  dateTime={invitation.createdAt}
                  className="text-xs text-zinc-400"
                >
                  {date}
                </time>
              </div>

              {/* INFORMATIONS */}
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-xl text-zinc-500">
                  <span aria-hidden="true">▤</span>
                </div>

                <div className="min-w-0">
                  <h3 className="break-words text-lg font-semibold tracking-tight text-zinc-900">
                    {invitation.projectTitle}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-zinc-500">
                    <span className="font-medium text-zinc-800">
                      {invitation.inviterName}
                    </span>{" "}
                    souhaite vous associer à ce projet.
                  </p>

                  <div className="mt-3">
                    <span
                      className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-medium ${
                        isInvitedAsAuthor
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-amber-200 bg-amber-50 text-amber-700"
                      }`}
                    >
                      Invitation en tant qu'
                      {isInvitedAsAuthor ? "auteur" : "éditeur"}
                    </span>
                  </div>
                </div>
              </div>

              {/* ACTIONS */}
              <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-zinc-100 pt-5">
                {/* REFUSER */}
                <button
                  type="button"
                  onClick={() => handleResponse(invitation.id, "decline")}
                  disabled={processingId !== null}
                  className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Traitement..." : "Refuser"}
                </button>

                {/* ACCEPTER */}
                <button
                  type="button"
                  onClick={() => handleResponse(invitation.id, "accept")}
                  disabled={processingId !== null}
                  className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span aria-hidden="true">✓</span>
                  {busy ? "Traitement..." : "Accepter"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
