import type { Metadata } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { Suspense } from "react";
import { Providers } from "@/components/providers";
import { SiteHeaderFallback } from "@/components/site-chrome";
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
        <Providers>
          <Suspense fallback={<SiteHeaderFallback />}>
            <SiteHeader />
          </Suspense>
          <main className="flex-1 py-5 pb-24 md:pb-5">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
