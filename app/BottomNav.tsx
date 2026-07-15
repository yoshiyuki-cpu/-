'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: '現場一覧', icon: '🏗️' },
  { href: '/estimates', label: '見積り', icon: '📄' },
  { href: '/scaffold', label: '足場計算', icon: '📐' },
  { href: '/attendance', label: '出面', icon: '🗓️' },
  { href: '/master', label: 'マスタ', icon: '⚙️' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="no-print fixed bottom-0 left-0 right-0 bg-white border-t flex z-40" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {NAV_ITEMS.map(item => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition ${active ? 'text-blue-600' : 'text-gray-400'}`}>
            <span className={`text-xl leading-none transition ${active ? '' : 'opacity-60'}`}>{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
