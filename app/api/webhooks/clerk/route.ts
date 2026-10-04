import { Webhook } from "svix";
import { headers } from "next/headers";
import { WebhookEvent } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: Request) {
  const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

  if (!WEBHOOK_SECRET) {
    throw new Error(
      "Veuillez ajouter CLERK_WEBHOOK_SECRET dans le fichier .env.local",
    );
  }

  // 1. Récupération des en-têtes
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Erreur : En-têtes Svix manquants", { status: 400 });
  }

  // 2. CORRECTION MAJEURE : On récupère le texte brut (raw body), indispensable pour les webhooks
  const body = await req.text();

  const wh = new Webhook(WEBHOOK_SECRET);
  let evt: WebhookEvent;

  // 3. Vérification cryptographique
  try {
    const verified = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    });

    // Sécurité absolue : si verify() ne retourne rien, on parse manuellement le texte brut
    evt = (verified ? verified : JSON.parse(body)) as WebhookEvent;
  } catch (err) {
    console.error("Erreur de vérification du webhook:", err);
    return new Response("Erreur de vérification cryptographique", {
      status: 400,
    });
  }

  // 4. Traitement Supabase (avec vérification que evt existe bien pour éviter l'erreur 500)
  if (evt && evt.type === "user.created") {
    const { id, first_name, last_name } = evt.data;
    const fullName =
      [first_name, last_name].filter(Boolean).join(" ") || "Utilisateur";

    console.log(`Tentative d'insertion pour le profil : ${fullName} (${id})`);

    // insertion minimaliste dans Supabase, pour laisser l'onboarding ensuite
    const { data, error } = await supabase
      .from("profiles")
      .insert([
        {
          id: id,
        },
      ])
      .select();

    if (error) {
      console.error("ERREUR SUPABASE EXACTE:", error);
      return new Response("Erreur base de données", { status: 500 });
    }

    console.log("SUCCÈS SUPABASE, ligne insérée :", data);
  }

  // 5. Réponse de succès pour Clerk
  return new Response("Webhook traité avec succès", { status: 200 });
}
