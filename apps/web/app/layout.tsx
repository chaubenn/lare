import type { Metadata } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { env } from "@/lib/env";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: "Lare — Hevy for LeetCode", template: "%s · Lare" },
  description:
    "Log LeetCode sessions, capture submissions, share demo videos and get AI-graded mock interviews.",
  openGraph: { siteName: "Lare", type: "website" },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${outfit.variable} ${ibmPlexMono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6 sm:py-8">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
