"use server";
// prendre une empreinte et voir si elle existe dans la base de données

import { createClient } from "@supabase/supabase-js";

export async function verifyDocumentHash(fileHash: string) {
  // On utilise la clé de service pour contourner le blocage (RLS) des lectures publiques
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  try {
    // On cherche la ligne correspondant exactement à cette empreinte
    const { data, error } = await supabase
      .from("versions")
      .select("created_at, blockchain_tx_id")
      .eq("file_hash", fileHash)
      .single(); // On s'attend à un seul résultat

    if (error || !data) {
      return { success: false };
    }

    return {
      success: true,
      date: data.created_at,
      txId: data.blockchain_tx_id,
    };
  } catch (error) {
    return { success: false };
  }
}
