"use client";

import { useEffect } from "react";
import { useAuth } from "@clerk/nextjs";

import { createLocalIdentity, getLocalIdentity } from "@/utils/localCryptoKeys";

type GetRegisteredKey =
  typeof import("@/app/actions/cryptoKeys").getMyRegisteredPublicKey;

type RegisterKey =
  typeof import("@/app/actions/cryptoKeys").registerMyPublicKey;

type Props = {
  getRegisteredKey: GetRegisteredKey;
  registerKey: RegisterKey;
};

export default function CryptoIdentityInitializer({
  getRegisteredKey,
  registerKey,
}: Props) {
  const { userId, isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      return;
    }

    let cancelled = false;

    const initialize = async () => {
      try {
        const token = await getToken({
          skipCache: true,
        });
        if (!token || cancelled) return;

        // Action reçue d'un composant serveur
        const registered = await getRegisteredKey();

        if (cancelled) return;

        let identity = await getLocalIdentity(userId);

        if (registered) {
          if (
            !identity ||
            identity.publicKeyJwk.n !== registered.n ||
            identity.publicKeyJwk.e !== registered.e
          ) {
            throw new Error(
              "Ce navigateur ne possède pas la clé privée " +
                "correspondant à votre coffre-fort.",
            );
          }
        } else {
          identity = identity ?? (await createLocalIdentity(userId));

          const result = await registerKey(identity.publicKeyJwk);

          if (!result.success) {
            throw new Error(result.error);
          }
        }

        if (!cancelled) {
          console.log("Coffre-fort cryptographique initialisé.");
        }
      } catch (error: unknown) {
        if (!cancelled) {
          console.warn("Coffre-fort local indisponible :", error);
        }
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [userId, isLoaded, isSignedIn, getToken, getRegisteredKey, registerKey]);

  return null;
}
