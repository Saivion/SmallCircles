import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif, Kalam } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({ weight: "400", style: ["normal", "italic"], subsets: ["latin"], variable: "--font-serif" });
const hand = Kalam({ weight: ["400", "700"], subsets: ["latin"], variable: "--font-hand" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });
const sans = Geist({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Small Circles",
  description: "Share a moment and see where it meets other people's: the places, memories and experiences we share without knowing it.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3ede2",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${serif.variable} ${hand.variable} ${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
