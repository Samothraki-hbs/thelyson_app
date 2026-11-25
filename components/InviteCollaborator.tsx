"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@clerk/nextjs";
import {
  addCollaborator,
  prepareCollaboratorInvitation,
  type PreparedInvitationKey,
} from "@/app/actions/inviteCollaborator";
import { ensureCryptoIdentity } from "@/utils/ensureCryptoIdentity";

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export default function InviteCollaborator({
  projectId,
}: {
  projectId: string;
}) {
  const router = useRouter();
  const { userId } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isAdded, setIsAdded] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleInvite = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !userId || isLoading) return;

    setIsLoading(true);
    setStatus("Vérification du collaborateur et de ses clés...");
    try {
      // 1. Le serveur valide le destinataire et transmet UNIQUEMENT
      // ses données publiques et les clés AES enveloppées pour A.
      const preparation = await prepareCollaboratorInvitation(
        projectId,
        email.trim(),
      );
      if (!preparation.success) throw new Error(preparation.error);

      // 2. La clé privée d'A n'est jamais envoyée au serveur.
      const identity = await ensureCryptoIdentity(userId);
      const recipientKey = await crypto.subtle.importKey(
        "jwk",
        preparation.recipientPublicKey,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["wrapKey"],
      );

      setStatus(
        `Préparation sécurisée de ${preparation.versions.length} version(s)...`,
      );
      const keys: PreparedInvitationKey[] = [];

      for (const version of preparation.versions) {
        const aesKey = await crypto.subtle.unwrapKey(
          "raw",
          fromBase64(version.senderWrappedKey),
          identity.privateKey,
          "RSA-OAEP",
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        const rewrapped = await crypto.subtle.wrapKey(
          "raw",
          aesKey,
          recipientKey,
          "RSA-OAEP",
        );
        keys.push({
          version_id: version.versionId,
          encrypted_key: toBase64(rewrapped),
        });
      }

      // 3. Publier seulement après la préparation COMPLÈTE.
      setStatus("Finalisation de l'invitation...");
      const result = await addCollaborator(
        projectId,
        email.trim(),
        preparation.recipientPublicKey.n!,
        keys,
      );
      if (!result.success) throw new Error(result.error);

      setIsAdded(true);
      setEmail("");
      setStatus("");
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Impossible de préparer l'invitation sécurisée.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isAdded) {
    return (
      <span
        role="status"
        className="inline-flex items-center rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700"
      >
        ✓ Invitation sécurisée en attente
      </span>
    );
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        <span aria-hidden="true">+</span> Associer un collaborateur
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
        onChange={(event) => setEmail(event.target.value)}
        disabled={isLoading}
        className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:opacity-50 sm:min-w-56"
      />
      <button
        type="submit"
        disabled={isLoading || !email.trim()}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {isLoading ? "Préparation..." : "Envoyer une invitation"}
      </button>
      <button
        type="button"
        disabled={isLoading}
        aria-label="Annuler"
        onClick={() => {
          setIsOpen(false);
          setStatus("");
        }}
        className="rounded-lg px-3 py-2.5 text-sm text-zinc-400 hover:bg-zinc-100"
      >
        ✕
      </button>
      {status && (
        <p role="status" className="w-full text-xs leading-5 text-zinc-700">
          {status}
        </p>
      )}
    </form>
  );
}
