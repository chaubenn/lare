import type { Metadata } from "next";
import { IBM_Plex_Mono, Outfit } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
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
  title: { default: "Lare — Social progress tracking for LeetCode", template: "%s · Lare" },
  description:
    "Log LeetCode sessions, capture submissions, record demo videos and run AI-graded mock interviews. Desktop app and Chrome extension.",
  openGraph: { siteName: "Lare", type: "website" },
  icons: {
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: [{ url: "/apple-icon.png" }],
  },
};

/**
 * No header: the page is one screen with the wordmark in it, and there is nothing to navigate to.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`dark ${outfit.variable} ${ibmPlexMono.variable}`}>
      <body className="flex min-h-screen flex-col font-sans">
        <main className="flex-1 py-5">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
