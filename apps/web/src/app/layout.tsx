import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CADE League",
  description: "CADE Esports League platform — Division 1 Elite 2025-2026",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <nav className="border-b bg-white px-6 py-3">
          <div className="max-w-6xl mx-auto flex items-center gap-6 text-sm">
            <Link href="/" className="font-semibold">
              CADE League
            </Link>
            <Link href="/players" className="text-slate-600 hover:text-slate-900">
              Players
            </Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
