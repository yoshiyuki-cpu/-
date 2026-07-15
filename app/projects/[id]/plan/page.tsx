'use client'
import { useEffect, useState } from 'react'
import { supabase, Project, WorkProcess, LaborTarget } from '@/lib/supabase'
import { useParams, useRouter } from 'next/navigation'

type Tab = 'budget' | 'process' | 'labor'

const today = new Date().toISOString().split('T')[0]

// 日付間の日数差
function daysBetween(a: string, b: string) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

export default function PlanPage() {
  const { id } = useParams()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('budget')
  const [project, setProject] = useState<Project | null>(null)
  const [processes, setProcesses] = useState<WorkProcess[]>([])
  const [laborTargets, setLaborTargets] = useState<LaborTarget[]>([])
  const [laborActuals, setLaborActuals] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  // 実行予算フォーム
  const [budgetForm, setBudgetForm] = useState({
    budget_waste_cost: '',
    budget_labor: '',
    budget_fuel: '',
    budget_lease: '',
    budget_expense: '',
    budget_scrap_revenue: '',
  })

  // 作業工程フォーム
  const [processNotes, setProcessNotes] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)
  const [processForm, setProcessForm] = useState({ name: '', start_date: today, end_date: today, notes: '' })
  const [showProcessForm, setShowProcessForm] = useState(false)
  const [deleteProcessId, setDeleteProcessId] = useState<number | null>(null)

  // 目標人工数フォーム
  const [laborForm, setLaborForm] = useState({ date: today, target_count: '' })

  // 実績集計（現場全体）
  const [actuals, setActuals] = useState({ waste_cost: 0, labor: 0, fuel: 0, lease: 0, expense: 0, scrap: 0 })

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    const [
      { data: p },
      { data: proc },
      { data: lt },
      { data: we },
      { data: oe },
      { data: le },
      { data: sr },
    ] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('work_processes').select('*').eq('project_id', id).order('start_date'),
      supabase.from('labor_targets').select('*').eq('project_id', id).order('date'),
      supabase.from('waste_entries').select('amount, waste_types(entry_type)').eq('project_id', id),
      supabase.from('other_entries').select('entry_type, amount').eq('project_id', id),
      supabase.from('labor_entries').select('date, amount, day_type').eq('project_id', id),
      supabase.from('scrap_records').select('amount').eq('project_id', id),
    ])

    if (p) {
      setProject(p)
      setProcessNotes(p.process_notes ?? '')
      setBudgetForm({
        budget_waste_cost: p.budget_waste_cost ? String(p.budget_waste_cost) : '',
        budget_labor: p.budget_labor ? String(p.budget_labor) : '',
        budget_fuel: p.budget_fuel ? String(p.budget_fuel) : '',
        budget_lease: p.budget_lease ? String(p.budget_lease) : '',
        budget_expense: p.budget_expense ? String(p.budget_expense) : '',
        budget_scrap_revenue: p.budget_scrap_revenue ? String(p.budget_scrap_revenue) : '',
      })
    }
    setProcesses(proc ?? [])
    setLaborTargets(lt ?? [])

    // 実績集計
    let waste_cost = 0, scrap = 0, labor = 0, fuel = 0, lease = 0, expense = 0
    we?.forEach((e: any) => {
      if (e.waste_types?.entry_type === 'cost') waste_cost += Number(e.amount)
      else scrap += Number(e.amount)
    })
    sr?.forEach((r: any) => { scrap += Number(r.amount) })
    oe?.forEach((e: any) => {
      if (e.entry_type === 'labor') labor += Number(e.amount)
      else if (e.entry_type === 'fuel') fuel += Number(e.amount)
      else if (e.entry_type === 'lease') lease += Number(e.amount)
      else if (e.entry_type === 'expense') expense += Number(e.amount)
    })
    le?.forEach((e: any) => { labor += Number(e.amount) })
    setActuals({ waste_cost, labor, fuel, lease, expense, scrap })

    // 日別実績人工数（半日は0.5人でカウント）
    const byDate: Record<string, number> = {}
    le?.forEach((e: any) => {
      byDate[e.date] = (byDate[e.date] ?? 0) + (e.day_type === 'half' ? 0.5 : 1)
    })
    setLaborActuals(byDate)

    setLoading(false)
  }

  async function saveBudget(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    await supabase.from('projects').update({
      budget_waste_cost: Number(budgetForm.budget_waste_cost) || null,
      budget_labor: Number(budgetForm.budget_labor) || null,
      budget_fuel: Number(budgetForm.budget_fuel) || null,
      budget_lease: Number(budgetForm.budget_lease) || null,
      budget_expense: Number(budgetForm.budget_expense) || null,
      budget_scrap_revenue: Number(budgetForm.budget_scrap_revenue) || null,
    }).eq('id', id)
    setSaving(false)
    setSuccess('予算を保存しました')
    setTimeout(() => setSuccess(''), 2000)
    load()
  }

  async function saveProcessNotes() {
    await supabase.from('projects').update({ process_notes: processNotes || null }).eq('id', id)
    setEditingNotes(false)
    setSuccess('工程メモを保存しました')
    setTimeout(() => setSuccess(''), 2000)
    load()
  }

  async function addProcess(e: React.FormEvent) {
    e.preventDefault()
    if (!processForm.name) return
    setSaving(true)
    await supabase.from('work_processes').insert({
      project_id: Number(id),
      name: processForm.name,
      start_date: processForm.start_date,
      end_date: processForm.end_date,
      notes: processForm.notes || null,
    })
    setProcessForm({ name: '', start_date: today, end_date: today, notes: '' })
    setShowProcessForm(false)
    setSaving(false)
    load()
  }

  async function deleteProcess(procId: number) {
    await supabase.from('work_processes').delete().eq('id', procId)
    setDeleteProcessId(null)
    load()
  }

  async function saveLaborTarget(e: React.FormEvent) {
    e.preventDefault()
    if (!laborForm.target_count) return
    setSaving(true)
    await supabase.from('labor_targets').upsert({
      project_id: Number(id),
      date: laborForm.date,
      target_count: Number(laborForm.target_count),
    }, { onConflict: 'project_id,date' })
    setLaborForm({ date: today, target_count: '' })
    setSaving(false)
    load()
  }

  async function deleteLaborTarget(ltId: number) {
    await supabase.from('labor_targets').delete().eq('id', ltId)
    load()
  }

  const fmt = (n: number) => n.toLocaleString('ja-JP') + '円'

  const tabClass = (t: Tab) =>
    `flex-1 py-2.5 text-sm font-medium border-b-2 transition ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500'}`

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>
  if (!project) return null

  const totalBudgetCost = (project.budget_waste_cost ?? 0) + (project.budget_labor ?? 0) + (project.budget_fuel ?? 0) + (project.budget_lease ?? 0) + (project.budget_expense ?? 0)
  const totalActualCost = actuals.waste_cost + actuals.labor + actuals.fuel + actuals.lease + actuals.expense
  const totalLaborTarget = laborTargets.reduce((s, t) => s + Number(t.target_count), 0)
  const totalLaborActual = Object.values(laborActuals).reduce((s, v) => s + v, 0)

  // ガントチャート用: 全工程の最早開始・最遅終了
  const minDate = processes.length > 0 ? processes.reduce((m, p) => p.start_date < m ? p.start_date : m, processes[0].start_date) : today
  const maxDate = processes.length > 0 ? processes.reduce((m, p) => p.end_date > m ? p.end_date : m, processes[0].end_date) : today
  const totalDays = Math.max(daysBetween(minDate, maxDate) + 1, 1)

  return (
    <div>
      {/* 削除確認モーダル */}
      {deleteProcessId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm">
            <h3 className="font-bold text-lg mb-2">工程を削除しますか？</h3>
            <p className="text-sm text-gray-500 mb-4">この操作は元に戻せません。</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteProcessId(null)} className="flex-1 py-2 border rounded-lg text-gray-600">キャンセル</button>
              <button onClick={() => deleteProcess(deleteProcessId)} className="flex-1 py-2 bg-red-600 text-white rounded-lg font-medium">削除する</button>
            </div>
          </div>
        </div>
      )}

      <button onClick={() => router.back()} className="text-blue-600 text-sm mb-3 py-1">← 現場詳細</button>
      <h1 className="text-xl font-bold mb-1">{project.name}</h1>
      <p className="text-sm text-gray-500 mb-4">実行予算・工程・人工計画</p>

      {success && <div className="bg-green-100 text-green-700 rounded px-3 py-2 mb-3 text-sm">{success} ✓</div>}

      <div className="flex border-b mb-4">
        <button className={tabClass('budget')} onClick={() => setTab('budget')}>実行予算</button>
        <button className={tabClass('process')} onClick={() => setTab('process')}>工程表</button>
        <button className={tabClass('labor')} onClick={() => setTab('labor')}>目標人工</button>
      </div>

      {/* ===== 実行予算 ===== */}
      {tab === 'budget' && (
        <div>
          <form onSubmit={saveBudget} className="bg-white rounded-lg shadow p-4 mb-4 flex flex-col gap-3">
            <h2 className="font-bold text-gray-700 mb-1">予算入力</h2>
            {[
              { key: 'budget_waste_cost', label: '廃材処分費', color: 'text-red-600' },
              { key: 'budget_labor', label: '人工費', color: '' },
              { key: 'budget_fuel', label: '燃料代', color: '' },
              { key: 'budget_lease', label: 'リース代', color: '' },
              { key: 'budget_expense', label: '経費', color: '' },
              { key: 'budget_scrap_revenue', label: 'スクラップ収益', color: 'text-blue-600' },
            ].map(({ key, label, color }) => (
              <div key={key} className="flex items-center gap-3">
                <label className={`text-sm w-28 shrink-0 ${color || 'text-gray-700'}`}>{label}</label>
                <div className="flex-1 relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    className="w-full border rounded px-3 py-2.5 text-sm pr-8"
                    value={(budgetForm as any)[key]}
                    onChange={e => setBudgetForm({ ...budgetForm, [key]: e.target.value })}
                    placeholder="0"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">円</span>
                </div>
              </div>
            ))}
            <button type="submit" disabled={saving}
              className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50 mt-1">
              {saving ? '保存中...' : '予算を保存する'}
            </button>
          </form>

          {/* 予算 vs 実績 比較表 */}
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="font-bold text-gray-700 mb-3">予算 vs 実績</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-1.5 text-gray-500 font-medium">項目</th>
                    <th className="text-right py-1.5 text-gray-500 font-medium">予算</th>
                    <th className="text-right py-1.5 text-gray-500 font-medium">実績</th>
                    <th className="text-right py-1.5 text-gray-500 font-medium">差異</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: '廃材処分費', budget: project.budget_waste_cost ?? 0, actual: actuals.waste_cost, rev: false },
                    { label: '人工費', budget: project.budget_labor ?? 0, actual: actuals.labor, rev: false },
                    { label: '燃料代', budget: project.budget_fuel ?? 0, actual: actuals.fuel, rev: false },
                    { label: 'リース代', budget: project.budget_lease ?? 0, actual: actuals.lease, rev: false },
                    { label: '経費', budget: project.budget_expense ?? 0, actual: actuals.expense, rev: false },
                    { label: 'スクラップ収益', budget: project.budget_scrap_revenue ?? 0, actual: actuals.scrap, rev: true },
                  ].map(({ label, budget, actual, rev }) => {
                    const diff = rev ? actual - budget : budget - actual
                    const isOver = diff < 0
                    return (
                      <tr key={label} className="border-b last:border-0">
                        <td className="py-2 text-gray-700">{label}</td>
                        <td className="py-2 text-right text-gray-600">{budget > 0 ? fmt(budget) : '—'}</td>
                        <td className="py-2 text-right">{fmt(actual)}</td>
                        <td className={`py-2 text-right font-medium ${budget > 0 ? (isOver ? 'text-red-600' : 'text-blue-600') : 'text-gray-400'}`}>
                          {budget > 0 ? (isOver ? '' : '+') + fmt(diff) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2">
                    <td className="py-2 font-bold">支出合計</td>
                    <td className="py-2 text-right font-bold text-gray-700">{totalBudgetCost > 0 ? fmt(totalBudgetCost) : '—'}</td>
                    <td className="py-2 text-right font-bold">{fmt(totalActualCost)}</td>
                    <td className={`py-2 text-right font-bold ${totalBudgetCost > 0 ? (totalActualCost > totalBudgetCost ? 'text-red-600' : 'text-blue-600') : 'text-gray-400'}`}>
                      {totalBudgetCost > 0 ? (totalActualCost <= totalBudgetCost ? '+' : '') + fmt(totalBudgetCost - totalActualCost) : '—'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ===== 作業工程表 ===== */}
      {tab === 'process' && (
        <div>
          {/* 自由記入メモ */}
          <div className="bg-white rounded-lg shadow p-4 mb-4">
            <div className="flex justify-between items-center mb-2">
              <h2 className="font-bold text-gray-700">工程メモ</h2>
              {!editingNotes && (
                <button onClick={() => setEditingNotes(true)} className="text-xs text-blue-600">編集</button>
              )}
            </div>
            {editingNotes ? (
              <div className="flex flex-col gap-2">
                <textarea
                  className="w-full border rounded px-3 py-3 text-sm resize-none"
                  rows={5}
                  value={processNotes}
                  onChange={e => setProcessNotes(e.target.value)}
                  placeholder="作業内容・段取り・注意点など自由に記入"
                />
                <div className="flex gap-2">
                  <button onClick={() => { setEditingNotes(false); setProcessNotes(project.process_notes ?? '') }}
                    className="flex-1 py-2 border rounded text-sm text-gray-600">キャンセル</button>
                  <button onClick={saveProcessNotes}
                    className="flex-1 py-2 bg-blue-600 text-white rounded text-sm">保存</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {project.process_notes || <span className="text-gray-400">メモなし（タップして追加）</span>}
              </p>
            )}
          </div>

          {/* 工程登録 */}
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-bold text-gray-700">工程スケジュール</h2>
            <button onClick={() => setShowProcessForm(v => !v)}
              className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded">
              {showProcessForm ? '閉じる' : '+ 工程追加'}
            </button>
          </div>

          {showProcessForm && (
            <form onSubmit={addProcess} className="bg-white rounded-lg shadow p-4 mb-4 flex flex-col gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">工程名</label>
                <input className="w-full border rounded px-3 py-3 text-sm"
                  value={processForm.name}
                  onChange={e => setProcessForm({ ...processForm, name: e.target.value })}
                  placeholder="例：内部解体、鉄骨解体、整地" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">開始日</label>
                  <input type="date" className="w-full border rounded px-3 py-3 text-sm"
                    value={processForm.start_date}
                    onChange={e => setProcessForm({ ...processForm, start_date: e.target.value })} />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">終了日</label>
                  <input type="date" className="w-full border rounded px-3 py-3 text-sm"
                    value={processForm.end_date}
                    onChange={e => setProcessForm({ ...processForm, end_date: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">メモ（任意）</label>
                <input className="w-full border rounded px-3 py-3 text-sm"
                  value={processForm.notes}
                  onChange={e => setProcessForm({ ...processForm, notes: e.target.value })}
                  placeholder="" />
              </div>
              <button type="submit" disabled={saving || !processForm.name}
                className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50">
                {saving ? '追加中...' : '追加する'}
              </button>
            </form>
          )}

          {/* 工程リスト＋簡易ガントチャート */}
          {processes.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">工程が登録されていません</p>
          )}

          {processes.length > 0 && (
            <>
              <div className="flex flex-col gap-2 mb-4">
                {processes.map(p => (
                  <div key={p.id} className="bg-white rounded-lg shadow px-4 py-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="font-medium text-gray-800">{p.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{p.start_date} 〜 {p.end_date}（{daysBetween(p.start_date, p.end_date) + 1}日間）</p>
                        {p.notes && <p className="text-xs text-gray-500 mt-0.5">{p.notes}</p>}
                      </div>
                      <button onClick={() => setDeleteProcessId(p.id)}
                        className="text-gray-300 hover:text-red-400 text-lg px-1">✕</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* ガントチャート */}
              <div className="bg-white rounded-lg shadow p-4 overflow-x-auto">
                <h3 className="font-bold text-gray-700 text-sm mb-3">ガントチャート</h3>
                <div className="flex gap-1 mb-1 text-xs text-gray-400">
                  <div className="w-24 shrink-0">{minDate}</div>
                  <div className="flex-1 text-right">{maxDate}</div>
                </div>
                <div className="flex flex-col gap-2" style={{ minWidth: '300px' }}>
                  {processes.map(p => {
                    const offset = daysBetween(minDate, p.start_date)
                    const duration = daysBetween(p.start_date, p.end_date) + 1
                    const leftPct = (offset / totalDays) * 100
                    const widthPct = (duration / totalDays) * 100
                    return (
                      <div key={p.id} className="flex items-center gap-2">
                        <div className="w-24 shrink-0 text-xs text-gray-600 truncate">{p.name}</div>
                        <div className="flex-1 h-7 bg-gray-100 rounded relative">
                          <div
                            className="absolute h-full bg-blue-400 rounded text-white text-xs flex items-center px-2 overflow-hidden"
                            style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                          >
                            {duration}日
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ===== 目標人工数 ===== */}
      {tab === 'labor' && (
        <div>
          {/* サマリー */}
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">目標人工数（合計）</p>
              <p className="text-2xl font-bold text-blue-600">{totalLaborTarget}<span className="text-sm font-normal text-gray-500">人工</span></p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">実績人工数（合計）</p>
              <p className="text-2xl font-bold text-gray-800">{totalLaborActual}<span className="text-sm font-normal text-gray-500">人工</span></p>
            </div>
          </div>

          {/* 日別目標入力 */}
          <form onSubmit={saveLaborTarget} className="bg-white rounded-lg shadow p-4 mb-4 flex flex-col gap-3">
            <h2 className="font-bold text-gray-700">日別目標を登録</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">日付</label>
                <input type="date" className="w-full border rounded px-3 py-3"
                  value={laborForm.date}
                  onChange={e => setLaborForm({ ...laborForm, date: e.target.value })} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">目標人工数</label>
                <input type="number" inputMode="numeric" className="w-full border rounded px-3 py-3"
                  value={laborForm.target_count}
                  onChange={e => setLaborForm({ ...laborForm, target_count: e.target.value })}
                  placeholder="例：5" />
              </div>
            </div>
            <button type="submit" disabled={saving || !laborForm.target_count}
              className="bg-blue-600 text-white py-3 rounded font-medium disabled:opacity-50">
              {saving ? '保存中...' : '登録する'}
            </button>
          </form>

          {/* 日別一覧 */}
          {laborTargets.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-6">目標人工数が登録されていません</p>
          )}

          {laborTargets.length > 0 && (
            <div className="bg-white rounded-lg shadow overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-gray-500 font-medium">日付</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">目標</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">実績</th>
                    <th className="text-right px-4 py-2.5 text-gray-500 font-medium">差異</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {laborTargets.map(lt => {
                    const actual = laborActuals[lt.date] ?? 0
                    const diff = actual - Number(lt.target_count)
                    return (
                      <tr key={lt.id} className="border-t">
                        <td className="px-4 py-2.5 text-gray-700">{lt.date}</td>
                        <td className="px-4 py-2.5 text-right font-medium">{lt.target_count}人</td>
                        <td className="px-4 py-2.5 text-right">{actual}人</td>
                        <td className={`px-4 py-2.5 text-right font-medium ${diff >= 0 ? 'text-blue-600' : 'text-red-500'}`}>
                          {diff >= 0 ? '+' : ''}{diff}
                        </td>
                        <td className="px-2 py-2.5">
                          <button onClick={() => deleteLaborTarget(lt.id)}
                            className="text-gray-300 hover:text-red-400 text-base">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
