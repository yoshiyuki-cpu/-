'use client'
import { useEffect, useState } from 'react'
import { supabase, CalendarEvent, CalendarEventType, Task } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import DailyCost from './DailyCost'
import TaskList from '../tasks/TaskList'

type Foreman = { id: number; name: string }
type Tab = 'plan' | 'todo' | 'cost'

const TYPE_LABELS: Record<CalendarEventType, string> = {
  construction_start: '着工',
  night_shift: '夜勤',
  estimate: '見積り',
  other: 'その他',
}

const TYPE_STYLES: Record<CalendarEventType, string> = {
  construction_start: 'bg-blue-100 text-blue-700',
  night_shift: 'bg-indigo-100 text-indigo-700',
  estimate: 'bg-emerald-100 text-emerald-700',
  other: 'bg-gray-100 text-gray-600',
}


function formatDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, day).getDay()]
  return `${m}/${day}（${weekday}）`
}

export default function CalendarPage() {
  const [tab, setTab] = useState<Tab>('plan')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  // 期限のある未完了のやること。予定と同じ日付の並びに出す
  const [dueTasks, setDueTasks] = useState<Task[]>([])
  const [workerNames, setWorkerNames] = useState<Record<number, string>>({})
  const [recipients, setRecipients] = useState<Record<number, number[]>>({})
  const [foremen, setForemen] = useState<Foreman[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    title: '', event_type: 'construction_start' as CalendarEventType,
    event_date: jstToday(), note: '', notify_all: true,
  })
  const [formRecipientIds, setFormRecipientIds] = useState<number[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: ev }, { data: rc }, { data: fm }, { data: tk }, { data: wk }] = await Promise.all([
      supabase.from('calendar_events').select('*').gte('event_date', jstToday()).order('event_date'),
      supabase.from('calendar_event_recipients').select('event_id, worker_id'),
      supabase.from('workers').select('id, name').eq('is_foreman', true).order('name'),
      // 遅れているものも見せたいので、期限が過ぎた分も取る
      supabase.from('tasks').select('*').is('done_at', null).not('due_date', 'is', null).order('due_date'),
      supabase.from('workers').select('id, name'),
    ])
    setEvents(ev ?? [])
    setDueTasks(tk ?? [])
    const names: Record<number, string> = {}
    ;(wk ?? []).forEach((w: { id: number; name: string }) => { names[w.id] = w.name })
    setWorkerNames(names)
    const grouped: Record<number, number[]> = {}
    ;(rc ?? []).forEach((r: any) => {
      grouped[r.event_id] = [...(grouped[r.event_id] ?? []), r.worker_id]
    })
    setRecipients(grouped)
    setForemen(fm ?? [])
    setLoading(false)
  }

  async function addEvent() {
    if (!form.title || !form.event_date) return
    setAdding(true)
    const { data } = await supabase.from('calendar_events').insert({
      title: form.title,
      event_type: form.event_type,
      event_date: form.event_date,
      note: form.note || null,
      notify_all: form.notify_all,
    }).select().single()

    if (data && !form.notify_all && formRecipientIds.length > 0) {
      await supabase.from('calendar_event_recipients').insert(
        formRecipientIds.map(worker_id => ({ event_id: data.id, worker_id }))
      )
    }

    setForm({ title: '', event_type: 'construction_start', event_date: jstToday(), note: '', notify_all: true })
    setFormRecipientIds([])
    setAdding(false)
    load()
  }

  async function deleteEvent(id: number) {
    if (!confirm('この予定を削除しますか？')) return
    await supabase.from('calendar_events').delete().eq('id', id)
    load()
  }

  function toggleFormRecipient(id: number) {
    setFormRecipientIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function recipientLabel(e: CalendarEvent) {
    if (e.notify_all) return '全職長へ通知'
    const names = (recipients[e.id] ?? []).map(id => foremen.find(f => f.id === id)?.name).filter(Boolean)
    return names.length > 0 ? `${names.join('・')}へ通知` : '通知先なし'
  }

  const grouped = events.reduce<Record<string, CalendarEvent[]>>((acc, e) => {
    acc[e.event_date] = [...(acc[e.event_date] ?? []), e]
    return acc
  }, {})
  // やることも期限の日に入れる。予定が無い日でも期限があれば日付を出す
  const tasksByDate = dueTasks.reduce<Record<string, Task[]>>((acc, t) => {
    const d = t.due_date as string
    acc[d] = [...(acc[d] ?? []), t]
    return acc
  }, {})
  const today = jstToday()
  const allDates = [...new Set([...Object.keys(grouped), ...Object.keys(tasksByDate)])].sort()

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">共有カレンダー</h1>

      <div className="flex gap-2 mb-4">
        <button onClick={() => setTab('plan')}
          className={`flex-1 py-2 rounded-full text-sm font-medium transition ${tab === 'plan' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
          予定
        </button>
        <button onClick={() => setTab('todo')}
          className={`flex-1 py-2 rounded-full text-sm font-medium transition ${tab === 'todo' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
          やる事
        </button>
        <button onClick={() => setTab('cost')}
          className={`flex-1 py-2 rounded-full text-sm font-medium transition ${tab === 'cost' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
          日別の費用
        </button>
      </div>

      {tab === 'todo' && <TaskList embedded />}
      {tab === 'cost' && <DailyCost />}

      {tab === 'plan' && (
      <>
      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">予定を追加</h2>
        <p className="text-xs text-gray-500 mb-3">登録した予定は、前日の夕方17:30に通知先へリマインドされます。</p>
        <div className="flex flex-col gap-2">
          <input className="border border-gray-200 rounded-xl px-3 py-2 text-sm" value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })} placeholder="予定名（例：東花尻 着工）" />
          <div className="flex gap-2">
            <select className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" value={form.event_type}
              onChange={e => setForm({ ...form, event_type: e.target.value as CalendarEventType })}>
              {(Object.keys(TYPE_LABELS) as CalendarEventType[]).map(t => (
                <option key={t} value={t}>{TYPE_LABELS[t]}</option>
              ))}
            </select>
            <input type="date" className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" value={form.event_date}
              onChange={e => setForm({ ...form, event_date: e.target.value })} />
          </div>
          <textarea className="border border-gray-200 rounded-xl px-3 py-2 text-sm" rows={2} value={form.note}
            onChange={e => setForm({ ...form, note: e.target.value })} placeholder="メモ（任意）" />

          <div className="border border-gray-200 rounded-xl p-3 bg-gray-50">
            <p className="text-sm font-medium mb-2">通知先</p>
            <label className="flex items-center gap-2 text-sm mb-1">
              <input type="radio" checked={form.notify_all} onChange={() => setForm({ ...form, notify_all: true })} />
              全職長に通知
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" checked={!form.notify_all} onChange={() => setForm({ ...form, notify_all: false })} />
              指定した職長のみ
            </label>
            {!form.notify_all && (
              <div className="flex flex-col gap-1 mt-2 pl-5">
                {foremen.length === 0 && <p className="text-xs text-gray-400">職長が登録されていません</p>}
                {foremen.map(f => (
                  <label key={f.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={formRecipientIds.includes(f.id)} onChange={() => toggleFormRecipient(f.id)} />
                    {f.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          <button onClick={addEvent} disabled={!form.title || adding}
            className="bg-blue-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">
            {adding ? '追加中...' : '予定を追加'}
          </button>
        </div>
      </section>

      <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
        <h2 className="font-bold mb-1 text-gray-700">今後の予定</h2>
        <p className="text-xs text-gray-400 mb-3">期限のあるやることも、その日に出ます。</p>
        {loading && <p className="text-sm text-gray-400">読み込み中...</p>}
        {!loading && allDates.length === 0 && <p className="text-sm text-gray-400">予定はありません。</p>}
        <div className="flex flex-col gap-3">
          {allDates.map(date => {
            const list = grouped[date] ?? []
            const dayTasks = tasksByDate[date] ?? []
            const isLate = date < today
            return (
            <div key={date}>
              <p className={`text-xs font-semibold mb-1 ${isLate ? 'text-red-600' : 'text-gray-500'}`}>
                {formatDate(date)}{isLate && '　期限切れ'}
              </p>
              <div className="flex flex-col gap-1">
                {dayTasks.map(t => (
                  <button key={`t${t.id}`} onClick={() => setTab('todo')}
                    className={`flex items-center gap-2 border rounded-xl px-3 py-2 text-left ${isLate ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                    <span className={`text-xs px-1.5 py-0.5 rounded shrink-0 ${isLate ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>やること</span>
                    <span className="text-sm font-medium truncate">{t.title}</span>
                    {t.assignee_id && workerNames[t.assignee_id] && (
                      <span className="text-[11px] text-gray-500 shrink-0 ml-auto">{workerNames[t.assignee_id]}</span>
                    )}
                  </button>
                ))}
                {list.map(e => (
                  <div key={e.id} className="flex justify-between items-start border border-gray-100 rounded-xl px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${TYPE_STYLES[e.event_type]}`}>{TYPE_LABELS[e.event_type]}</span>
                        <span className="text-sm font-medium truncate">{e.title}</span>
                      </div>
                      {e.note && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{e.note}</p>}
                      <p className="text-[11px] text-gray-400 mt-0.5">{recipientLabel(e)}</p>
                    </div>
                    <button onClick={() => deleteEvent(e.id)} className="text-gray-300 hover:text-red-400 text-xs shrink-0 ml-2">削除</button>
                  </div>
                ))}
              </div>
            </div>
            )
          })}
        </div>
      </section>
      </>
      )}
    </div>
  )
}
