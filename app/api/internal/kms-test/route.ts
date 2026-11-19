import { auth } from "@clerk/nextjs/server";
import { KMSClient, EncryptCommand, DecryptCommand } from "@aws-sdk/client-kms";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();

  // Route temporaire réservée au compte de test.
  if (
    !userId ||
    !process.env.KMS_TEST_USER_ID ||
    userId !== process.env.KMS_TEST_USER_ID
  ) {
    return new Response("Not Found", { status: 404 });
  }

  try {
    const region = process.env.AWS_REGION;
    const roleArn = process.env.AWS_ROLE_ARN;
    const keyId = process.env.AWS_KMS_KEY_ID;

    if (!region || !roleArn || !keyId) {
      throw new Error("MissingConfiguration");
    }

    const kms = new KMSClient({
      region,
      credentials: awsCredentialsProvider({
        roleArn,
      }),
    });

    const testMessage = "orelien-kms-test";
    const plaintext = new TextEncoder().encode(testMessage);

    // Chiffrer une donnée fictive.
    const encrypted = await kms.send(
      new EncryptCommand({
        KeyId: keyId,
        Plaintext: plaintext,
      }),
    );

    if (!encrypted.CiphertextBlob) {
      throw new Error("EncryptionFailed");
    }

    // Déchiffrer la même donnée.
    const decrypted = await kms.send(
      new DecryptCommand({
        KeyId: keyId,
        CiphertextBlob: encrypted.CiphertextBlob,
      }),
    );

    const restored = new TextDecoder().decode(decrypted.Plaintext);

    if (restored !== testMessage) {
      throw new Error("DecryptionMismatch");
    }

    return Response.json(
      {
        success: true,
        encryption: "ok",
        decryption: "ok",
      },
      {
        headers: { "Cache-Control": "no-store" },
      },
    );
  } catch (error) {
    // Ne jamais journaliser de jeton ou de clé privée.
    console.error(
      "KMS test failed:",
      error instanceof Error ? error.name : "UnknownError",
    );

    return Response.json(
      {
        success: false,
        message: "Test KMS échoué. Consulter les logs Vercel.",
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
