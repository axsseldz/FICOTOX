import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Toaster } from "sonner";
import { Providers } from "./providers";
import { COLORES_BARRA, SCRIPT_TEMA } from "@/lib/shared/tema";
import "./globals.css";

/*
 * Una sola familia: la del sistema (SF Pro en Apple). Inter es el respaldo
 * para Windows/Linux, con la misma métrica y las mismas variantes.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "FICOTOX",
    template: "%s · FICOTOX",
  },
  description: "Sistema de gestión del Laboratorio Nacional de Ficotoxinas (LN-FICOTOX, CICESE).",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  // El script del tema ajusta ambas al tema elegido; sin preferencia, sigue al sistema.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: COLORES_BARRA.light },
    { media: "(prefers-color-scheme: dark)", color: COLORES_BARRA.dark },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={`${inter.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* Tema antes del primer pintado (sin destello blanco en oscuro). */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Toaster
          position="bottom-center"
          style={{ zIndex: "var(--z-toast)" } as React.CSSProperties}
          toastOptions={{
            style: {
              background: "var(--color-popover)",
              color: "var(--color-ink)",
              border: "1px solid var(--color-line)",
              fontFamily: "var(--font-sans)",
              fontSize: "13.5px",
              borderRadius: "14px",
              boxShadow: "var(--shadow-pop)",
            },
          }}
        />
      </body>
    </html>
  );
}
