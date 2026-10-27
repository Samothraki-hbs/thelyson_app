"use server";

import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { Wallet, hexlify, toUtf8Bytes } from "ethers";

const RPC_URL = "https://polygon-amoy.gateway.tatum.io";

const CHAIN_ID = 80002;
const GWEI = 1_000_000_000n;
const MAX_GAS_PRICE = 60n * GWEI;
const MAX_TRANSACTION_COST = 2_000_000_000_000_000n;
// 0,002 POL exprimé en wei

type AnchorResult =
  | { success: true; txId: string; alreadyAnchored?: boolean }
  | { success: false; error: string };

async function rpc(
  method: string,
  params: unknown[],
  apiKey: string,
): Promise<string> {
  // Espacer les appels pour respecter
  // la limite de requêtes Tatum.
  await new Promise<void>((resolve) => setTimeout(resolve, 650));

  const response = await fetch(RPC_URL, {
    // Conserver ici ton code existant.

    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
    cache: "no-store",
  });

  const json = (await response.json()) as {
    result?: unknown;
    error?: { message?: string };
  };

  if (!response.ok || json.error) {
    throw new Error(
      `${method} : ${json.error?.message ?? `HTTP ${response.status}`}`,
    );
  }

  if (typeof json.result !== "string") {
    throw new Error(`Réponse RPC invalide : ${method}`);
  }

  return json.result;
}

export async function anchorDocumentToBlockchain(
  versionId: string,
  fileHash: string,
): Promise<AnchorResult> {
  try {
    // 1. Vérifier l'utilisateur connecté
    const { userId } = await auth();

    if (!userId) {
      return {
        success: false,
        error: "Utilisateur non connecté.",
      };
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!uuidRegex.test(versionId)) {
      return {
        success: false,
        error: "Identifiant de version invalide.",
      };
    }

    // 2. Accéder aux données côté serveur
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );

    const { data: version, error: versionError } = await supabase
      .from("versions")
      .select("id, project_id, file_hash, blockchain_tx_id")
      .eq("id", versionId)
      .maybeSingle();

    if (versionError || !version) {
      return {
        success: false,
        error: "Version introuvable.",
      };
    }

    // 3. Vérifier que l'utilisateur
    // appartient au projet
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("author_id, publisher_id")
      .eq("id", version.project_id)
      .maybeSingle();

    if (
      projectError ||
      !project ||
      (project.author_id !== userId && project.publisher_id !== userId)
    ) {
      return {
        success: false,
        error: "Accès au projet refusé.",
      };
    }

    // 4. Vérifier le SHA-256 enregistré
    if (
      typeof version.file_hash !== "string" ||
      !/^[a-f0-9]{64}$/i.test(version.file_hash) ||
      typeof fileHash !== "string" ||
      fileHash.toLowerCase() !== version.file_hash.toLowerCase()
    ) {
      return {
        success: false,
        error: "Empreinte SHA-256 invalide.",
      };
    }

    if (version.blockchain_tx_id) {
      return {
        success: true,
        txId: version.blockchain_tx_id,
        alreadyAnchored: true,
      };
    }

    // 5. Paramètres blockchain
    const apiKey = process.env.TATUM_API_KEY;
    const privateKey = process.env.POLYGON_PRIVATE_KEY;

    if (!apiKey || !privateKey) {
      return {
        success: false,
        error: "Configuration blockchain manquante.",
      };
    }

    const wallet = new Wallet(privateKey);

    // Inscrire le SHA-256 comme texte
    // dans les données de la transaction
    const data = hexlify(toUtf8Bytes(version.file_hash.toLowerCase()));

    // 6. Vérifier le réseau
    const chainHex = await rpc("eth_chainId", [], apiKey);

    if (BigInt(chainHex) !== BigInt(CHAIN_ID)) {
      return {
        success: false,
        error: "Le réseau n'est pas Polygon Amoy.",
      };
    }

    // 7. Lire le prix du gas actuel
    const priceHex = await rpc("eth_gasPrice", [], apiKey);

    const networkPrice = BigInt(priceHex);

    // Ajouter une marge de 10 %
    const gasPrice = (networkPrice * 110n + 99n) / 100n;

    const gasPriceGwei = Number(gasPrice) / Number(GWEI);

    console.log("Tatum Amoy - prix du gas :", gasPriceGwei, "Gwei");

    // Interdire les prix excessifs
    if (gasPrice <= 0n || gasPrice > MAX_GAS_PRICE) {
      return {
        success: false,
        error:
          `Prix du gas trop élevé (${gasPriceGwei.toFixed(2)} Gwei). ` +
          "Transaction non envoyée.",
      };
    }

    // 8. Estimer le gas nécessaire
    const estimatedHex = await rpc(
      "eth_estimateGas",
      [
        {
          from: wallet.address,
          to: wallet.address,
          value: "0x0",
          data,
          gasPrice: `0x${gasPrice.toString(16)}`,
        },
      ],
      apiKey,
    );

    const estimatedGas = BigInt(estimatedHex);

    // Marge de sécurité de 20 %
    const gasLimit = (estimatedGas * 120n + 99n) / 100n;

    const maximumCost = gasLimit * gasPrice;

    console.log("Tatum Amoy - estimation :", {
      estimatedGas: estimatedGas.toString(),
      gasLimit: gasLimit.toString(),
      maximumCostPOL: Number(maximumCost) / 1e18,
    });

    // Plafond de dépense
    if (
      estimatedGas < 21_000n ||
      gasLimit > 100_000n ||
      maximumCost > MAX_TRANSACTION_COST
    ) {
      return {
        success: false,
        error:
          "Le coût estimé dépasse la limite " +
          "autorisée. Transaction non envoyée.",
      };
    }

    // 9. Vérifier les fonds disponibles
    const balanceHex = await rpc(
      "eth_getBalance",
      [wallet.address, "pending"],
      apiKey,
    );

    if (BigInt(balanceHex) < maximumCost) {
      return {
        success: false,
        error: "Solde POL insuffisant pour " + "les frais estimés.",
      };
    }

    // 10. Préparer la transaction
    const nonceHex = await rpc(
      "eth_getTransactionCount",
      [wallet.address, "pending"],
      apiKey,
    );

    const nonce = Number(BigInt(nonceHex));

    if (!Number.isSafeInteger(nonce)) {
      throw new Error("Nonce invalide.");
    }

    // 11. Signer sur le serveur
    const signedTransaction = await wallet.signTransaction({
      type: 0,
      chainId: CHAIN_ID,
      nonce,
      to: wallet.address,
      value: 0n,
      data,
      gasLimit,
      gasPrice,
    });

    // 12. Envoyer via Tatum RPC
    const txId = await rpc(
      "eth_sendRawTransaction",
      [signedTransaction],
      apiKey,
    );

    if (!/^0x[a-fA-F0-9]{64}$/.test(txId)) {
      throw new Error("Identifiant de transaction invalide.");
    }

    // 13. Enregistrer la référence
    // dans Supabase
    const { data: updated, error: updateError } = await supabase
      .from("versions")
      .update({ blockchain_tx_id: txId })
      .eq("id", versionId)
      .is("blockchain_tx_id", null)
      .select("id")
      .maybeSingle();

    if (updateError || !updated) {
      console.error("Transaction envoyée mais non enregistrée :", {
        versionId,
        txId,
        updateError,
      });

      return {
        success: false,
        error:
          "Transaction envoyée, mais son " +
          "enregistrement nécessite une vérification. " +
          "Ne répétez pas ce dépôt.",
      };
    }

    console.log("Transaction Tatum envoyée :", txId);

    return {
      success: true,
      txId,
    };
  } catch (error) {
    console.error("Erreur d'ancrage :", error);

    return {
      success: false,
      error:
        "L'ancrage a échoué ou son état est incertain. " +
        "Vérifiez le terminal avant un nouveau dépôt.",
    };
  }
}
