import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TTNO - Translate To Notion",
  description: "웹 페이지를 한국어로 번역하여 Notion에 저장",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="scroll-smooth">
      <body className="min-h-screen antialiased selection:bg-indigo-500/20 selection:text-indigo-900 dark:selection:text-indigo-100">
        {children}
      </body>
    </html>
  );
}
