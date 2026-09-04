import type { Metadata } from "next";
import "./globals.css";
import BottomNav from "./BottomNav";
import SplashScreen from "./SplashScreen";
import DesignProvider from "./DesignProvider";
import OfflineBanner from "./OfflineBanner";

export const metadata: Metadata = {
  title: "良心アプリ",
  description: "解体工事の工事台帳アプリ",
};

// 画面が出る前に、端末に保存したデザイン設定を <html data-design> に付ける。
// React が動き出す前に効かせないと、従来の見た目が一瞬出てから切り替わる
const designBootScript = `try{document.documentElement.dataset.design=localStorage.getItem('ryoshin_design')==='v2'?'v2':'v1'}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" data-design="v1">
      <body className="min-h-screen">
        <script dangerouslySetInnerHTML={{ __html: designBootScript }} />
        <DesignProvider />
        <SplashScreen />
        <header className="app-header no-print sticky top-0 z-30 bg-gradient-to-r from-slate-900 via-blue-900 to-blue-800 text-white px-4 py-3 shadow-md">
          <div className="max-w-2xl mx-auto flex items-center gap-3">
            <div className="app-header-logo w-9 h-9 rounded-xl bg-white/15 backdrop-blur flex items-center justify-center font-bold text-lg shadow-inner shrink-0">
              良
            </div>
            <div className="leading-tight">
              <p className="app-header-company text-[10px] tracking-widest text-blue-200/90">株式会社良心</p>
              <p className="app-header-title text-lg font-bold">良心アプリ</p>
            </div>
          </div>
        </header>
        <OfflineBanner />
        <main className="app-main max-w-2xl mx-auto px-4 py-6 pb-28">
          {children}
        </main>
        <BottomNav />
      </body>
    </html>
  );
}
