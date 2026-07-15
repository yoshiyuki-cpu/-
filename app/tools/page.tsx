'use client'
import { useEffect, useState } from 'react'
import { supabase, Tool, ToolUsage } from '@/lib/supabase'
import Link from 'next/link'

type EditTarget = { id: number; name: string; total_quantity: string; broken_quantity: string; unit: string }

export default function ToolsPage() {
  const [tools, setTools] = useState<Tool[]>([])
  const [activeUsages, setActiveUsages] = useState<ToolUsage[]>([])
  const [loading, setLoading] = useState(true)
  const [newTool, setNewTool] = useState({ name: '', total_quantity: '', broken_quantity: '', unit: '個' })
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [saving, setSaving] = useState(false)
  const [expandedToolId, setExpandedToolId] = useState<number | null>(null)

  useEffect(() => { load() }, [])

  async function load() {
    const [{ data: t }, { data: u }] = await Promise.all([
      supabase.from('tools').select('*').order('name'),
      supabase.from('tool_usages').select('*, tools(name, unit), projects(name)').is('returned_at', null).order('checked_out_at', { ascending: false }),
    ])
    setTools(t ?? [])
    setActiveUsages((u as any) ?? [])
    setLoading(false)
  }

  function checkedOutQty(toolId: number) {
    return activeUsages.filter(u => u.tool_id === toolId).reduce((s, u) => s + Number(u.quantity), 0)
  }

  async function addTool() {
    if (!newTool.name || !newTool.total_quantity) return
    await supabase.from('tools').insert({
      name: newTool.name,
      total_quantity: Number(newTool.total_quantity),
      broken_quantity: newTool.broken_quantity ? Number(newTool.broken_quantity) : 0,
      unit: newTool.unit || '個',
    })
    setNewTool({ name: '', total_quantity: '', broken_quantity: '', unit: '個' })
    load()
  }

  async function deleteTool(id: number) {
    if (!confirm('この道具を削除しますか？')) return
    const { error } = await supabase.from('tools').delete().eq('id', id)
    if (error) {
      alert('この道具は貸出記録があるため削除できません。')
      return
    }
    load()
  }

  function openEdit(t: Tool) {
    setEditTarget({ id: t.id, name: t.name, total_quantity: String(t.total_quantity), broken_quantity: String(t.broken_quantity), unit: t.unit })
  }

  async function saveEdit() {
    if (!editTarget) return
    setSaving(true)
    await supabase.from('tools').update({
      name: editTarget.name,
      total_quantity: Number(editTarget.total_quantity) || 0,
      broken_quantity: Number(editTarget.broken_quantity) || 0,
      unit: editTarget.unit || '個',
    }).eq('id', editTarget.id)
    setSaving(false)
    setEditTarget(null)
    load()
  }

  async function returnUsage(id: number) {
    await supabase.from('tool_usages').update({ returned_at: new Date().toISOString().split('T')[0] }).eq('id', id)
    load()
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  return (
    <div>
      <Link href="/master" className="text-blue-600 text-sm mb-3 inline-block">← マスタ管理</Link>
      <h1 className="text-xl font-bold mb-4">置き場道具管理</h1>

      {/* 編集モーダル */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-4">道具を編集</h3>
            <div className="flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">名称</label>
                <input className="w-full border rounded px-3 py-2 text-base" value={editTarget.name}
                  onChange={e => setEditTarget({ ...editTarget, name: e.target.value })} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">総数</label>
                  <input type="number" inputMode="numeric" className="w-full border rounded px-3 py-2 text-base" value={editTarget.total_quantity}
                    onChange={e => setEditTarget({ ...editTarget, total_quantity: e.target.value })} />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1">壊れてる数</label>
                  <input type="number" inputMode="numeric" className="w-full border rounded px-3 py-2 text-base" value={editTarget.broken_quantity}
                    onChange={e => setEditTarget({ ...editTarget, broken_quantity: e.target.value })} />
                </div>
                <div className="w-20">
                  <label className="block text-sm font-medium mb-1">単位</label>
                  <input className="w-full border rounded px-3 py-2 text-base" value={editTarget.unit}
                    onChange={e => setEditTarget({ ...editTarget, unit: e.target.value })} />
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-2 border rounded-lg text-gray-600 font-medium">キャンセル</button>
              <button onClick={saveEdit} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-lg font-medium disabled:opacity-50">
                {saving ? '保存中...' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="bg-white rounded-lg shadow p-4 mb-4">
        <h2 className="font-bold mb-3 text-gray-700">新規道具を追加</h2>
        <div className="flex flex-col gap-2">
          <input className="border rounded px-3 py-2 text-sm" value={newTool.name}
            onChange={e => setNewTool({ ...newTool, name: e.target.value })} placeholder="道具名" />
          <div className="flex gap-2">
            <input type="number" inputMode="numeric" className="flex-1 border rounded px-3 py-2 text-sm" value={newTool.total_quantity}
              onChange={e => setNewTool({ ...newTool, total_quantity: e.target.value })} placeholder="総数" />
            <input type="number" inputMode="numeric" className="flex-1 border rounded px-3 py-2 text-sm" value={newTool.broken_quantity}
              onChange={e => setNewTool({ ...newTool, broken_quantity: e.target.value })} placeholder="壊れてる数（任意）" />
            <input className="w-20 border rounded px-3 py-2 text-sm" value={newTool.unit}
              onChange={e => setNewTool({ ...newTool, unit: e.target.value })} placeholder="単位" />
          </div>
          <button onClick={addTool} className="bg-blue-600 text-white py-2 rounded text-sm font-medium">追加</button>
        </div>
      </section>

      <h2 className="font-bold text-gray-700 mb-2">道具一覧（{tools.length}件）</h2>
      <div className="flex flex-col gap-2 pb-8">
        {tools.map(t => {
          const outQty = checkedOutQty(t.id)
          const available = t.total_quantity - t.broken_quantity - outQty
          const usagesForTool = activeUsages.filter(u => u.tool_id === t.id)
          const expanded = expandedToolId === t.id
          return (
            <div key={t.id} className="bg-white rounded shadow px-3 py-3 text-sm">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{t.name}</span>
                  <span className="text-gray-500 ml-1">（総数{t.total_quantity}{t.unit}）</span>
                  {t.broken_quantity > 0 && <span className="text-red-500 ml-1 text-xs">壊れ{t.broken_quantity}{t.unit}</span>}
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-2">
                  <span className={`font-medium ${available <= 0 ? 'text-red-600' : 'text-blue-600'}`}>
                    使用可能 {available}{t.unit}
                  </span>
                  <button onClick={() => openEdit(t)} className="text-gray-400 hover:text-blue-500 text-xs px-1 py-1">編集</button>
                  <button onClick={() => deleteTool(t.id)} className="text-gray-300 hover:text-red-400 text-lg leading-none px-1 py-1">✕</button>
                </div>
              </div>
              {outQty > 0 && (
                <button onClick={() => setExpandedToolId(expanded ? null : t.id)} className="text-xs text-blue-600 mt-1">
                  貸出中 {outQty}{t.unit}（{expanded ? '閉じる' : '内訳を見る'}）
                </button>
              )}
              {expanded && (
                <div className="mt-2 border-t pt-2 flex flex-col gap-1">
                  {usagesForTool.map(u => (
                    <div key={u.id} className="flex justify-between items-center text-xs text-gray-600">
                      <span>
                        {u.checked_out_at}・
                        {u.projects ? (
                          <Link href={`/projects/${u.project_id}/tools`} className="text-blue-600">{u.projects.name}</Link>
                        ) : '（現場不明）'}
                        ・{u.quantity}{t.unit}
                      </span>
                      <button onClick={() => returnUsage(u.id)} className="text-blue-600">返却済みにする</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
