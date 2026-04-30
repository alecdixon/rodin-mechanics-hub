import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rodin Mechanics Hub",
  description: "Rodin Motorsport mechanics preparation and reporting hub",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
