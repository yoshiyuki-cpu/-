import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "工事台帳",
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
        <header className="no-print bg-blue-700 text-white px-4 py-3 flex items-center">
          <a href="/" className="text-lg font-bold">工事台帳</a>
          <nav className="flex gap-4 ml-auto text-sm">
            <a href="/" className="hover:underline">現場一覧</a>
            <a href="/estimates" className="hover:underline">見積り</a>
            <a href="/attendance" className="hover:underline">出面</a>
            <a href="/master" className="hover:underline">マスタ</a>
          </nav>
        </header>
        <main className="app-main max-w-2xl mx-auto px-4 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
