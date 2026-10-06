"use server";

import { createClient } from "@supabase/supabase-js";

// Initialisation de Supabase avec la clé Service Role pour contourner les restrictions côté serveur
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function anchorDocumentToBlockchain(
  versionId: string,
  fileHash: string,
) {
  try {
    // 1. Appel à l'API Tatum pour ancrer le Hash sur Polygon (Testnet Amoy)
    const tatumResponse = await fetch("https://api.tatum.io/v3/record", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.TATUM_API_KEY!,
      },
      body: JSON.stringify({
        data: fileHash,
        chain: "MATIC",
        fromPrivateKey: process.env.POLYGON_PRIVATE_KEY!,
      }),
    });

    if (!tatumResponse.ok) {
      const errorData = await tatumResponse.text();
      console.error("Erreur Tatum:", errorData);
      throw new Error("Erreur de communication avec la blockchain");
    }

    const txData = await tatumResponse.json();
    const txId = txData.txId;

    // 2. Enregistrement de l'ID de transaction dans votre table 'versions'
    const { error: dbError } = await supabase
      .from("versions")
      .update({ blockchain_tx_id: txId })
      .eq("id", versionId);

    if (dbError) {
      console.error("Erreur Supabase:", dbError);
      throw dbError;
    }

    return { success: true, txId: txId };
  } catch (error) {
    console.error("Échec de l'ancrage :", error);
    return {
      success: false,
      error: "Impossible de certifier le document pour le moment.",
    };
  }
}
