import Link from "next/link";
import { Show, UserButton, SignInButton } from "@clerk/nextjs";

import NotificationBell from "@/components/NotificationBell";

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-zinc-200 bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-10">
        {/* LOGO THÉLYSON */}
        <Link
          href="/"
          className="shrink-0 text-xl font-bold tracking-tight text-zinc-900 transition-opacity hover:opacity-70"
        >
          Thélyson
          <span className="text-blue-600">.</span>
        </Link>

        {/* NAVIGATION PRINCIPALE */}
        <nav
          aria-label="Navigation principale"
          className="flex items-center gap-1 sm:gap-3"
        >
          {/* VÉRIFICATION PUBLIQUE */}
          <Link
            href="/verifier"
            className="rounded-lg px-2 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:px-3"
          >
            <span className="hidden sm:inline">Vérifier un manuscrit</span>

            <span className="sm:hidden">Vérifier</span>
          </Link>

          {/* UTILISATEUR CONNECTÉ */}
          <Show when="signed-in">
            {/* TABLEAU DE BORD */}
            <Link
              href="/dashboard"
              className="rounded-lg px-2 py-2 text-sm font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 sm:px-3"
            >
              <span className="hidden sm:inline">Tableau de bord</span>

              <span className="sm:hidden">Projets</span>
            </Link>

            {/* NOTIFICATIONS */}
            <NotificationBell />

            {/* PROFIL CLERK */}
            <div className="flex shrink-0 items-center justify-center pl-1 sm:pl-2">
              <UserButton />
            </div>
          </Show>

          {/* UTILISATEUR NON CONNECTÉ */}
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button
                type="button"
                className="ml-1 inline-flex items-center justify-center rounded-lg bg-zinc-900 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 sm:px-4"
              >
                Se connecter
              </button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
