import type { SupabaseClient } from '@supabase/supabase-js'
import { parseDemenText, matchWorker, matchVehicle, normalizeWasteName, DemenText, DemenWorker, DemenVehicleRow } from '@/lib/demenParse'
import { matchProjects, matchManifest } from '@/lib/manifestParse'
import { loadManifestCtx, LineMessage } from '@/lib/manifestLine'
import { registerParsed, loadNameCtx, fmtDate, Parsed, ParsedLabor, ParsedOther } from '@/lib/lineReport'

// 「出面　経費確認」のグループの1日1現場のまとめを、台帳に入れる（2026-11 社長の依頼）。社長の決めごと：
// ・出面（人工）と車両代を入れる。廃材は台帳に入れず、マニフェストから入った記録との照合だけに使う
// ・作業員が決められない（同じ名字が2人）ときはグループでボタンを出して聞き返す。未登録の人は登録をお願いする
// ・「計28.5人工」などの累計は台帳の合計と比べ、ずれていれば知らせる
// ・アプリに既にある人工・車両代は重ねない。知らせるのはグループの返事だけ（担当職長の名前を入れる）
// 返事はすべて reply（通数を使わない）。読み取った内容は line_reports に残し、「取消」で消せる。

type Candidate = { id: number; name: string }
type PendingName = { text: string; candidates: Candidate[]; resolved: boolean }
type DemenExtra = {
  text: DemenText
  projectCandidates: Candidate[]
  pendingNames: PendingName[]
  unknownNames: string[]
  unknownVehicles: string[]
  laborHold: boolean
}
type DemenParsed = Parsed & { demen?: DemenExtra }
type ReportRow = { id: number; status: string; line_group_id: string | null; project_id: number | null; parsed: DemenParsed | null }

const text = (t: string, quickReply?: LineMessage): LineMessage => (quickReply ? { type: 'text', text: t, quickReply } : { type: 'text', text: t })
const label = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s)
const postback = (l: string, data: string, displayText: string) => ({ type: 'action', action: { type: 'postback', label: label(l), data, displayText: displayText.slice(0, 300) } })
const looksLikeDemen = (t: string) => /\d{1,2}\s*[月/／]\s*\d{1,2}/.test(t) && /人工/.test(t)
const yen = (n: number) => `${Math.round(n).toLocaleString()}円`
const same = (a: number, b: number) => Math.abs(a - b) < 0.001

async function loadWorkers(supabase: SupabaseClient): Promise<DemenWorker[]> {
  const { data } = await supabase.from('workers').select('id, name, in_dispatch').order('name')
  return (data ?? []).filter((w: { in_dispatch?: boolean }) => w.in_dispatch !== false).map((w: { id: number; name: string }) => ({ id: w.id, name: w.name }))
}

async function loadVehicles(supabase: SupabaseClient): Promise<DemenVehicleRow[]> {
  const { data } = await supabase.from('vehicles').select('id, name, category, default_price')
  return (data ?? []) as DemenVehicleRow[]
}

function askName(reportId: number, idx: number, p: PendingName): LineMessage {
  return text(`「${p.text}」はどなたですか？下のボタンで選んでください。`, {
    items: p.candidates.slice(0, 13).map(c => postback(c.name, `action=demen_worker&report=${reportId}&idx=${idx}&worker_id=${c.id}`, `${c.name} です`)),
  })
}

export async function handleDemenText(
  supabase: SupabaseClient, input: { text: string; groupId: string; userId: string | null; eventId: string | null; today: string },
): Promise<LineMessage[] | null> {
  if (input.eventId) {
    const { data: dup } = await supabase.from('line_reports').select('id').eq('line_event_id', input.eventId).maybeSingle()
    if (dup) return null
  }
  const d = parseDemenText(input.text, input.today)
  if (!d) {
    return looksLikeDemen(input.text)
      ? [text('まとめの形として読み取れませんでした。台帳には入れていません。\n1行目に「11月9日　現場名」、そのあとに名前、「4人工」、車両の台数を書いてください。')]
      : null
  }
  const [ctx, workers, vehicles] = await Promise.all([loadManifestCtx(supabase), loadWorkers(supabase), loadVehicles(supabase)])
  const projectCandidates = matchProjects(d.siteText, ctx.projects)
  const projectId = projectCandidates.length === 1 ? projectCandidates[0].id : null

  // 作業員：決まった人・決められない人（ボタンで聞く）・未登録の人
  const decided: number[] = []
  const pendingNames: PendingName[] = []
  const unknownNames: string[] = []
  for (const name of d.names) {
    const hits = matchWorker(name, workers)
    if (hits.length === 1) { if (!decided.includes(hits[0].id)) decided.push(hits[0].id) }
    else if (hits.length > 1) pendingNames.push({ text: name, candidates: hits, resolved: false })
    else unknownNames.push(name)
  }
  // 人数と人工が合わない（半日の人がいる）ときは、誰が半日か分からないので人工は入れない
  const laborHold = d.labor !== null && !same(d.labor, d.names.length)
  const labor: ParsedLabor[] = laborHold ? [] : decided.map(worker_id => ({ worker_id, day_type: 'full' as const }))

  // 車両代：0台の行は入れない。単価は車両マスタの1日の値段
  const others: ParsedOther[] = []
  const unknownVehicles: string[] = []
  for (const v of d.vehicles.filter(x => x.count > 0)) {
    const hit = matchVehicle(v, vehicles)
    if (!hit) { unknownVehicles.push(`${v.text}${v.category === 'rental' ? 'リース' : v.category === 'owned' ? '自社' : ''}`); continue }
    others.push({ entry_type: 'lease', amount: Math.round((hit.default_price ?? 0) * v.count), note: same(v.count, 0.5) ? '半日' : v.count !== 1 ? `${v.count}台` : null, vehicle_id: hit.id })
  }

  const parsed: DemenParsed = {
    is_report: true, project_id: projectId, date: d.date, labor, waste: [], others, unmatched: [...unknownNames, ...unknownVehicles],
    demen: { text: d, projectCandidates, pendingNames, unknownNames, unknownVehicles, laborHold },
  }
  let workerId: number | null = null
  if (input.userId) {
    const { data: w } = await supabase.from('workers').select('id').eq('line_user_id', input.userId).maybeSingle()
    workerId = w?.id ?? null
  }
  const { data: saved, error } = await supabase.from('line_reports').insert({
    line_event_id: input.eventId, line_group_id: input.groupId, line_user_id: input.userId, worker_id: workerId,
    text: input.text, parsed, status: 'pending', project_id: projectId, note: '出面',
  }).select('id').single()
  if (error || !saved) {
    console.error('demen save failed:', error?.message)
    return [text('受け付けましたが、記録できませんでした。アプリから入れてください。')]
  }

  if (projectCandidates.length > 1) {
    return [text(`${fmtDate(d.date)} の「${d.siteText}」はどちらの現場ですか？下のボタンで選んでください。`, {
      items: projectCandidates.slice(0, 13).map(c => postback(c.name, `action=demen_project&report=${saved.id}&project_id=${c.id}`, `${c.name} です`)),
    })]
  }
  if (!projectId) return [text(`「${d.siteText}」が進行中の現場に見つかりません。台帳には入れていません。\n現場名を確かめて書き直すか、アプリの「LINE報告」で現場を選んでください。`)]
  return registerDemen(supabase, saved.id, projectId)
}

// 現場が決まったまとめを台帳に入れ、照合の結果と一緒に返事を作る
async function registerDemen(supabase: SupabaseClient, reportId: number, projectId: number): Promise<LineMessage[]> {
  const { data } = await supabase.from('line_reports').select('*').eq('id', reportId).maybeSingle()
  const r = data as ReportRow | null
  const p = r?.parsed
  if (!r || !p?.demen) return [text('この報告は台帳に入れられません。アプリの「LINE報告」で確認してください。')]
  const x = p.demen
  const nameCtx = await loadNameCtx(supabase)
  const vehicles = await loadVehicles(supabase)
  const project = nameCtx.projects.find(q => q.id === projectId)?.name ?? `現場#${projectId}`
  const day = fmtDate(p.date)
  const vname = (id: number | null) => { const v = vehicles.find(q => q.id === id); return v ? `${v.name}${v.category === 'rental' ? '（リース）' : '（自社）'}` : '車両' }
  const wname = (id: number) => nameCtx.workers.find(w => w.id === id)?.name ?? `#${id}`

  // 車両代：アプリに手入力の同じ車両があれば重ねない
  const { data: lease } = await supabase.from('other_entries').select('vehicle_id, line_report_id')
    .eq('project_id', projectId).eq('date', p.date).eq('entry_type', 'lease')
  const manualVehicles = new Set((lease ?? []).filter((e: { line_report_id: number | null }) => !e.line_report_id).map((e: { vehicle_id: number | null }) => e.vehicle_id))
  const skippedVehicles = p.others.filter(o => manualVehicles.has(o.vehicle_id))
  const others = p.others.filter(o => !manualVehicles.has(o.vehicle_id))

  const lines: string[] = []
  const warnings: string[] = []
  try {
    const { skippedLabor } = await registerParsed(supabase, reportId, { ...p, project_id: projectId, others }, projectId, nameCtx)
    const inLabor = p.labor.filter(l => !skippedLabor.includes(wname(l.worker_id)))
    lines.push(`登録しました：${project}（${day}）`)
    if (inLabor.length) lines.push(`人工：${inLabor.map(l => wname(l.worker_id)).join('、')}（各1日）`)
    if (others.length) lines.push(`車両代：${others.map(o => `${vname(o.vehicle_id)}${o.note ? ` ${o.note}` : ''} ${yen(o.amount)}`).join('、')}`)
    if (skippedLabor.length) warnings.push(`人工：${skippedLabor.join('、')} は同じ日にアプリへ入っているので重ねていません`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('demen register failed:', msg)
    if (msg.startsWith('gate:')) return [text(`${project}（${day}）の${msg.slice(5)}がまだなので、人工を台帳に入れていません。\n済んだら、アプリの「LINE報告」から登録してください。`)]
    return [text('受け付けましたが、台帳に入れられませんでした。アプリの「LINE報告」から登録してください。')]
  }
  await supabase.from('line_reports').update({ parsed: { ...p, project_id: projectId, others } }).eq('id', reportId)

  if (skippedVehicles.length) warnings.push(`車両代：${skippedVehicles.map(o => vname(o.vehicle_id)).join('、')} は同じ日にアプリへ入っているので重ねていません`)
  if (x.laborHold) warnings.push(`人数（${x.text.names.length}人）と人工（${x.text.labor}）が合わないので、人工は入れていません。半日の人をアプリで入れてください`)
  if (x.unknownNames.length) warnings.push(`作業員に登録がありません：${x.unknownNames.join('、')}（その他 → マスタ で登録してから、アプリで入れてください）`)
  if (x.unknownVehicles.length) warnings.push(`車両に登録がありません：${x.unknownVehicles.join('、')}`)
  warnings.push(...await checkWaste(supabase, x.text, projectId, p.date))
  warnings.push(...await checkTotals(supabase, x.text, projectId, p.date, vehicles))

  if (warnings.length) {
    const { data: fp } = await supabase.from('foreman_projects').select('worker_id').eq('project_id', projectId)
    const foremen = (fp ?? []).map((f: { worker_id: number }) => wname(f.worker_id))
    lines.push('', '⚠ 確認してください', ...warnings.map(w => `・${w}`))
    lines.push(foremen.length ? `担当：${foremen.join('・')}さん　二重や入れ忘れがあればアプリで直してください。` : '二重や入れ忘れがあればアプリで直してください。')
  }
  lines.push('違っていたら「取消」と返信してください。')

  const next = x.laborHold ? -1 : x.pendingNames.findIndex(n => !n.resolved)
  return next >= 0 ? [text(lines.join('\n')), askName(reportId, next, x.pendingNames[next])] : [text(lines.join('\n'))]
}

// 廃材の照合：まとめの廃材と、台帳（マニフェストから入ったものも手入力も）を量で突き合わせる
async function checkWaste(supabase: SupabaseClient, d: DemenText, projectId: number, date: string): Promise<string[]> {
  if (!d.waste.length) return []
  const ctx = await loadManifestCtx(supabase)
  const { data } = await supabase.from('waste_entries').select('id, waste_type_id, quantity, amount').eq('project_id', projectId).eq('date', date)
  const ledger = [...((data ?? []) as { id: number; waste_type_id: number; quantity: number; amount: number }[])]
  const missing: string[] = []
  const unknown: string[] = []
  for (const w of d.waste) {
    const m = matchManifest({ date, siteText: '', truck: null, disposalText: w.disposalText, typeText: normalizeWasteName(w.typeText), quantity: w.quantity, unit: w.unit, amount: w.amount, note: null }, ctx)
    const label = `${w.disposalText} ${w.typeText} ${w.quantity !== null ? `${w.quantity}${w.unit ?? ''}` : w.amount !== null ? yen(w.amount) : ''}`.trim()
    if (m.wasteTypeId === null) { unknown.push(label); continue }
    const i = ledger.findIndex(e => e.waste_type_id === m.wasteTypeId && (w.quantity !== null && m.quantity !== null ? same(Number(e.quantity), m.quantity) : w.amount !== null && same(Number(e.amount), w.amount)))
    if (i >= 0) ledger.splice(i, 1)
    else missing.push(label)
  }
  const out: string[] = []
  if (missing.length) out.push(`廃材：台帳に無いもの ${missing.join('、')}（マニフェストの書き込みがまだか、入れ忘れかもしれません）`)
  if (ledger.length) {
    const name = (id: number) => ctx.wasteTypes.find(t => t.id === id)?.name ?? `#${id}`
    out.push(`廃材：まとめに無いのに台帳にあるもの ${ledger.map(e => `${name(e.waste_type_id)} ${e.quantity}`).join('、')}（二重かもしれません）`)
  }
  if (unknown.length) out.push(`廃材：処分場か種類が未登録で照合できないもの ${unknown.join('、')}`)
  return out
}

// 累計の照合：「計28.5人工」「計7.5台」と、台帳のその日までの合計を比べる
async function checkTotals(supabase: SupabaseClient, d: DemenText, projectId: number, date: string, vehicles: DemenVehicleRow[]): Promise<string[]> {
  const out: string[] = []
  if (d.laborTotal !== null) {
    const { data } = await supabase.from('labor_entries').select('day_type, date').eq('project_id', projectId)
    const total = (data ?? []).filter((e: { date: string }) => e.date <= date).reduce((s: number, e: { day_type: string }) => s + (e.day_type === 'half' ? 0.5 : 1), 0)
    if (!same(total, d.laborTotal)) out.push(`累計の人工：まとめは${d.laborTotal}人工、台帳は${total}人工`)
  }
  const withTotal = d.vehicles.filter(v => v.total !== null)
  if (withTotal.length) {
    const { data } = await supabase.from('other_entries').select('vehicle_id, quantity, date, note').eq('project_id', projectId).eq('entry_type', 'lease')
    const rows = (data ?? []).filter((e: { date: string }) => e.date <= date) as { vehicle_id: number | null; quantity: number; note: string | null }[]
    for (const v of withTotal) {
      const hit = matchVehicle(v, vehicles)
      if (!hit) continue
      // 車両代は数量1で入り、半日は備考「半日」、2台以上は備考「2台」なので、備考から台数を数える
      const count = (e: { quantity: number; note: string | null }) => {
        if (e.note === '半日') return 0.5
        const m = e.note?.match(/^([\d.]+)台$/)
        return m ? Number(m[1]) : Number(e.quantity) || 1
      }
      const total = rows.filter(e => e.vehicle_id === hit.id).reduce((s, e) => s + count(e), 0)
      if (!same(total, v.total as number)) out.push(`累計の車両：${hit.name}${hit.category === 'rental' ? 'リース' : '自社'} まとめは${v.total}台、台帳は${total}台`)
    }
  }
  return out
}

// グループのボタン（現場の選択・作業員の選択）。中身は書き換えられる前提で確かめる
export async function handleDemenPostback(supabase: SupabaseClient, params: URLSearchParams, groupId: string | null): Promise<LineMessage[] | null> {
  const action = params.get('action')
  if (action !== 'demen_project' && action !== 'demen_worker') return null
  const reportId = Number(params.get('report'))
  const { data } = await supabase.from('line_reports').select('*').eq('id', reportId).maybeSingle()
  const r = data as ReportRow | null
  if (!r || !groupId || r.line_group_id !== groupId || !r.parsed?.demen) return [text('この報告は見つかりませんでした。アプリの「LINE報告」で確認してください。')]
  const x = r.parsed.demen

  if (action === 'demen_project') {
    if (r.status !== 'pending') return [text('この報告はもう台帳に入っています。')]
    const projectId = Number(params.get('project_id'))
    if (!x.projectCandidates.some(c => c.id === projectId)) return [text('その現場は選べません。アプリの「LINE報告」で確認してください。')]
    await supabase.from('line_reports').update({ project_id: projectId, parsed: { ...r.parsed, project_id: projectId } }).eq('id', reportId)
    return registerDemen(supabase, reportId, projectId)
  }

  // 作業員の選択：現場が決まって台帳に入ったあとに、決められなかった人を1人ずつ足す
  const idx = Number(params.get('idx'))
  const workerId = Number(params.get('worker_id'))
  const pending = x.pendingNames[idx]
  if (!pending || !r.project_id) return [text('この選択は使えません。アプリの「LINE報告」で確認してください。')]
  if (pending.resolved) return [text(`「${pending.text}」はもう選ばれています。`)]
  if (!pending.candidates.some(c => c.id === workerId)) return [text('その人は選べません。アプリの「LINE報告」で確認してください。')]
  const nameCtx = await loadNameCtx(supabase)
  const name = pending.candidates.find(c => c.id === workerId)?.name ?? ''
  let msg: string
  try {
    const { skippedLabor } = await registerParsed(supabase, reportId,
      { ...r.parsed, labor: [{ worker_id: workerId, day_type: 'full' }], waste: [], others: [] }, r.project_id, nameCtx)
    msg = skippedLabor.length ? `${name}さんは同じ日にアプリへ入っているので重ねていません。` : `登録しました：${name}さん（1日）`
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    msg = m.startsWith('gate:') ? `${m.slice(5)}がまだなので、人工を入れていません。アプリの「LINE報告」から登録してください。` : '台帳に入れられませんでした。アプリから入れてください。'
  }
  const names = x.pendingNames.map((n, i) => (i === idx ? { ...n, resolved: true } : n))
  const parsed = { ...r.parsed, labor: [...r.parsed.labor, { worker_id: workerId, day_type: 'full' as const }], demen: { ...x, pendingNames: names } }
  await supabase.from('line_reports').update({ parsed }).eq('id', reportId)
  const next = names.findIndex(n => !n.resolved)
  return next >= 0 ? [text(msg), askName(reportId, next, names[next])] : [text(msg)]
}
