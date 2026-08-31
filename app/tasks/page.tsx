'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase, Task, Project } from '@/lib/supabase'

type Worker = { id: number; name: string }
type Tab = 'todo' | 'done' | 'stats'

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
  // 達成ボタンを押したときに「誰が達成したか」を選ばせる対象のタスク。
  // 評価に使う記録なので端末の記憶で自動的に決めず、毎回本人に選んでもらう
  const [completing, setCompleting] = useState<Task | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [message, setMessage] = useState('')

  useEffect(() => { load() }, [])

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

  // 評価に使う集計。誰が何件達成したかを今月と累計で出す
  const stats = useMemo(() => {
    const now = new Date()
    const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const rows = workers.map(w => {
      const mine = done.filter(t => t.done_by === w.id)
      return {
        id: w.id,
        name: w.name,
        month: mine.filter(t => (t.done_at ?? '').startsWith(monthPrefix)).length,
        total: mine.length,
      }
    }).filter(r => r.total > 0)
    rows.sort((a, b) => b.month - a.month || b.total - a.total)
    // 達成者が記録されていない完了分も見えるようにしておく
    const unknown = done.filter(t => !t.done_by).length
    return { rows, unknown, monthLabel: `${now.getMonth() + 1}月` }
  }, [workers, done])

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

  // 未完了に戻す（達成者の記録も消す）
  async function undoDone(t: Task) {
    if (!confirm(`「${t.title}」を未完了に戻しますか？\n達成者の記録も消えます。`)) return
    const { error } = await supabase.from('tasks').update({ done_at: null, done_by: null }).eq('id', t.id)
    if (error) { setMessage('戻せませんでした。'); return }
    setTasks(ts => ts.map(x => x.id === t.id ? { ...x, done_at: null, done_by: null } : x))
  }

  // 選んだ人を達成者として記録する
  async function completeBy(workerId: number) {
    if (!completing) return
    const patch = { done_at: new Date().toISOString(), done_by: workerId }
    const { error } = await supabase.from('tasks').update(patch).eq('id', completing.id)
    if (error) { setMessage('達成を記録できませんでした。'); return }
    setTasks(ts => ts.map(x => x.id === completing.id ? { ...x, ...patch } : x))
    setCompleting(null)
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

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const tabClass = (t: Tab) =>
    `flex-1 py-2 rounded-full text-sm font-medium transition ${tab === t ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`
  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm'

  return (
    <div>
      <div className="mb-3">
        <h1 className="text-xl font-bold">やること</h1>
        <p className="text-xs text-gray-500 mt-0.5">丸を押して自分の名前を選ぶと達成になり、誰がやったかが記録に残ります。</p>
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
        <button className={tabClass('stats')} onClick={() => setTab('stats')}>集計</button>
      </div>

      {tab === 'stats' && (
        <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h2 className="font-bold text-sm text-gray-700 mb-1">達成した件数</h2>
          <p className="text-xs text-gray-500 mb-3">誰がどれだけやったかの記録です。</p>
          {stats.rows.length === 0
            ? <p className="text-sm text-gray-400">まだ達成の記録がありません。</p>
            : (
              <>
                <div className="flex text-xs text-gray-400 pb-1.5 border-b">
                  <span className="flex-1">名前</span>
                  <span className="w-16 text-right">{stats.monthLabel}</span>
                  <span className="w-16 text-right">累計</span>
                </div>
                {stats.rows.map(r => (
                  <div key={r.id} className="flex items-center text-sm py-2.5 border-b last:border-0">
                    <span className="flex-1">{r.name}</span>
                    <span className="w-16 text-right font-bold">{r.month}</span>
                    <span className="w-16 text-right text-gray-500">{r.total}</span>
                  </div>
                ))}
              </>
            )}
          {stats.unknown > 0 && (
            <p className="text-xs text-gray-400 mt-3">達成者が記録されていない完了：{stats.unknown}件</p>
          )}
        </section>
      )}

      {tab !== 'stats' && projects.length > 0 && (
        <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 bg-white">
          <option value="all">すべての現場</option>
          <option value="">現場なし（事務など）</option>
          {projects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
        </select>
      )}

      {tab !== 'stats' && shown.length === 0 && (
        <p className="text-gray-500 text-center py-10 text-sm">
          {tab === 'todo' ? 'やることはありません。' : '完了したものはまだありません。'}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {tab !== 'stats' && shown.map(t => {
          const due = t.due_date && !t.done_at ? dueLabel(t.due_date) : null
          const meta = [projectOf(t.project_id), nameOf(t.assignee_id) && `担当 ${nameOf(t.assignee_id)}`]
            .filter(Boolean).join(' · ')
          return (
            <div key={t.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm flex items-start gap-3 p-3.5">
              <button onClick={() => t.done_at ? undoDone(t) : setCompleting(t)}
                aria-label={t.done_at ? '未完了に戻す' : '達成にする'}
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

      {/* 達成者を選ぶ。評価に使う記録なので毎回本人に選んでもらう */}
      {completing && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setCompleting(null)}>
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">達成したのは誰ですか？</h3>
            <p className="text-xs text-gray-500 mb-1">{completing.title}</p>
            <p className="text-xs text-gray-400 mb-3">自分の名前を探して押すと達成になります。</p>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1.5">
              {workers.map(w => (
                <button key={w.id} onClick={() => completeBy(w.id)}
                  className="text-left px-3 py-3 rounded-xl border border-gray-200 text-sm active:bg-blue-50">
                  {w.name}
                </button>
              ))}
            </div>
            <button onClick={() => setCompleting(null)}
              className="mt-3 w-full border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm">やめる</button>
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
