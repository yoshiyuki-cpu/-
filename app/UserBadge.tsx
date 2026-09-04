'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useDeviceUser, setUser } from '@/lib/user'

type Worker = { id: number; name: string; is_foreman: boolean }

// 上の帯の右端。この端末を使っている人の名前を出し、押すと選び直せる。
// 名前が無い端末には「名前を選ぶ」と出す（押すまで業務は止めない）
export default function UserBadge() {
  const user = useDeviceUser()
  const [open, setOpen] = useState(false)
  const [workers, setWorkers] = useState<Worker[]>([])

  useEffect(() => {
    if (!open) return
    supabase.from('workers').select('id, name, is_foreman').eq('in_dispatch', true).order('name')
      .then(({ data }) => {
        const list = (data ?? []) as Worker[]
        setWorkers([...list.filter(w => w.is_foreman), ...list.filter(w => !w.is_foreman)])
      })
  }, [open])

  return (
    <>
      <button onClick={() => setOpen(true)}
        className={`ml-auto shrink-0 text-xs rounded-full px-2.5 py-1 border transition ${user ? 'border-white/30 bg-white/10 text-white' : 'border-amber-300/70 bg-amber-400/20 text-amber-100'}`}>
        {user ? `👷 ${user.name}` : '名前を選ぶ'}
      </button>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 text-gray-900" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-t-2xl shadow-xl p-4 w-full max-w-md max-h-[75vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">この端末を使うのは誰ですか？</h3>
            <p className="text-xs text-gray-500 mb-3">
              ごみ箱・完工・記録の修正などに、この名前が残ります。人に貸すときは選び直してください。
            </p>
            <div className="flex flex-col gap-1.5">
              {workers.length === 0 && <p className="text-sm text-gray-400 py-4 text-center">読み込み中...</p>}
              {workers.map(w => (
                <button key={w.id} onClick={() => { setUser({ id: w.id, name: w.name }); setOpen(false) }}
                  className={`w-full text-left rounded-xl px-3 py-3 text-base border ${user?.id === w.id ? 'border-blue-500 bg-blue-50 font-medium' : 'border-gray-200'}`}>
                  {w.name}{w.is_foreman && <span className="text-xs text-gray-400 ml-2">職長</span>}
                </button>
              ))}
            </div>
            {user && (
              <button onClick={() => { setUser(null); setOpen(false) }} className="w-full mt-3 py-2 text-sm text-gray-500">
                名前を外す
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
