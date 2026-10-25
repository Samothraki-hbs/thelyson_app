import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import PendingInvitations from "@/components/PendingInvitations";
import SentInvitations from "@/components/SentInvitations";

export default async function InvitationsPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/");
  }

  return (
    <main className="min-h-screen bg-[#FAFAFA] text-zinc-900">
      <div className="mx-auto w-full max-w-5xl px-6 py-12 sm:px-10">
        {/* Navigation */}
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 transition-colors hover:text-zinc-900"
        >
          ← Retour au tableau de bord
        </Link>

        {/* En-tête */}
        <header className="mb-10 mt-8 border-b border-zinc-200 pb-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-zinc-400">
            Collaboration
          </p>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Mes invitations
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-500">
            Retrouvez les invitations reçues et suivez vos demandes de
            collaboration.
          </p>
        </header>

        {/* Invitations reçues */}
        <section id="invitations-recues" className="mb-12">
          <PendingInvitations />
        </section>

        {/* Invitations envoyées */}
        <SentInvitations />
      </div>
    </main>
  );
}
