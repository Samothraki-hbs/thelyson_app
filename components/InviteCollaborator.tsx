"use client";

import { useState } from "react";
import { addCollaborator } from "@/app/actions/inviteCollaborator";

export default function InviteCollaborator({
  projectId,
}: {
  projectId: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ type: "", msg: "" });
  const [isLoading, setIsLoading] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setStatus({ type: "", msg: "" });

    const result = await addCollaborator(projectId, email);

    if (result.success) {
      setStatus({ type: "success", msg: result.message || "Succès" });
      setTimeout(() => setIsOpen(false), 2000);
    } else {
      setStatus({ type: "error", msg: result.error || "Erreur" });
    }
    setIsLoading(false);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-50 text-blue-600 font-medium rounded-lg hover:bg-blue-100 transition-colors"
      >
        👤 Ajouter un collaborateur
      </button>
    );
  }

  return (
    <form onSubmit={handleInvite} className="flex items-center gap-2">
      <input
        type="email"
        required
        placeholder="Email du collaborateur..."
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <button
        type="submit"
        disabled={isLoading}
        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:bg-blue-300"
      >
        {isLoading ? "..." : "Ajouter"}
      </button>
      <button
        type="button"
        onClick={() => setIsOpen(false)}
        className="px-2 py-2 text-gray-500 hover:text-gray-700"
      >
        ✕
      </button>
      {status.msg && (
        <span
          className={`text-sm ml-2 ${status.type === "error" ? "text-red-500" : "text-green-500"}`}
        >
          {status.msg}
        </span>
      )}
    </form>
  );
}
