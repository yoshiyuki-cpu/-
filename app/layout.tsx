import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "./BottomNav";

export const metadata: Metadata = {
  title: "良心アプリ",
  description: "解体工事の工事台帳アプリ",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen">
        <header className="no-print sticky top-0 z-30 bg-gradient-to-r from-slate-900 via-blue-900 to-blue-800 text-white px-4 py-3 shadow-md">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center font-bold text-lg shadow-inner shrink-0">
              良
            </div>
            <div className="leading-tight">
              <p className="text-[10px] tracking-widest text-blue-200/90">株式会社良心</p>
              <p className="text-lg font-bold">良心アプリ</p>
            </div>
          </div>
        </header>
        <main className="app-main max-w-2xl mx-auto px-4 py-6 pb-28">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
