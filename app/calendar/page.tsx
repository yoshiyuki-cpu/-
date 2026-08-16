'use client'
import { useEffect, useState } from 'react'
import { supabase, CalendarEvent, CalendarEventType } from '@/lib/supabase'

type Foreman = { id: number; name: string }

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

const today = new Date().toISOString().split('T')[0]

function formatDate(d: string) {
  const [y, m, day] = d.split('-').map(Number)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, day).getDay()]
  return `${m}/${day}（${weekday}）`
}

export default function CalendarPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [recipients, setRecipients] = useState<Record<number, number[]>>({})
  const [foremen, setForemen] = useState<Foreman[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({
    title: '', event_type: 'construction_start' as CalendarEventType,
    event_date: today, note: '', notify_all: true,
  })
  const [formRecipientIds, setFormRecipientIds] = useState<number[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [{ data: ev }, { data: rc }, { data: fm }] = await Promise.all([
      supabase.from('calendar_events').select('*').gte('event_date', today).order('event_date'),
      supabase.from('calendar_event_recipients').select('event_id, worker_id'),
      supabase.from('workers').select('id, name').eq('is_foreman', true).order('name'),
    ])
    setEvents(ev ?? [])
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

    setForm({ title: '', event_type: 'construction_start', event_date: today, note: '', notify_all: true })
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

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">共有カレンダー</h1>

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
        <h2 className="font-bold mb-3 text-gray-700">今後の予定</h2>
        {loading && <p className="text-sm text-gray-400">読み込み中...</p>}
        {!loading && events.length === 0 && <p className="text-sm text-gray-400">予定はありません。</p>}
        <div className="flex flex-col gap-3">
          {Object.entries(grouped).map(([date, list]) => (
            <div key={date}>
              <p className="text-xs font-semibold text-gray-500 mb-1">{formatDate(date)}</p>
              <div className="flex flex-col gap-1">
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
          ))}
        </div>
      </section>
    </div>
  )
}
