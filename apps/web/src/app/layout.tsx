import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { SiteChrome } from "@/components/public/SiteChrome";
import { PRIMARY_LOGOS } from "@/lib/brand";

// Plan 16 — primary broadcast display face (Agharti, self-hosted woff2).
const agharti = localFont({
  src: [
    { path: "./fonts/Agharti-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Agharti-Bold.woff2", weight: "700", style: "normal" },
    { path: "./fonts/Agharti-Black.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-agharti",
  display: "swap",
});

// Plan 16 — secondary broadcast accent face (Quedora, self-hosted woff2).
const quedora = localFont({
  src: [
    { path: "./fonts/Quedora-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Quedora-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-quedora",
  display: "swap",
});

// Phase 1A retained — public web pages still use Space Grotesk + Inter.
// Overlay surface consumes Agharti + Quedora via --font-agharti / --font-quedora.
const display = Space_Grotesk({
  variable: "--font-display-src",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const body = Inter({
  variable: "--font-body-src",
  subsets: ["latin"],
  display: "swap",
});

const mono = JetBrains_Mono({
  variable: "--font-mono-src",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CADE League — Division 1 Elite · 2025-2026",
    template: "%s · CADE League",
  },
  description:
    "CADE Esports League — Division 1 Elite. Nigeria's EAFC competition. Live standings, fixtures, and discipline for the 2025-2026 season.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: PRIMARY_LOGOS.cade, type: "image/png" },
    ],
    apple: [{ url: PRIMARY_LOGOS.cade, type: "image/png" }],
  },
  openGraph: {
    title: "CADE League — Division 1 Elite · 2025-2026",
    description:
      "CADE Esports League — Division 1 Elite. Nigeria's EAFC competition. Live standings, fixtures, and discipline for the 2025-2026 season.",
    images: [{ url: PRIMARY_LOGOS.cade }],
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080b",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable} ${agharti.variable} ${quedora.variable}`}
    >
      <body className="antialiased">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
