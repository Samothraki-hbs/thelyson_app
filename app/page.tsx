import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-8">
      <div className="absolute top-0 flex w-full justify-between p-6">
        <h1 className="text-2xl font-bold text-gray-900">Thélyson</h1>

        <div>
          {/* Nouveau composant Show pour les visiteurs déconnectés */}
          <Show when="signed-out">
            <div className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white transition-colors hover:bg-blue-700">
              <SignInButton
                mode="modal"
                fallbackRedirectUrl="/dashboard"
                signUpFallbackRedirectUrl="/dashboard"
              >
                Se connecter
              </SignInButton>
            </div>
          </Show>

          {/* Nouveau composant Show pour les utilisateurs connectés */}
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-4xl font-extrabold text-gray-900 sm:text-5xl">
          Prouvez l'origine de vos œuvres
        </h2>
        <p className="mx-auto mt-4 max-w-2xl text-xl text-gray-500">
          Le premier coffre-fort sécurisé qui horodate vos brouillons
          littéraires pour garantir qu'ils n'ont pas été générés par une IA.
        </p>
      </div>
    </main>
  );
}
