"use client";

import { useState } from "react";
import { verifyDocumentHash } from "@/app/actions/verify";
import Link from "next/link";

// 1. La même fonction de hachage que pour l'upload (elle doit être identique)
async function calculateSHA256(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VerifierPage() {
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<{
    status: "idle" | "success" | "error";
    data?: any;
  }>({ status: "idle" });

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsVerifying(true);
    setResult({ status: "idle" });

    try {
      // Étape A : Recalculer l'empreinte localement (Zéro Trust)
      const hash = await calculateSHA256(file);

      // Étape B : Interroger la base de données
      const verification = await verifyDocumentHash(hash);

      if (verification.success) {
        setResult({ status: "success", data: verification });
      } else {
        setResult({ status: "error" });
      }
    } catch (error) {
      console.error(error);
      setResult({ status: "error" });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Vérification d'authenticité
          </h1>
          <p className="text-gray-500">
            Sélectionnez un manuscrit pour vérifier s'il a été certifié sur la
            blockchain. Le fichier ne quitte jamais votre ordinateur.
          </p>
        </div>

        {/* Zone de dépôt (Input File stylisé) */}
        <label className="border-2 border-dashed border-gray-300 bg-gray-50 rounded-xl p-10 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-50 hover:border-blue-300 transition-colors mb-8">
          <span className="text-4xl mb-4">📂</span>
          <span className="font-medium text-gray-700">
            Cliquez pour choisir un document
          </span>
          <span className="text-sm text-gray-400 mt-1">
            Formats acceptés : .pdf, .docx
          </span>
          <input
            type="file"
            className="hidden"
            accept=".pdf,.docx"
            onChange={handleFileChange}
            disabled={isVerifying}
          />
        </label>

        {/* Indicateur de chargement */}
        {isVerifying && (
          <div className="text-center text-blue-600 font-medium animate-pulse mb-6">
            Analyse cryptographique en cours...
          </div>
        )}

        {/* Affichage du résultat : SUCCÈS */}
        {result.status === "success" && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center animate-fade-in-up">
            <div className="text-green-500 text-5xl mb-4">✅</div>
            <h3 className="text-xl font-bold text-green-900 mb-2">
              Document Authentique
            </h3>
            <p className="text-green-700 mb-4">
              Ce fichier correspond exactement à une empreinte certifiée sur
              notre plateforme.
            </p>
            <div className="bg-white rounded-lg p-4 text-left border border-green-100 space-y-2">
              <p className="text-sm text-gray-600 flex justify-between border-b pb-2">
                <span>Date d'ancrage :</span>
                <strong className="text-gray-900">
                  {new Date(result.data.date).toLocaleString("fr-FR")}
                </strong>
              </p>
              <div className="pt-2">
                <span className="text-sm text-gray-600 block mb-1">
                  Preuve Blockchain :
                </span>
                <a
                  href={`https://amoy.polygonscan.com/tx/${result.data.txId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-blue-600 hover:underline break-all block"
                >
                  {result.data.txId} ↗
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Affichage du résultat : ERREUR */}
        {result.status === "error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center animate-fade-in-up">
            <div className="text-red-500 text-5xl mb-4">❌</div>
            <h3 className="text-xl font-bold text-red-900 mb-2">
              Aucune correspondance
            </h3>
            <p className="text-red-700">
              L'empreinte de ce fichier est inconnue. Soit ce document n'a
              jamais été certifié, soit il a été modifié depuis son
              enregistrement (même un simple espace).
            </p>
          </div>
        )}

        <div className="mt-8 text-center border-t pt-6">
          <Link
            href="/"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            ← Retour à l'accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
