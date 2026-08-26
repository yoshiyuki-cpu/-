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
  const [managingWorkers, setManagingWorkers] = useState(false)
  const [newWorkerName, setNewWorkerName] = useState('')

  useEffect(() => { load() }, [date])

  async function load() {
    setLoading(true)
    const [{ data: pj }, { data: sc }, { data: wk }, { data: plan }] = await Promise.all([
      supabase.from('projects').select('*').eq('status', 'active').order('name'),
      supabase.from('support_companies').select('*').eq('active', true).order('sort_order'),
      supabase.from('workers').select('id, name, in_dispatch').order('name'),
      supabase.from('dispatch_plans').select('*').eq('date', date).maybeSingle(),
    ])
    setProjects(pj ?? [])
    setSupports(sc ?? [])
    setWorkers(wk ?? [])
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
                  <button onClick={() => completeProject(projects.find(p => p.id === d.id)!)}
                    className="text-xs text-gray-400 hover:text-emerald-600">完了</button>
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
        {assignments.length === 0 && (
          <p className="text-xs text-gray-400 mt-2 text-center">配員を1人以上決めると送信できます。</p>
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
                  <button onClick={() => setInDispatch(w, false)} className="text-xs text-gray-400 hover:text-red-500">外す</button>
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
