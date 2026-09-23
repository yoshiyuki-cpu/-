'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

// 現場詳細の「担当の職長」。ここで決めた職長に、朝7:50と夕17:30の通知がこの現場の分で届く。
// 今まではマスタの作業員の編集の奥にしかなく、1件しか入っていなかった（通知がほぼ誰にも届いていなかった）。
export default function ForemanAssign({ projectId, projectName }: { projectId: number; projectName: string }) {
  const [foremen, setForemen] = useState<{ id: number; name: string }[]>([])
  const [assigned, setAssigned] = useState<number[]>([])
  const [busy, setBusy] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('workers').select('id, name').eq('is_foreman', true).order('name'),
      supabase.from('foreman_projects').select('worker_id').eq('project_id', projectId),
    ]).then(([{ data: f }, { data: a }]) => {
      if (cancelled) return
      setForemen((f ?? []) as { id: number; name: string }[])
      setAssigned(((a ?? []) as { worker_id: number }[]).map(r => r.worker_id))
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [projectId])

  async function toggle(f: { id: number; name: string }) {
    setBusy(f.id)
    const on = assigned.includes(f.id)
    const { error } = on
      ? await supabase.from('foreman_projects').delete().eq('worker_id', f.id).eq('project_id', projectId)
      : await supabase.from('foreman_projects').insert({ worker_id: f.id, project_id: projectId })
    setBusy(null)
    if (error) { alert('担当を変えられませんでした。もう一度お試しください。'); return }
    setAssigned(prev => (on ? prev.filter(x => x !== f.id) : [...prev, f.id]))
    logAction(supabase, 'edit', 'projects', projectId, `${projectName} の担当の職長から${f.name}を${on ? '外した' : '入れた'}`)
  }

  if (!loaded) return null
  return (
    <div className={`bg-white rounded-2xl border p-3 mb-3 ${assigned.length ? 'border-gray-100' : 'border-amber-400'}`}>
      <div className="flex justify-between items-baseline">
        <h2 className="text-sm font-bold text-gray-700">担当の職長</h2>
        {!assigned.length && <span className="text-[11px] font-bold text-amber-800">未設定：朝夕の通知が届きません</span>}
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        {foremen.length === 0 && <p className="text-xs text-gray-500">職長が登録されていません（マスタ → 作業員 で「職長」に印を付けます）。</p>}
        {foremen.map(f => {
          const on = assigned.includes(f.id)
          return (
            <button key={f.id} type="button" onClick={() => toggle(f)} disabled={busy === f.id} aria-pressed={on}
              className={`min-h-10 px-3 rounded-xl text-sm font-bold border ${on ? 'bg-blue-900 border-blue-900 text-white' : 'bg-white border-gray-200 text-gray-700'} disabled:opacity-50`}>
              {f.name}{on ? ' ✓' : ''}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-gray-500 mt-2">押すと担当に入る／外れます。担当の職長に、朝7:50と夕方17:30の通知がこの現場の分で届きます。</p>
    </div>
  )
}
