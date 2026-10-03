import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Shared State — Context Control Center",
  description: "Switch agents without starting over.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
