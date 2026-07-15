import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "./BottomNav";

export const metadata: Metadata = {
  title: "株式会社良心　工事台帳",
  description: "解体工事の工事台帳アプリ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-gray-50 min-h-screen">
        <header className="no-print bg-blue-700 text-white px-4 py-3">
          <p className="text-xs text-blue-200 leading-none">株式会社良心</p>
          <p className="text-lg font-bold leading-tight">工事台帳</p>
        </header>
        <main className="app-main max-w-2xl mx-auto px-4 py-6 pb-24">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
