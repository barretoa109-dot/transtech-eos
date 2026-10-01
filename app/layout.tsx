import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import PWARegister from "@/components/pwa/PWARegister";
import PuenteAppNativa from "@/components/app-nativa/PuenteAppNativa";
import "./globals.css";
import "./eos-design/tokens.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.transtech.com.py"),
  title: {
    default: "TransTech EOS",
    template: "%s | TransTech EOS",
  },
  description: "Inteligencia artificial, automatización y gestión para que personas y empresas tomen mejores decisiones y crezcan con más control.",
  applicationName: "TransTech EOS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "TransTech EOS",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "es_PY",
    siteName: "TransTech EOS",
    title: "TransTech EOS",
    description: "Inteligencia artificial, automatización y gestión para que personas y empresas tomen mejores decisiones y crezcan con más control.",
    url: "/",
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "TransTech EOS" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "TransTech EOS",
    description: "Inteligencia artificial, automatización y gestión para que personas y empresas tomen mejores decisiones y crezcan con más control.",
    images: ["/og-image.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020817",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <PWARegister />
        <PuenteAppNativa />
        {children}
      </body>
    </html>
  );
}
