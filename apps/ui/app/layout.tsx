import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PIP Agent — Autonomous Run",
  description: "Stream the autonomous PIP pipeline in real time."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
