"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { addCollaborator } from "@/app/actions/inviteCollaborator";

export default function InviteCollaborator({
  projectId,
}: {
  projectId: string;
}) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!email.trim() || isLoading) return;

    setIsLoading(true);
    setStatus("");

    try {
      const result = await addCollaborator(projectId, email.trim());

      if (result.success) {
        setIsAdded(true);
        setEmail("");
        router.refresh();
      } else {
        setStatus(result.error);
      }
    } catch {
      setStatus("Impossible d'associer le collaborateur pour le moment.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isAdded) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700"
      >
        ✓ Invitation en attente{" "}
      </span>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
      >
        <span aria-hidden="true">+</span>
        Associer un collaborateur
      </button>
    );
  }

  return (
    <form onSubmit={handleInvite} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`collaborator-email-${projectId}`} className="sr-only">
        Adresse e-mail du collaborateur
      </label>

      <input
        id={`collaborator-email-${projectId}`}
        type="email"
        required
        placeholder="E-mail du collaborateur"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={isLoading}
        className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 disabled:opacity-50 sm:min-w-56"
      />

      <button
        type="submit"
        disabled={isLoading || !email.trim()}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-300"
      >
        {isLoading ? "Envoi de l'invitation..." : "Envoyer une invitation"}
      </button>

      <button
        type="button"
        onClick={() => {
          setIsOpen(false);
          setStatus("");
        }}
        disabled={isLoading}
        aria-label="Annuler l'association"
        className="rounded-lg px-3 py-2.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
      >
        ✕
      </button>

      {status && (
        <p role="alert" className="w-full text-xs leading-5 text-red-600">
          {status}
        </p>
      )}
    </form>
  );
}
