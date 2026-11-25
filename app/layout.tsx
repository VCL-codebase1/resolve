import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const sans = localFont({
  src: "./fonts/PlusJakartaSans.ttf",
  variable: "--font-plus",
  weight: "400 600",
  display: "swap",
});

const mono = localFont({
  src: "./fonts/GeistMono.ttf",
  variable: "--font-geist",
  weight: "400 500",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Desk",
  description: "Internal ticket desk for VethanCon.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("desk-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
