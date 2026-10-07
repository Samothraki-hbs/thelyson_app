import Link from "next/link";
// NOUVEAU : On importe 'Show' à la place de SignedIn et SignedOut
import { Show, UserButton, SignInButton } from "@clerk/nextjs";

export default function Header() {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo / Accueil */}
        <Link
          href="/"
          className="font-bold text-xl text-gray-900 tracking-tight"
        >
          Thélyson<span className="text-blue-600">.</span>
        </Link>

        {/* Liens de navigation */}
        <nav className="flex items-center gap-6">
          {/* Toujours visible pour les éditeurs / journalistes */}
          <Link
            href="/verifier"
            className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
          >
            Vérifier un manuscrit
          </Link>

          {/* NOUVEAU : Remplacement de <SignedIn> par <Show when="signed-in"> */}
          <Show when="signed-in">
            <Link
              href="/dashboard"
              className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
            >
              Tableau de bord
            </Link>
            {/* L'avatar Clerk avec menu déroulant */}
            <UserButton />
          </Show>

          {/* NOUVEAU : Remplacement de <SignedOut> par <Show when="signed-out"> */}
          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition">
                Connexion Auteur
              </button>
            </SignInButton>
          </Show>
        </nav>
      </div>
    </header>
  );
}
