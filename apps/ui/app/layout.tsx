import type { Metadata } from "next";
import "./globals.css";
import DevKeyboardShortcut from "./components/DevKeyboardShortcut";

export const metadata: Metadata = {
  title: "PIP Agent — Autonomous Run",
  description: "Stream the autonomous PIP pipeline in real time."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DevKeyboardShortcut />
        {children}
      </body>
    </html>
  );
}
