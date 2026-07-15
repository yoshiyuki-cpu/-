'use client'
import { useEffect, useState } from 'react'
import { supabase, Tool, ToolUsage, Project } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

const today = new Date().toISOString().split('T')[0]

export default function ProjectToolsPage() {
  const { id } = useParams()
  const router = useRouter()
  const [project, setProject] = useState<Project | null>(null)
  const [tools, setTools] = useState<Tool[]>([])
  const [allActiveUsages, setAllActiveUsages] = useState<ToolUsage[]>([])
  const [projectUsages, setProjectUsages] = useState<ToolUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ tool_id: '', quantity: '1', checked_out_at: today, note: '' })
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    const [{ data: p }, { data: t }, { data: au }, { data: pu }] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('tools').select('*').order('name'),
      supabase.from('tool_usages').select('*, tools(name, unit)').is('returned_at', null),
      supabase.from('tool_usages').select('*, tools(name, unit)').eq('project_id', id).order('checked_out_at', { ascending: false }),
    ])
    setProject(p)
    setTools(t ?? [])
    setAllActiveUsages((au as any) ?? [])
    setProjectUsages((pu as any) ?? [])
    setLoading(false)
  }

  function availableQty(toolId: number) {
    const tool = tools.find(t => t.id === toolId)
    if (!tool) return 0
    const out = allActiveUsages.filter(u => u.tool_id === toolId).reduce((s, u) => s + Number(u.quantity), 0)
    return tool.total_quantity - tool.broken_quantity - out
  }

  const selectedTool = tools.find(t => String(t.id) === form.tool_id)
  const available = selectedTool ? availableQty(selectedTool.id) : 0
  const overLimit = selectedTool !== undefined && Number(form.quantity) > available

  async function checkOut(e: React.FormEvent) {
    e.preventDefault()
    if (!form.tool_id || !form.quantity || overLimit) return
    setSaving(true)
    await supabase.from('tool_usages').insert({
      project_id: Number(id),
      tool_id: Number(form.tool_id),
      quantity: Number(form.quantity),
      checked_out_at: form.checked_out_at,
      note: form.note || null,
    })
    setSaving(false)
    setForm({ tool_id: '', quantity: '1', checked_out_at: today, note: '' })
    load()
  }

  async function returnUsage(usageId: number) {
    await supabase.from('tool_usages').update({ returned_at: today }).eq('id', usageId)
    load()
  }

  const activeProjectUsages = projectUsages.filter(u => !u.returned_at)
  const returnedProjectUsages = projectUsages.filter(u => u.returned_at)

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div>
      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3">← 現場詳細</button>
      <h1 className="text-xl font-bold mb-1">使用道具</h1>
      {project && <p className="text-sm text-gray-500 mb-4">{project.name}</p>}

      <section className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">道具を借りる</h2>
        <form onSubmit={checkOut} className="flex flex-col gap-3">
          <div>
            <label className="block text-sm font-medium mb-1">日付</label>
            <input type="date" className="w-full border rounded px-3 py-3 text-base" value={form.checked_out_at}
              onChange={e => setForm({ ...form, checked_out_at: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">道具</label>
            <select className="w-full border rounded px-3 py-3 text-base" value={form.tool_id}
              onChange={e => setForm({ ...form, tool_id: e.target.value })}>
              <option value="">選択してください</option>
              {tools.map(t => (
                <option key={t.id} value={t.id}>{t.name}（使用可能 {availableQty(t.id)}{t.unit}）</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">数量 {selectedTool && `(${selectedTool.unit})`}</label>
            <input type="number" inputMode="numeric" className="w-full border rounded px-3 py-3 text-base" value={form.quantity}
              onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="1" />
            {overLimit && <p className="text-sm text-red-500 mt-1">置き場の使用可能数（{available}{selectedTool?.unit}）を超えています</p>}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">メモ（任意）</label>
            <input className="w-full border rounded px-3 py-3 text-base" value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })} />
          </div>
          <button type="submit" disabled={saving || !form.tool_id || !form.quantity || overLimit}
            className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50 text-base">
            {saving ? '保存中...' : '借りる'}
          </button>
        </form>
      </section>

      <h2 className="font-bold text-gray-700 mb-2">貸出中（{activeProjectUsages.length}件）</h2>
      {activeProjectUsages.length === 0 && <p className="text-gray-400 text-sm mb-4">貸出中の道具はありません</p>}
      <div className="flex flex-col gap-2 mb-4">
        {activeProjectUsages.map(u => (
          <div key={u.id} className="bg-white rounded shadow px-3 py-3 flex justify-between items-center text-sm">
            <div>
              <span className="font-medium">{u.tools?.name}</span>
              <span className="text-gray-500 ml-1">{u.quantity}{u.tools?.unit}</span>
              <span className="text-gray-400 ml-2 text-xs">{u.checked_out_at}〜</span>
              {u.note && <span className="text-gray-500 ml-1">({u.note})</span>}
            </div>
            <button onClick={() => returnUsage(u.id)}
              className="text-xs px-3 py-1.5 rounded-full border text-blue-600 bg-white shrink-0 ml-2">
              返却する
            </button>
          </div>
        ))}
      </div>

      {returnedProjectUsages.length > 0 && (
        <>
          <button onClick={() => setShowHistory(v => !v)} className="text-xs text-gray-500 mb-2">
            返却済み（{returnedProjectUsages.length}件） {showHistory ? '▲ 閉じる' : '▼ 表示'}
          </button>
          {showHistory && (
            <div className="flex flex-col gap-2 pb-8">
              {returnedProjectUsages.map(u => (
                <div key={u.id} className="bg-white rounded shadow px-3 py-3 text-sm text-gray-500">
                  <span className="font-medium text-gray-700">{u.tools?.name}</span>
                  <span className="ml-1">{u.quantity}{u.tools?.unit}</span>
                  <span className="ml-2 text-xs">{u.checked_out_at}〜{u.returned_at} 返却済み</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
