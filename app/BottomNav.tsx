'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLayout } from '@/lib/layout'

type Item = { href: string; label: string; icon: string; match: string[] }

// 新しい画面：毎日開くのは「今日」だけにして、ときどき使うものは「その他」の奥へ（2026-09）
const TODAY_ITEMS: Item[] = [
  { href: '/', label: '今日', icon: '☀️', match: ['/'] },
  { href: '/projects', label: '現場', icon: '🏗️', match: ['/projects'] },
  { href: '/calendar', label: '予定', icon: '📅', match: ['/calendar', '/dispatch', '/attendance'] },
  { href: '/master', label: 'その他', icon: '⚙️', match: ['/master', '/notifications', '/reflection', '/line-reports', '/report', '/usage', '/audit', '/tools'] },
]

// 前の画面（マスタで戻した端末）。やる事・見積・足場は外した
const CLASSIC_ITEMS: Item[] = [
  { href: '/', label: '現場', icon: '🏗️', match: ['/', '/projects'] },
  { href: '/dispatch', label: '段取り', icon: '🚚', match: ['/dispatch'] },
  { href: '/attendance', label: '出面', icon: '🗓️', match: ['/attendance'] },
  { href: '/calendar', label: '予定', icon: '📅', match: ['/calendar'] },
  { href: '/master', label: 'マスタ', icon: '⚙️', match: ['/master'] },
]

function isActive(pathname: string, item: Item) {
  return item.match.some(m => (m === '/' ? pathname === '/' : pathname.startsWith(m)))
}

export default function BottomNav() {
  const pathname = usePathname()
  const layout = useLayout()
  const items = layout === 'classic' ? CLASSIC_ITEMS : TODAY_ITEMS

  return (
    <nav className="no-print fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-200/80 flex z-40 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {items.map(item => {
        const active = isActive(pathname, item)
        return (
          <Link key={item.href} href={item.href}
            className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 pt-1.5 pb-2 text-[11px] transition ${active ? 'text-blue-900 font-bold' : 'text-gray-500 font-medium'}`}>
            <span className={`text-lg leading-none px-3 py-1 rounded-full transition ${active ? 'bg-blue-100/80' : 'opacity-60'}`}>
              {item.icon}
            </span>
            <span className="truncate max-w-full">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
