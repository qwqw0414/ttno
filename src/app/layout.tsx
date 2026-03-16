import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TTNO - Translate To Notion",
  description: "Translate web pages to Korean and save to Notion",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
