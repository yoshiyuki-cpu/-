'use client'
import { useEffect, useMemo, useState } from 'react'
import { supabase, Project, SupportCompany, DispatchGroup } from '@/lib/supabase'

type Worker = { id: number; name: string; in_dispatch: boolean }
type Assignment = { id: number; group_id: number; worker_id: number }
// 行き先は「自社現場」か「応援先」のどちらか。まだ誰も配置していない行き先も並べたいので、
// DBのdispatch_groupsが無い状態でも画面上の候補として扱えるようにしている
type Dest =
  | { kind: 'project'; id: number; name: string; startsToday: boolean }
  | { kind: 'support'; id: number; name: string }

const destKey = (d: Dest) => `${d.kind}:${d.id}`

function tomorrowISO() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']
function formatDate(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}(${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`
}

function prevDay(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, m - 1, d - 1)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export default function DispatchPage() {
  const [date, setDate] = useState(tomorrowISO())
  const [loading, setLoading] = useState(true)
  const [planId, setPlanId] = useState<number | null>(null)
  const [notifiedAt, setNotifiedAt] = useState<string | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [supports, setSupports] = useState<SupportCompany[]>([])
  const [workers, setWorkers] = useState<Worker[]>([])
  const [groups, setGroups] = useState<DispatchGroup[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])

  // 作業員チップをタップしたときに出す移動先シート
  const [moving, setMoving] = useState<Worker | null>(null)
  // 行き先カードの「＋追加」で出す未配置作業員の選択シート
  const [adding, setAdding] = useState<Dest | null>(null)
  const [notifying, setNotifying] = useState(false)
  const [message, setMessage] = useState('')
  // 段取りを組んでいる最中に新しい応援先・現場が出てくるので、その場で足せるようにする
  const [newSupportName, setNewSupportName] = useState('')
  const [addingSupport, setAddingSupport] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [addingProject, setAddingProject] = useState(false)
  // 作業員の入退社もこの画面から扱えるようにする
  // 名前・着工日の打ち間違いを直すための編集状態
  const [editing, setEditing] = useState<{ id: number; name: string; start_date: string } | null>(null)
  const [editingSupport, setEditingSupport] = useState<{ id: number; name: string } | null>(null)
  const [trashed, setTrashed] = useState<Project[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [managingWorkers, setManagingWorkers] = useState(false)
  const [newWorkerName, setNewWorkerName] = useState('')

  useEffect(() => { load() }, [date])

  async function load() {
    setLoading(true)
    const [{ data: pj }, { data: sc }, { data: wk }, { data: plan }, { data: tr }] = await Promise.all([
      supabase.from('projects').select('*').eq('status', 'active').is('deleted_at', null).order('name'),
      supabase.from('support_companies').select('*').eq('active', true).order('sort_order'),
      supabase.from('workers').select('id, name, in_dispatch').order('name'),
      supabase.from('dispatch_plans').select('*').eq('date', date).maybeSingle(),
      supabase.from('projects').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }),
    ])
    setProjects(pj ?? [])
    setSupports(sc ?? [])
    setWorkers(wk ?? [])
    setTrashed(tr ?? [])
    setPlanId(plan?.id ?? null)
    setNotifiedAt(plan?.notified_at ?? null)

    if (plan) {
      const [{ data: gs }, { data: as }] = await Promise.all([
        supabase.from('dispatch_groups').select('*').eq('plan_id', plan.id),
        supabase.from('dispatch_assignments').select('id, group_id, worker_id').eq('plan_id', plan.id),
      ])
      setGroups(gs ?? [])
      setAssignments(as ?? [])
    } else {
      setGroups([])
      setAssignments([])
    }
    setLoading(false)
  }

  const dests: Dest[] = useMemo(() => [
    ...projects.map(p => ({ kind: 'project' as const, id: p.id, name: p.name, startsToday: p.start_date === date })),
    ...supports.map(s => ({ kind: 'support' as const, id: s.id, name: s.name })),
  ], [projects, supports, date])

  const groupOf = (d: Dest) => groups.find(g =>
    d.kind === 'project' ? g.project_id === d.id : g.support_company_id === d.id)

  const workersIn = (d: Dest) => {
    const g = groupOf(d)
    if (!g) return []
    const ids = assignments.filter(a => a.group_id === g.id).map(a => a.worker_id)
    return workers.filter(w => ids.includes(w.id))
  }

  const assignedIds = new Set(assignments.map(a => a.worker_id))
  // 事務員や辞めた人を除いた「段取りに出す人」だけを未配置プール・追加候補に出す。
  // workers自体は名前の引き当てに使うので全員保持している
  const dispatchWorkers = workers.filter(w => w.in_dispatch)
  const unassigned = dispatchWorkers.filter(w => !assignedIds.has(w.id))
  const hiddenWorkers = workers.filter(w => !w.in_dispatch)

  // 段取りは日ごとに1件。まだ無ければ作ってからでないと配員を保存できない
  async function ensurePlan() {
    if (planId) return planId
    const { data } = await supabase.from('dispatch_plans').insert({ date }).select('id').single()
    setPlanId(data!.id)
    return data!.id
  }

  async function ensureGroup(d: Dest) {
    const existing = groupOf(d)
    if (existing) return existing.id
    const pid = await ensurePlan()
    const { data } = await supabase.from('dispatch_groups').insert({
      plan_id: pid,
      project_id: d.kind === 'project' ? d.id : null,
      support_company_id: d.kind === 'support' ? d.id : null,
    }).select('*').single()
    setGroups(gs => [...gs, data!])
    return data!.id
  }

  // 配置・移動・未配置に戻すをまとめて扱う。既に配置済みならgroup_idを更新するだけ
  async function assign(workerIds: number[], d: Dest | null) {
    const pid = await ensurePlan()
    if (!d) {
      await supabase.from('dispatch_assignments').delete().eq('plan_id', pid).in('worker_id', workerIds)
    } else {
      const gid = await ensureGroup(d)
      await supabase.from('dispatch_assignments')
        .upsert(workerIds.map(worker_id => ({ plan_id: pid, group_id: gid, worker_id })), { onConflict: 'plan_id,worker_id' })
    }
    const { data } = await supabase.from('dispatch_assignments').select('id, group_id, worker_id').eq('plan_id', pid)
    setAssignments(data ?? [])
    setNotifiedAt(null)
    setMoving(null)
    setAdding(null)
  }

  async function updateGroupField(d: Dest, patch: Partial<DispatchGroup>) {
    const gid = await ensureGroup(d)
    setGroups(gs => gs.map(g => g.id === gid ? { ...g, ...patch } : g))
    await supabase.from('dispatch_groups').update(patch).eq('id', gid)
    setNotifiedAt(null)
  }

  // 毎日ほぼ同じ配員なので、前日をそのまま持ってきて差分だけ入れ替えられるようにする
  async function copyPrevDay() {
    const { data: prev } = await supabase.from('dispatch_plans').select('id').eq('date', prevDay(date)).maybeSingle()
    if (!prev) { setMessage('前日の段取りが見つかりませんでした。'); return }
    const [{ data: pgs }, { data: pas }] = await Promise.all([
      supabase.from('dispatch_groups').select('*').eq('plan_id', prev.id),
      supabase.from('dispatch_assignments').select('group_id, worker_id').eq('plan_id', prev.id),
    ])
    if (!pgs || pgs.length === 0) { setMessage('前日の段取りが空でした。'); return }

    const pid = await ensurePlan()
    await supabase.from('dispatch_assignments').delete().eq('plan_id', pid)
    await supabase.from('dispatch_groups').delete().eq('plan_id', pid)

    const { data: newGroups } = await supabase.from('dispatch_groups').insert(
      pgs.map(g => ({
        plan_id: pid, project_id: g.project_id, support_company_id: g.support_company_id,
        meet_time: g.meet_time, meet_place: g.meet_place, note: g.note,
      }))
    ).select('*')

    const oldToNew = new Map<number, number>()
    pgs.forEach(og => {
      const ng = (newGroups ?? []).find(n =>
        n.project_id === og.project_id && n.support_company_id === og.support_company_id)
      if (ng) oldToNew.set(og.id, ng.id)
    })
    const rows = (pas ?? [])
      .filter(a => oldToNew.has(a.group_id))
      .map(a => ({ plan_id: pid, group_id: oldToNew.get(a.group_id)!, worker_id: a.worker_id }))
    if (rows.length > 0) await supabase.from('dispatch_assignments').insert(rows)

    setMessage('前日の段取りを読み込みました。')
    setNotifiedAt(null)
    load()
  }

  async function addSupport() {
    const name = newSupportName.trim()
    if (!name) return
    const nextOrder = Math.max(0, ...supports.map(s => s.sort_order)) + 1
    const { data, error } = await supabase.from('support_companies')
      .insert({ name, sort_order: nextOrder }).select('*').single()
    if (error) { setMessage('応援先の追加に失敗しました。'); return }
    setSupports(ss => [...ss, data!])
    setNewSupportName('')
    setAddingSupport(false)
  }

  async function addProject() {
    const name = newProjectName.trim()
    if (!name) return
    // 着工日は段取りの日を初期値にする。場所や予算は後から現場一覧で足せる
    const { data, error } = await supabase.from('projects')
      .insert({ name, start_date: date, status: 'active' }).select('*').single()
    if (error) { setMessage('現場の追加に失敗しました。'); return }
    setProjects(ps => [...ps, data!])
    setNewProjectName('')
    setAddingProject(false)
  }

  // 応援先も打ち間違いがあるので消せるようにする。
  // 過去の段取りで使っていた場合は履歴が消えてしまうため、その場合は「使わない」に切り替える
  async function deleteSupport(sc: SupportCompany) {
    const { count } = await supabase.from('dispatch_groups')
      .select('id', { count: 'exact', head: true }).eq('support_company_id', sc.id)
    if ((count ?? 0) > 0) {
      if (!confirm(
        `「${sc.name}」は過去${count}日ぶんの段取りで使われています。\n` +
        `削除するとその履歴からも消えます。\n\n削除しますか？`)) return
    } else if (!confirm(`「${sc.name}」を削除しますか？`)) return

    const { error } = await supabase.from('support_companies').delete().eq('id', sc.id)
    if (error) { setMessage('応援先の削除に失敗しました。'); return }
    setSupports(ss => ss.filter(x => x.id !== sc.id))
    const gone = groups.filter(g => g.support_company_id === sc.id).map(g => g.id)
    setGroups(gs => gs.filter(g => g.support_company_id !== sc.id))
    setAssignments(as => as.filter(a => !gone.includes(a.group_id)))
    setMessage(`「${sc.name}」を削除しました。`)
  }

  // projectsを消すと子テーブルがcascadeで一緒に消えてしまう（DBは止めてくれない）ので、
  // 記録が残っていないかを自分で数えてから消すかどうかを判断する
  const RECORD_TABLES = [
    'waste_entries', 'other_entries', 'labor_entries', 'scrap_records',
    'meeting_notes', 'ky_photos', 'tool_usages', 'scaffold_plans',
  ]

  async function countProjectRecords(projectId: number) {
    const results = await Promise.all(RECORD_TABLES.map(t =>
      supabase.from(t).select('id', { count: 'exact', head: true }).eq('project_id', projectId)))
    return results.reduce((sum, r) => sum + (r.count ?? 0), 0)
  }

  // 入力ミスや二重登録の現場を消す。本当に消すと元に戻せないので、ごみ箱に入れて隠すだけにする。
  // 中身は何も消さないため、戻せば記録もそのまま復活する
  async function deleteProject(p: Project) {
    const count = await countProjectRecords(p.id)
    const ok = confirm(
      count === 0
        ? `「${p.name}」をごみ箱に入れますか？\n記録は入っていません。あとで元に戻せます。`
        : `「${p.name}」をごみ箱に入れますか？\n記録${count}件も一緒に隠れますが、消えるわけではありません。あとで元に戻せます。`)
    if (!ok) return

    const { error } = await supabase.from('projects')
      .update({ deleted_at: new Date().toISOString() }).eq('id', p.id)
    if (error) { setMessage('ごみ箱に入れられませんでした。'); return }

    // 今日の配員に入っていたら、そこからも抜く（現場自体は残るので手動で外す）
    const gone = groups.filter(g => g.project_id === p.id).map(g => g.id)
    if (gone.length > 0 && planId) {
      await supabase.from('dispatch_groups').delete().in('id', gone)
    }
    setProjects(ps => ps.filter(x => x.id !== p.id))
    setGroups(gs => gs.filter(g => g.project_id !== p.id))
    setAssignments(as => as.filter(a => !gone.includes(a.group_id)))
    setTrashed(ts => [{ ...p, deleted_at: new Date().toISOString() }, ...ts])
    setMessage(`「${p.name}」をごみ箱に入れました。`)
  }

  // 打ち間違いや着工日のミスを直せるようにする
  async function saveProjectEdit() {
    if (!editing) return
    const name = editing.name.trim()
    if (!name) return
    const { error } = await supabase.from('projects')
      .update({ name, start_date: editing.start_date }).eq('id', editing.id)
    if (error) { setMessage('現場の修正に失敗しました。'); return }
    setProjects(ps => ps.map(p => p.id === editing.id ? { ...p, name, start_date: editing.start_date } : p))
    setEditing(null)
    setMessage('現場を修正しました。')
  }

  async function saveSupportEdit() {
    if (!editingSupport) return
    const name = editingSupport.name.trim()
    if (!name) return
    const { error } = await supabase.from('support_companies').update({ name }).eq('id', editingSupport.id)
    if (error) { setMessage('応援先の修正に失敗しました。'); return }
    setSupports(ss => ss.map(s => s.id === editingSupport.id ? { ...s, name } : s))
    setEditingSupport(null)
    setMessage('応援先を修正しました。')
  }

  async function restoreProject(p: Project) {
    await supabase.from('projects').update({ deleted_at: null }).eq('id', p.id)
    setTrashed(ts => ts.filter(x => x.id !== p.id))
    if (p.status === 'active') setProjects(ps => [...ps, p].sort((a, b) => a.name.localeCompare(b.name, 'ja')))
    setMessage(`「${p.name}」を元に戻しました。`)
  }

  // ごみ箱から本当に消す。ここで消すと子テーブルもcascadeで消えて戻せない
  async function purgeProject(p: Project) {
    const count = await countProjectRecords(p.id)
    if (!confirm(
      `「${p.name}」を完全に削除しますか？\n` +
      (count > 0 ? `記録${count}件（廃材・人工・写真・議事録・足場計算など）も一緒に消えます。\n` : '') +
      `これは元に戻せません。`)) return
    const { error } = await supabase.from('projects').delete().eq('id', p.id)
    if (error) { setMessage('完全削除に失敗しました。'); return }
    setTrashed(ts => ts.filter(x => x.id !== p.id))
    setMessage(`「${p.name}」を完全に削除しました。`)
  }

  // 終わった現場は「完了」にする。削除すると廃材・人工などの記録まで消えるため、
  // 段取りの一覧から外すだけにして台帳は残す
  async function completeProject(p: Project) {
    if (!confirm(`「${p.name}」を完了にしますか？\n段取りの行き先から外れます。記録（廃材・人工・写真など）は残ります。`)) return
    await supabase.from('projects').update({ status: 'completed' }).eq('id', p.id)
    setProjects(ps => ps.filter(x => x.id !== p.id))
  }

  async function addWorker() {
    const name = newWorkerName.trim()
    if (!name) return
    const { data, error } = await supabase.from('workers').insert({ name, in_dispatch: true }).select('id, name, in_dispatch').single()
    if (error) { setMessage('作業員の追加に失敗しました。'); return }
    setWorkers(ws => [...ws, data!].sort((a, b) => a.name.localeCompare(b.name, 'ja')))
    setNewWorkerName('')
  }

  // 段取りから外す／戻す。workersを消すと人工記録などの過去の台帳が壊れるため、
  // 印を落として段取りに出さなくするだけにする（他の画面には残る）
  async function renameWorker(w: Worker) {
    const name = prompt('作業員名', w.name)?.trim()
    if (!name || name === w.name) return
    const { error } = await supabase.from('workers').update({ name }).eq('id', w.id)
    if (error) { setMessage('作業員名の修正に失敗しました。'); return }
    setWorkers(ws => ws.map(x => x.id === w.id ? { ...x, name } : x)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja')))
  }

  async function setInDispatch(w: Worker, next: boolean) {
    if (next === false && !confirm(`「${w.name}」を段取りから外しますか？\n出面などの他の画面には残ります。`)) return
    await supabase.from('workers').update({ in_dispatch: next }).eq('id', w.id)
    setWorkers(ws => ws.map(x => x.id === w.id ? { ...x, in_dispatch: next } : x))
    // 外した人が今日の配員に入っていたら、そこからも抜く
    if (!next && planId) {
      await supabase.from('dispatch_assignments').delete().eq('plan_id', planId).eq('worker_id', w.id)
      setAssignments(as => as.filter(a => a.worker_id !== w.id))
    }
  }

  async function notify() {
    setNotifying(true)
    setMessage('')
    try {
      const res = await fetch('/api/dispatch-notify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      })
      const data = await res.json()
      if (!res.ok) { setMessage(`送信に失敗しました：${data.error ?? 'エラー'}`); return }
      setNotifiedAt(new Date().toISOString())
      setMessage(data.errors?.length
        ? `職長${data.notified}人に送信しました（一部失敗：${data.errors.join(' / ')}）`
        : `職長${data.notified}人に段取りを送信しました。`)
    } catch {
      setMessage('送信に失敗しました：通信エラー')
    }
    setNotifying(false)
  }

  if (loading) return <p className="text-center py-10 text-gray-500">読み込み中...</p>

  const inputCls = 'border border-gray-200 rounded-lg px-2 py-1.5 text-sm'

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">段取り</h1>
      <p className="text-xs text-gray-500 mb-4">名前をタップすると行き先を変えられます。決まったら下の「職長に通知する」を押してください。</p>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm" />
          <span className="text-sm font-bold text-gray-700 shrink-0">{formatDate(date)}</span>
        </div>
        <div className="flex gap-2">
          <button onClick={copyPrevDay} className="flex-1 border border-gray-300 text-gray-600 rounded-lg py-2 text-sm">
            前日の段取りを読み込む
          </button>
        </div>
        {notifiedAt && (
          <p className="text-xs text-emerald-600 mt-2">
            通知済み（{new Date(notifiedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）
          </p>
        )}
      </div>

      {/* 未配置プール。人数が多いと画面を埋め尽くすので、高さを抑えてスクロールで選ぶ */}
      <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4">
        <div className="flex items-center mb-2">
          <h2 className="font-bold text-sm text-amber-800">未配置（{unassigned.length}人）</h2>
          <button onClick={() => setManagingWorkers(true)} className="ml-auto text-xs text-blue-600">
            作業員を管理
          </button>
        </div>
        {unassigned.length === 0
          ? <p className="text-xs text-amber-700">全員の行き先が決まりました。</p>
          : (
            <div className="max-h-32 overflow-y-auto -mx-1 px-1">
              <div className="flex flex-wrap gap-1.5">
                {unassigned.map(w => (
                  <button key={w.id} onClick={() => setMoving(w)}
                    className="px-2.5 py-1.5 rounded-full bg-white border border-amber-300 text-sm text-gray-700">
                    {w.name}
                  </button>
                ))}
              </div>
            </div>
          )}
      </section>

      <div className="flex flex-col gap-3">
        {dests.map(d => {
          const g = groupOf(d)
          const ws = workersIn(d)
          return (
            <section key={destKey(d)} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-center gap-1.5 mb-2">
                <h2 className="font-bold text-gray-800">{d.name}</h2>
                {d.kind === 'support' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">応援</span>
                )}
                {d.kind === 'project' && d.startsToday && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">着工</span>
                )}
                <span className="text-xs text-gray-400 ml-auto">{ws.length}人</span>
                {d.kind === 'project' && (
                  <>
                    <button onClick={() => { const p = projects.find(x => x.id === d.id)!; setEditing({ id: p.id, name: p.name, start_date: p.start_date }) }}
                      className="text-xs text-blue-600">修正</button>
                    <button onClick={() => completeProject(projects.find(p => p.id === d.id)!)}
                      className="text-xs text-gray-400 hover:text-emerald-600">完了</button>
                    <button onClick={() => deleteProject(projects.find(p => p.id === d.id)!)}
                      className="text-xs text-gray-300 hover:text-red-500">削除</button>
                  </>
                )}
                {d.kind === 'support' && (
                  <button onClick={() => { const sc = supports.find(x => x.id === d.id)!; setEditingSupport({ id: sc.id, name: sc.name }) }}
                    className="text-xs text-blue-600">修正</button>
                )}
                {d.kind === 'support' && (
                  <button onClick={() => deleteSupport(supports.find(s => s.id === d.id)!)}
                    className="text-xs text-gray-300 hover:text-red-500">削除</button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                {/* 時刻ピッカーだと入力が手間なので、「7:30」「7時半」など自由に打てるテキスト入力にする */}
                <input type="text" value={g?.meet_time ?? ''} placeholder="集合時間" className={inputCls}
                  onChange={e => updateGroupField(d, { meet_time: e.target.value || null })} />
                <input type="text" value={g?.meet_place ?? ''} placeholder="集合場所" className={inputCls}
                  onChange={e => updateGroupField(d, { meet_place: e.target.value || null })} />
              </div>
              <input type="text" value={g?.note ?? ''} placeholder="連絡事項（任意）" className={`${inputCls} w-full mb-2`}
                onChange={e => updateGroupField(d, { note: e.target.value || null })} />

              <div className="flex flex-wrap gap-1.5">
                {ws.map(w => (
                  <button key={w.id} onClick={() => setMoving(w)}
                    className="px-2.5 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-sm text-blue-800">
                    {w.name}
                  </button>
                ))}
                <button onClick={() => setAdding(d)}
                  className="px-2.5 py-1.5 rounded-full border border-dashed border-gray-300 text-sm text-gray-500">
                  ＋ 追加
                </button>
              </div>
            </section>
          )
        })}
      </div>

      {/* ごみ箱。間違って消した現場を元に戻せるようにする（Supabaseの無料プランは自動バックアップが無い） */}
      {trashed.length > 0 && (
        <div className="mt-3">
          <button onClick={() => setShowTrash(v => !v)}
            className="w-full flex items-center justify-between bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 text-sm">
            <span className="text-gray-600">🗑 ごみ箱（{trashed.length}件）</span>
            <span className="text-gray-400 text-xs">{showTrash ? '閉じる' : '開く'}</span>
          </button>
          {showTrash && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mt-2">
              <p className="text-xs text-gray-500 mb-3">
                記録は消えていません。「元に戻す」で現場ごと復活します。
              </p>
              {trashed.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm py-2.5 border-b last:border-0">
                  <div>
                    <p>{p.name}</p>
                    {p.deleted_at && (
                      <p className="text-xs text-gray-400">
                        {new Date(p.deleted_at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} に削除
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => restoreProject(p)} className="text-xs text-blue-600">元に戻す</button>
                    <button onClick={() => purgeProject(p)} className="text-xs text-gray-300 hover:text-red-500">完全削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 段取りの途中で新しい現場・応援先が出てきても、マスタ画面に移動せず足せるようにする */}
      <div className="mt-3">
        {addingProject ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm font-medium mb-2">現場を追加</p>
            <div className="flex gap-2">
              <input autoFocus value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addProject() }}
                placeholder="現場名" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button onClick={addProject} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">追加</button>
              <button onClick={() => { setAddingProject(false); setNewProjectName('') }}
                className="border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm">やめる</button>
            </div>
            <p className="text-xs text-gray-500 mt-2">着工日は{formatDate(date)}で登録します。場所や予算は後から現場一覧で足せます。</p>
          </div>
        ) : (
          <button onClick={() => setAddingProject(true)}
            className="w-full border border-dashed border-gray-300 text-gray-500 rounded-xl py-2.5 text-sm">
            ＋ 現場を追加
          </button>
        )}
      </div>

      <div className="mt-2">
        {addingSupport ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-sm font-medium mb-2">応援先を追加</p>
            <div className="flex gap-2">
              <input autoFocus value={newSupportName} onChange={e => setNewSupportName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addSupport() }}
                placeholder="会社名" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button onClick={addSupport} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">追加</button>
              <button onClick={() => { setAddingSupport(false); setNewSupportName('') }}
                className="border border-gray-300 text-gray-600 px-3 py-2 rounded-lg text-sm">やめる</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAddingSupport(true)}
            className="w-full border border-dashed border-gray-300 text-gray-500 rounded-xl py-2.5 text-sm">
            ＋ 応援先を追加
          </button>
        )}
      </div>

      <div className="mt-5">
        <button onClick={notify} disabled={notifying || assignments.length === 0}
          className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold disabled:opacity-40">
          {notifying ? '送信中...' : '職長に通知する'}
        </button>
        {assignments.length === 0
          ? <p className="text-xs text-gray-400 mt-2 text-center">配員を1人以上決めると送信できます。</p>
          : !notifiedAt && (
            <p className="text-xs text-gray-400 mt-2 text-center">
              押さなくても、夕方18:30に自動で送られます。
            </p>
          )}
        {message && <p className="text-sm text-gray-700 mt-3">{message}</p>}
      </div>

      {/* 行き先の移動シート。1人あたり2タップで入れ替えられるようにしている */}
      {moving && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setMoving(null)}>
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">{moving.name} さんの行き先</h3>
            <div className="flex flex-col gap-1.5">
              {dests.map(d => (
                <button key={destKey(d)} onClick={() => assign([moving.id], d)}
                  className="text-left px-3 py-2.5 rounded-xl border border-gray-200 text-sm">
                  {d.name}
                  {d.kind === 'support' && <span className="text-xs text-purple-600 ml-1">（応援）</span>}
                </button>
              ))}
              <button onClick={() => assign([moving.id], null)}
                className="text-left px-3 py-2.5 rounded-xl border border-amber-300 bg-amber-50 text-sm text-amber-800">
                未配置に戻す
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 現場の名前・着工日の修正 */}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setEditing(null)}>
          <div className="bg-white w-full rounded-t-2xl p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">現場の修正</h3>
            <label className="block text-xs text-gray-500 mb-1">現場名</label>
            <input autoFocus value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />
            <label className="block text-xs text-gray-500 mb-1">着工日</label>
            <input type="date" value={editing.start_date} onChange={e => setEditing({ ...editing, start_date: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button onClick={saveProjectEdit} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">保存</button>
              <button onClick={() => setEditing(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm">やめる</button>
            </div>
          </div>
        </div>
      )}

      {/* 応援先の名前の修正 */}
      {editingSupport && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setEditingSupport(null)}>
          <div className="bg-white w-full rounded-t-2xl p-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-3">応援先の修正</h3>
            <input autoFocus value={editingSupport.name} onChange={e => setEditingSupport({ ...editingSupport, name: e.target.value })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-4" />
            <div className="flex gap-2">
              <button onClick={saveSupportEdit} className="flex-1 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium">保存</button>
              <button onClick={() => setEditingSupport(null)} className="flex-1 border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm">やめる</button>
            </div>
          </div>
        </div>
      )}

      {/* 作業員の入退社をこの画面から扱えるようにする */}
      {managingWorkers && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setManagingWorkers(false)}>
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">段取りに出す作業員</h3>
            <p className="text-xs text-gray-500 mb-3">
              事務員や辞めた人は「外す」で段取りから消えます。出面などの他の画面と過去の記録はそのまま残ります。
            </p>
            <div className="flex gap-2 mb-3">
              <input value={newWorkerName} onChange={e => setNewWorkerName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addWorker() }}
                placeholder="作業員名" className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              <button onClick={addWorker} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm">追加</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {workers.length === 0 && <p className="text-sm text-gray-400">作業員が登録されていません。</p>}
              {dispatchWorkers.map(w => (
                <div key={w.id} className="flex justify-between items-center text-sm py-2.5 border-b">
                  <span>{w.name}</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => renameWorker(w)} className="text-xs text-blue-600">修正</button>
                    <button onClick={() => setInDispatch(w, false)} className="text-xs text-gray-400 hover:text-red-500">外す</button>
                  </div>
                </div>
              ))}

              {hiddenWorkers.length > 0 && (
                <div className="mt-4">
                  <p className="text-xs font-semibold text-gray-400 mb-1">段取りに出さない（{hiddenWorkers.length}人）</p>
                  {hiddenWorkers.map(w => (
                    <div key={w.id} className="flex justify-between items-center text-sm py-2.5 border-b">
                      <span className="text-gray-400">{w.name}</span>
                      <button onClick={() => setInDispatch(w, true)} className="text-xs text-blue-600">戻す</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setManagingWorkers(false)}
              className="mt-3 w-full border border-gray-300 text-gray-600 py-2.5 rounded-lg text-sm">閉じる</button>
          </div>
        </div>
      )}

      {/* 未配置からまとめて入れられる追加シート */}
      {adding && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40" onClick={() => setAdding(null)}>
          <div className="bg-white w-full rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold mb-1">{adding.name} に追加</h3>
            <p className="text-xs text-gray-500 mb-3">未配置の作業員から選びます。</p>
            {unassigned.length === 0
              ? <p className="text-sm text-gray-500">未配置の作業員がいません。</p>
              : (
                <div className="flex flex-col gap-1.5">
                  {unassigned.map(w => (
                    <button key={w.id} onClick={() => assign([w.id], adding)}
                      className="text-left px-3 py-2.5 rounded-xl border border-gray-200 text-sm">
                      {w.name}
                    </button>
                  ))}
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  )
}
