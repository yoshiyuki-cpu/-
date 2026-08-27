'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase, Task, Project } from '@/lib/supabase'

type Worker = { id: number; name: string }
type Tab = 'todo' | 'done'

// 「自分が誰か」は端末に覚えさせる。ログインが無いので、完了を押した人を
// 毎回選ばせずに達成者として記録するため
const ME_KEY = 'ryoshin-task-me'

function loadMe(): number | null {
  try {
    const v = localStorage.getItem(ME_KEY)
    return v ? Number(v) : null
  } catch { return null }
}
function saveMe(id: number) {
  try { localStorage.setItem(ME_KEY, String(id)) } catch { /* 保存できなくても動作に影響はない */ }
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

// 期限を「あと何日か」で見せる。現場では日付より遅れているかどうかが大事
function dueLabel(due: string) {
  const [y, m, d] = due.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
  const base = `${m}/${d}(${WEEKDAYS[target.getDay()]})`
  if (diff < 0) return { text: `${base} ${-diff}日遅れ`, tone: 'late' as const }
  if (diff === 0) return { text: `${base} 今日まで`, tone: 'today' as const }
  if (diff === 1) return { text: `${base} 明日まで`, tone: 'soon' as const }
  if (diff <= 3) return { text: `${base} あと${diff}日`, tone: 'soon' as const }
  return { text: `${base}まで`, tone: 'normal' as const }
}

const DUE_TONE: Record<string, string> = {
  late: 'text-red-600 font-semibold',
  today: 'text-orange-600 font-semibold',
  soon: 'text-amber-600',
  normal: 'text-gray-500',
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('todo')
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [me, setMe] = useState<number | null>(null)
  const [pickingMe, setPickingMe] = useState(false)
  const [editing, setEditing] = useState<Task | null>(null)
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [message, setMessage] = useState('')

  useEffect(() => { setMe(loadMe()); load() }, [])

  async function load() {
    const [{ data: t }, { data: pj }, { data: wk }] = await Promise.all([
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('projects').select('*').order('name'),
      supabase.from('workers').select('id, name').order('name'),
    ])
    setTasks(t ?? [])
    setProjects((pj ?? []).filter(p => p.status === 'active' && !p.deleted_at))
    setWorkers(wk ?? [])
    setLoading(false)
  }

  const nameOf = (id: number | null) => id ? (workers.find(w => w.id === id)?.name ?? '') : ''
  const projectOf = (id: number | null) => id ? (projects.find(p => p.id === id)?.name ?? '') : ''

  const todo = useMemo(() => tasks
    .filter(t => !t.done_at)
    // 期限のあるものを近い順に、期限なしは後ろへ
    .sort((a, b) => {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
      return b.created_at.localeCompare(a.created_at)
    }), [tasks])

  const done = useMemo(() => tasks
    .filter(t => t.done_at)
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? '')), [tasks])

  const shown = (tab === 'todo' ? todo : done)
    .filter(t => projectFilter === 'all' || String(t.project_id ?? '') === projectFilter)

  async function addTask() {
    const title = newTitle.trim()
    if (!title) return
    setAdding(true)
    const { data, error } = await supabase.from('tasks').insert({ title }).select('*').single()
    setAdding(false)
    if (error) { setMessage('追加できませんでした。'); return }
    setTasks(ts => [data!, ...ts])
    setNewTitle('')
  }

  // 完了を押した人を達成者として記録する。まだ「自分」が決まっていなければ先に選んでもらう
  async function toggleDone(t: Task) {
    if (t.done_at) {
      await supabase.from('tasks').update({ done_at: null, done_by: null }).eq('id', t.id)
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, done_at: null, done_by: null } : x))
      return
    }
    if (!me) { setPickingMe(true); return }
    const patch = { done_at: new Date().toISOString(), done_by: me }
    await supabase.from('tasks').update(patch).eq('id', t.id)
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, ...patch } : x))
  }

  async function saveEdit() {
    if (!editing) return
    const title = editing.title.trim()
    if (!title) return
    const patch = {
      title,
      note: editing.note || null,
      project_id: editing.project_id,
      assignee_id: editing.assignee_id,
      due_date: editing.due_date || null,
      done_by: editing.done_by,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('tasks').update(patch).eq('id', editing.id)
    if (error) { setMessage('保存できませんでした。'); return }
    setTasks(ts => ts.map(x => x.id === editing.id ? { ...x, ...patch } : x))
    setEditing(null)
  }

  async function deleteTask(t: Task) {
    if (!confirm(`「${t.title}」を削除しますか？`)) return
    await supabase.from('tasks').delete().eq('id', t.id)
    setTasks(ts => ts.filter(x => x.id !== t.id))
    setEditing(null)
  }

  function chooseMe(id: number) {
    saveMe(id)
    setMe(id)
    setPickingMe(false)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const tabClass = (t: Tab) =>
    `flex-1 py-2 rounded-full text-sm font-medium transition ${tab === t ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`
  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'

  return (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold">やること</h1>
          <p className="text-xs text-gray-500 mt-0.5">丸を押すと完了になり、押した人が達成者として残ります。</p>
        </div>
        <button onClick={() => setPickingMe(true)} className="shrink-0 text-xs text-blue-600 mt-1">
          {me ? `自分：${nameOf(me) || '未設定'}` : '自分を設定'}
        </button>
      </div>

      {/* 追加欄。思いついたらすぐ足せるよう一番上に置く */}
      <div className="flex gap-2 mb-4">
        <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTask() }}
          placeholder="やることを入力" className={inputCls} />
        <button onClick={addTask} disabled={adding || !newTitle.trim()}
          className="bg-blue-600 text-white px-4 rounded-lg text-sm font-medium disabled:opacity-40 shrink-0">
          追加
        </button>
      </div>

      <div className="flex gap-2 mb-3">
        <button className={tabClass('todo')} onClick={() => setTab('todo')}>未完了 {todo.length}</button>
        <button className={tabClass('done')} onClick={() => setTab('done')}>完了 {done.length}</button>
      </div>

      {projects.length > 0 && (
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
          <option value="all">すべての現場</option>
          <option value="">現場なし（事務など）</option>
          {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      )}

      {shown.length === 0 && (
        <p className="text-gray-500 text-center py-10 text-sm">
          {tab === 'todo' ? 'やることはありません。' : '完了したものはまだありません。'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {shown.map(t => {
          const due = t.due_date && !t.done_at ? dueLabel(t.due_date) : null
          const meta = [projectOf(t.project_id), nameOf(t.assignee_id) && `担当 ${nameOf(t.assignee_id)}`]
            .filter(Boolean).join(' · ')
          return (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-start gap-3 p-3.5">
              <button onClick={() => toggleDone(t)} aria-label={t.done_at ? '未完了に戻す' : '完了にする'}
                className={`mt-0.5 w-7 h-7 rounded-full border-2 shrink-0 flex items-center justify-center transition ${
                  t.done_at ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-300'
                }`}>
                {t.done_at && <span className="text-sm leading-none">✓</span>}
              </button>

              <button onClick={() => setEditing(t)} className="flex-1 text-left min-w-0">
                <p className={`text-sm ${t.done_at ? 'text-gray-400 line-through' : 'text-gray-900 font-medium'}`}>
                  {t.title}
                </p>
                {meta && <p className="text-xs text-gray-500 mt-0.5">{meta}</p>}
                {due && <p className={`text-xs mt-0.5 ${DUE_TONE[due.tone]}`}>{due.text}</p>}
                {t.done_at && (
                  <p className="text-xs text-emerald-600 mt-0.5">
                    {nameOf(t.done_by) || '担当者'}が{new Date(t.done_at).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}に完了
                  </p>
                )}
                {t.note && <p className="text-xs text-gray-400 mt-0.5 truncate">{t.note}</p>}
              </button>
            </div>
          )
        })}
      </div>

      {message && <p className="text-sm text-red-600 mt-3">{message}</p>}

      {/* 自分を選ぶ。達成者の記録に使う */}
      {pickingMe && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setPickingMe(false)}>
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[75vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">自分の名前を選んでください</h3>
            <p className="text-xs text-gray-500 mb-3">この端末に覚えます。完了したときの達成者として記録されます。</p>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
              {workers.map(w => (
                <button key={w.id} onClick={() => chooseMe(w.id)}
                  className={`text-left px-3 py-2.5 rounded-xl border text-sm ${
                    me === w.id ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-gray-200'
                  }`}>
                  {w.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 編集 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setEditing(null)}>
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">やることの編集</h3>

            <label className="block text-xs text-gray-500 mb-1">内容</label>
            <input value={editing.title} onChange={e => setEditing({ ...editing, title: e.target.value })}
              className={`${inputCls} mb-3`} />

            <label className="block text-xs text-gray-500 mb-1">現場（任意）</label>
            <select value={editing.project_id ?? ''} className={`${inputCls} mb-3 bg-white`}
              onChange={e => setEditing({ ...editing, project_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">なし（事務など）</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>

            <label className="block text-xs text-gray-500 mb-1">担当者（任意）</label>
            <select value={editing.assignee_id ?? ''} className={`${inputCls} mb-3 bg-white`}
              onChange={e => setEditing({ ...editing, assignee_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">なし</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>

            <label className="block text-xs text-gray-500 mb-1">期限（任意）</label>
            <input type="date" value={editing.due_date ?? ''} className={`${inputCls} mb-3`}
              onChange={e => setEditing({ ...editing, due_date: e.target.value || null })} />

            <label className="block text-xs text-gray-500 mb-1">メモ（任意）</label>
            <input value={editing.note ?? ''} onChange={e => setEditing({ ...editing, note: e.target.value })}
              className={`${inputCls} mb-3`} />

            {editing.done_at && (
              <>
                <label className="block text-xs text-gray-500 mb-1">達成者</label>
                <select value={editing.done_by ?? ''} className={`${inputCls} mb-3 bg-white`}
                  onChange={e => setEditing({ ...editing, done_by: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">なし</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </>
            )}

            <div className="flex gap-2 mb-2">
              <button onClick={saveEdit} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">保存</button>
              <button onClick={() => setEditing(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm">やめる</button>
            </div>
            <button onClick={() => deleteTask(editing)} className="w-full text-xs text-gray-400 hover:text-red-500 py-2">
              このやることを削除
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
