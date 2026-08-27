'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV_ITEMS = [
  { href: '/', label: '現場', icon: '🏗️' },
  { href: '/dispatch', label: '段取り', icon: '🚚' },
  { href: '/tasks', label: 'やる事', icon: '✅' },
  { href: '/estimates', label: '見積', icon: '📄' },
  { href: '/scaffold', label: '足場', icon: '📐' },
  { href: '/attendance', label: '出面', icon: '🗓️' },
  { href: '/calendar', label: '予定', icon: '📅' },
  { href: '/master', label: 'マスタ', icon: '⚙️' },
]

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="no-print fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-lg border-t border-gray-200/80 flex z-40 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {NAV_ITEMS.map(item => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link key={item.href} href={item.href}
            className={`flex-1 min-w-0 flex flex-col items-center gap-0.5 pt-1.5 pb-2 text-[10px] transition ${active ? 'text-blue-700 font-semibold' : 'text-gray-400 font-medium'}`}>
            <span className={`text-lg leading-none px-2.5 py-1 rounded-full transition ${active ? 'bg-blue-100/80' : 'opacity-55'}`}>
              {item.icon}
            </span>
            <span className="truncate max-w-full">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
