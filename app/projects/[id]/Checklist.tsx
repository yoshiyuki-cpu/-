'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CHECK_ITEMS, loadChecklist, ChecklistState } from '@/lib/checklist'
import { useDeviceUser } from '@/lib/user'

type Worker = { id: number; name: string }

// 現場詳細の上に出す「着工前の確認」。
// 押した人を残す。端末に名前が入っていればそれを使い、無ければその場で選ぶ
export default function Checklist({ projectId }: { projectId: number }) {
  const user = useDeviceUser()
  const [state, setState] = useState<ChecklistState | null>(null)
  const [workers, setWorkers] = useState<Worker[]>([])
  const [picking, setPicking] = useState<string | null>(null)   // 誰が確認したかを選んでいる項目
  const [busy, setBusy] = useState(false)

  useEffect(() => { load() }, [projectId])

  async function load() {
    const [st, { data: wk }] = await Promise.all([
      loadChecklist(supabase, projectId),
      supabase.from('workers').select('id, name, is_foreman').eq('in_dispatch', true).order('name'),
    ])
    setState(st)
    // 職長を先に並べる（確認するのはたいてい職長）
    const list = (wk ?? []) as (Worker & { is_foreman: boolean })[]
    setWorkers([...list.filter(w => w.is_foreman), ...list.filter(w => !w.is_foreman)])
  }

  async function markDone(key: string, workerId: number) {
    setBusy(true)
    const { error } = await supabase.from('project_checks').upsert(
      { project_id: projectId, key, done_at: new Date().toISOString(), done_by: workerId },
      { onConflict: 'project_id,key' },
    )
    setBusy(false)
    if (error) {
      alert(error.message.includes('project_checks')
        ? '着工前確認の準備がまだです。Supabaseで supabase-schema-project-checks.sql を実行してください。'
        : '保存できませんでした。')
      return
    }
    setPicking(null)
    await load()
  }

  async function undo(key: string) {
    if (!confirm('確認を取り消しますか？')) return
    setBusy(true)
    await supabase.from('project_checks').update({ done_at: null, done_by: null }).eq('project_id', projectId).eq('key', key)
    setBusy(false)
    await load()
  }

  function tap(key: string) {
    if (busy) return
    if (user) markDone(key, user.id)
    else setPicking(key)
  }

  if (!state) return null
  const doneCount = CHECK_ITEMS.filter(i => state.checks[i.key]?.done_at).length
  const allDone = doneCount === CHECK_ITEMS.length
  const nameOf = (id: number | null) => workers.find(w => w.id === id)?.name ?? ''

  return (
    <section className={`rounded-2xl border shadow-sm p-4 mb-4 ${allDone ? 'bg-white border-gray-100' : 'bg-amber-50 border-amber-200'}`}>
      <div className="flex justify-between items-center mb-2">
        <h2 className="font-bold text-gray-700">着工前の確認</h2>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${allDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}`}>
          {doneCount} / {CHECK_ITEMS.length}
        </span>
      </div>

      {state.missingTable && (
        <p className="text-xs text-amber-800 mb-2">
          準備がまだです。Supabaseで <span className="font-mono">supabase-schema-project-checks.sql</span> を実行すると使えます。
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {CHECK_ITEMS.map(item => {
          const c = state.checks[item.key]
          const done = !!c?.done_at
          const extra = item.key === 'pipes' ? `管路図 ${state.pipeCount}枚`
            : item.key === 'ky' ? `KY写真 ${state.kyCount}枚` : null
          return (
            <button key={item.key} type="button" disabled={busy || state.missingTable}
              onClick={() => done ? undo(item.key) : tap(item.key)}
              className={`w-full text-left flex items-start gap-3 rounded-xl px-3 py-2.5 border transition disabled:opacity-50
                ${done ? 'bg-white border-gray-100' : 'bg-white border-amber-200'}`}>
              <span className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0
                ${done ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-amber-400 text-transparent'}`}>✓</span>
              <span className="min-w-0 flex-1">
                <span className={`block text-sm font-medium ${done ? 'text-gray-500 line-through' : 'text-gray-800'}`}>{item.label}</span>
                {done
                  ? <span className="block text-[11px] text-gray-400">{nameOf(c!.done_by)}　{c!.done_at!.slice(0, 10)}</span>
                  : <span className="block text-[11px] text-gray-500">{item.hint}{extra ? `　（${extra}）` : ''}</span>}
              </span>
            </button>
          )
        })}
      </div>

      {!allDone && !state.missingTable && (
        <p className="text-[11px] text-gray-500 mt-2">
          押すと確認済みになり、{user ? `${user.name}さんの名前で` : '確認した人の名前と一緒に'}残ります。
        </p>
      )}

      {picking && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={() => setPicking(null)}>
          <div className="bg-white rounded-t-2xl shadow-xl p-4 w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">確認したのは誰ですか？</h3>
            <p className="text-xs text-gray-500 mb-3">{CHECK_ITEMS.find(i => i.key === picking)?.label}</p>
            <div className="flex flex-col gap-1.5">
              {workers.map(w => (
                <button key={w.id} onClick={() => markDone(picking, w.id)} disabled={busy}
                  className="w-full text-left border border-gray-200 rounded-xl px-3 py-3 text-base disabled:opacity-40">
                  {w.name}
                </button>
              ))}
            </div>
            <button onClick={() => setPicking(null)} className="w-full mt-3 py-2 text-sm text-gray-500">やめる</button>
          </div>
        </div>
      )}
    </section>
  )
}
