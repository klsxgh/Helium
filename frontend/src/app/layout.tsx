import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Helium — Contradiction-aware policy intelligence",
    template: "%s · Helium",
  },
  description:
    "Helium retrieves policy evidence, structures it into claims, detects contradictions, and explains every answer with source-level citations.",
  applicationName: "Helium",
  icons: {
    icon: "/helium-mark.png",
    shortcut: "/helium-mark.png",
    apple: "/helium-mark.png",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
  ],
};

const themeBootstrap = `(function(){try{var stored=localStorage.getItem("helium-theme");var dark=stored?stored==="dark":window.matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",dark);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-[100dvh] bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
