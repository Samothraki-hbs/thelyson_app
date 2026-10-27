"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { syncProjectKeys, type KeySyncResult } from "@/utils/syncProjectKeys";

export default function ProjectKeySharing({
  projectId,
}: {
  projectId: string;
}) {
  const { userId, isLoaded } = useAuth();
  const [working, setWorking] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<KeySyncResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !userId) return;
    let active = true;

    const run = async () => {
      setWorking(true);
      setError("");
      setProgress("");
      try {
        const next = await syncProjectKeys(
          projectId,
          userId,
          (current, total) => {
            if (active)
              setProgress(`Partage sécurisé : ${current}/${total} versions`);
          },
        );
        if (active) setResult(next);
      } catch (caught: unknown) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Partage sécurisé indisponible.",
          );
        }
      } finally {
        if (active) setWorking(false);
      }
    };

    void run();
    return () => {
      active = false;
    };
  }, [projectId, userId, isLoaded]);

  if (
    !userId ||
    (working && !progress) ||
    (!error &&
      !working &&
      (result?.kind === "no-collaborator" ||
        (result?.kind === "done" &&
          result.shared === 0 &&
          result.waitingForOther === 0 &&
          result.missingForBoth === 0)))
  ) {
    return null;
  }

  const message =
    error ||
    (working
      ? progress
      : result?.kind === "collaborator-not-ready"
        ? "Votre collaborateur doit ouvrir Thélyson une première fois pour préparer son coffre-fort."
        : result?.kind === "consent-not-confirmed"
          ? "Le partage attend une invitation explicitement acceptée par le collaborateur."
          : result?.kind === "done"
            ? [
                result.shared > 0
                  ? `${result.shared} version(s) partagée(s) en toute confidentialité.`
                  : "",
                result.waitingForOther > 0
                  ? `${result.waitingForOther} version(s) attendent le partage depuis l'appareil de l'autre collaborateur.`
                  : "",
                result.missingForBoth > 0
                  ? `${result.missingForBoth} version(s) n'ont aucune clé d'accès connue.`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")
            : "");

  if (!message) return null;

  return (
    <div
      role={error ? "alert" : "status"}
      className={`mb-8 rounded-xl border px-4 py-3 text-sm leading-6 ${
        error
          ? "border-red-200 bg-red-50 text-red-700"
          : "border-violet-200 bg-violet-50/60 text-violet-800"
      }`}
    >
      <span className="font-semibold">Protection des manuscrits : </span>
      {message}
    </div>
  );
}
