import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

// NOUVEAU : Import de votre menu Header
import Header from "@/components/Header";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// NOUVEAU : Mise à jour du titre et de la description pour le SEO et les onglets du navigateur
export const metadata: Metadata = {
  title: "Thélyson - Protection de manuscrits",
  description:
    "Certifiez l'antériorité de vos œuvres littéraires sur la blockchain.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html
        lang="fr" // Passé de "en" à "fr"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">
          {/* NOUVEAU : Le Header est placé tout en haut du body */}
          <Header />

          {/* NOUVEAU : Le main englobe vos pages et prend le reste de l'espace disponible */}
          <main className="flex-1 flex flex-col">{children}</main>
        </body>
      </html>
    </ClerkProvider>
  );
}
