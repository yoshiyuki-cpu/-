'use client'
import { useState } from 'react'
import { supabase, Project } from '@/lib/supabase'
import { logAction } from '@/lib/audit'

// 現場詳細の「建物情報」カード。壊す建物の基本情報を1か所にまとめる。
// 見積・段取り・アスベストの事前調査で毎回聞かれる項目だけに絞ってある。
const STRUCTURES = ['木造', '鉄骨造', 'RC造', 'SRC造', '混構造', 'その他']
const ASBESTOS = ['未調査', '調査済み なし', '調査済み あり']
const USAGE_HINTS = ['住宅', 'アパート', '店舗', '事務所', '倉庫', '工場', '車庫', '物置']

type Form = {
  structure: string
  floors: string
  floorArea: string
  builtYear: string
  usage: string
  asbestos: string
  notes: string
}

function toForm(p: Project): Form {
  return {
    structure: p.building_structure ?? '',
    floors: p.building_floors != null ? String(p.building_floors) : '',
    floorArea: p.building_floor_area != null ? String(p.building_floor_area) : '',
    builtYear: p.building_built_year != null ? String(p.building_built_year) : '',
    usage: p.building_usage ?? '',
    asbestos: p.building_asbestos ?? '',
    notes: p.building_notes ?? '',
  }
}

function num(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export default function BuildingInfo({ project, onSaved }: { project: Project; onSaved: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<Form>(() => toForm(project))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  function startEdit() {
    setForm(toForm(project))
    setMessage('')
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    setMessage('')
    const { error } = await supabase.from('projects').update({
      building_structure: form.structure || null,
      building_floors: num(form.floors),
      building_floor_area: num(form.floorArea),
      building_built_year: num(form.builtYear),
      building_usage: form.usage.trim() || null,
      building_asbestos: form.asbestos || null,
      building_notes: form.notes.trim() || null,
    }).eq('id', project.id)
    setSaving(false)
    if (error) {
      setMessage(error.message.includes('building_')
        ? '建物情報の準備がまだです。Supabaseで supabase-schema-building-info.sql を実行してください。'
        : '保存できませんでした。もう一度お試しください。')
      return
    }
    logAction(supabase, 'edit', 'projects', project.id, `${project.name} の建物情報を直した`)
    setEditing(false)
    onSaved()
  }

  // 表示用。入っている項目だけ並べる
  const thisYear = new Date().getFullYear()
  const rows: [string, string][] = []
  if (project.building_structure) rows.push(['構造', project.building_structure])
  if (project.building_floors != null) rows.push(['階数', `${project.building_floors}階建`])
  if (project.building_floor_area != null) rows.push(['延床面積', `${Number(project.building_floor_area).toLocaleString()} ㎡`])
  if (project.building_built_year != null) {
    const age = thisYear - project.building_built_year
    rows.push(['建築年', `${project.building_built_year}年${age >= 0 ? `（築${age}年）` : ''}`])
  }
  if (project.building_usage) rows.push(['用途', project.building_usage])
  if (project.building_asbestos) rows.push(['アスベスト', project.building_asbestos])
  if (project.building_notes) rows.push(['備考', project.building_notes])

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
      <div className="flex justify-between items-center mb-1">
        <h2 className="font-bold text-gray-700 text-sm">建物情報</h2>
        {!editing && <button onClick={startEdit} className="text-xs text-blue-600">編集</button>}
      </div>

      {editing ? (
        <div className="flex flex-col gap-3 mt-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">構造</label>
              <select className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base bg-white"
                value={form.structure} onChange={set('structure')}>
                <option value="">未選択</option>
                {STRUCTURES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">階数（地上）</label>
              <input type="text" inputMode="numeric" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
                value={form.floors} onChange={set('floors')} placeholder="例：2" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">延床面積（㎡）</label>
              <input type="text" inputMode="decimal" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
                value={form.floorArea} onChange={set('floorArea')} placeholder="例：120.5" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">建築年（西暦）</label>
              <input type="text" inputMode="numeric" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
                value={form.builtYear} onChange={set('builtYear')} placeholder="例：1985" />
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">用途</label>
            <input type="text" list="building-usage-hints" className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base"
              value={form.usage} onChange={set('usage')} placeholder="例：住宅、店舗、倉庫" />
            <datalist id="building-usage-hints">
              {USAGE_HINTS.map(u => <option key={u} value={u} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">アスベスト</label>
            <div className="flex gap-2">
              {ASBESTOS.map(a => (
                <button key={a} type="button" onClick={() => setForm(f => ({ ...f, asbestos: f.asbestos === a ? '' : a }))}
                  className={`flex-1 py-2 rounded-full text-sm font-medium transition ${form.asbestos === a ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-500 border border-gray-200'}`}>
                  {a}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">備考</label>
            <textarea className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none" rows={3}
              value={form.notes} onChange={set('notes')} placeholder="隣接状況、電柱・引込線、残置物、地下室の有無など" />
          </div>
          {message && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{message}</p>}
          <div className="flex gap-2">
            <button onClick={() => setEditing(false)} disabled={saving}
              className="flex-1 py-2 border border-gray-200 rounded-xl text-sm text-gray-600">キャンセル</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40">
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">未記入（「編集」から構造・階数・延床・建築年・アスベストなどを入れられます）</p>
      ) : (
        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <span className="text-gray-500">{k}</span>
              <span className="text-gray-800 whitespace-pre-wrap">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
