"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { getMyPendingInvitationCount } from "@/app/actions/sentInvitations";

export default function NotificationBell() {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let active = true;

    const refreshCount = async () => {
      try {
        const nextCount = await getMyPendingInvitationCount();

        if (active) {
          setCount(nextCount);
        }
      } catch (error) {
        console.error("Notifications :", error);
      }
    };

    void refreshCount();

    // Actualiser lorsque l'utilisateur revient
    // sur l'onglet et toutes les 60 secondes.
    const onFocus = () => {
      void refreshCount();
    };

    window.addEventListener("focus", onFocus);

    const interval = window.setInterval(refreshCount, 60_000);

    // Mise à jour immédiate après une réponse locale.
    window.addEventListener("thelyson:invitations-updated", onFocus);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("thelyson:invitations-updated", onFocus);
    };
  }, [pathname]);

  return (
    <Link
      href="/dashboard/invitations"
      title="Mes invitations"
      aria-label={
        count > 0
          ? `${count} invitation${count > 1 ? "s" : ""} en attente`
          : "Mes invitations"
      }
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
    >
      {/* Icône cloche */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="21"
        height="21"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
        <path d="M10 21h4" />
      </svg>

      {/* Compteur */}
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white ring-2 ring-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
