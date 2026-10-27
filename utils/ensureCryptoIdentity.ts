import {
  createLocalIdentity,
  getLocalIdentity,
  type LocalIdentity,
} from "@/utils/localCryptoKeys";
import {
  getMyRegisteredPublicKey,
  registerMyPublicKey,
} from "@/app/actions/cryptoKeys";

/** Ne recrée jamais une identité si une autre clé publique est déjà enregistrée. */
export async function ensureCryptoIdentity(
  userId: string,
): Promise<LocalIdentity> {
  const registered = await getMyRegisteredPublicKey();
  let identity = await getLocalIdentity(userId);

  if (registered) {
    if (
      !identity ||
      identity.publicKeyJwk.n !== registered.n ||
      identity.publicKeyJwk.e !== registered.e
    ) {
      throw new Error(
        "Ce navigateur ne possède pas la clé de votre coffre-fort. " +
          "La récupération des clés n'est pas encore disponible.",
      );
    }
    return identity;
  }

  identity = identity ?? (await createLocalIdentity(userId));
  const result = await registerMyPublicKey(identity.publicKeyJwk);
  if (!result.success) {
    throw new Error(result.error || "Impossible de préparer le coffre-fort.");
  }
  return identity;
}
