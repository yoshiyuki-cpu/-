import type { SupabaseClient } from '@supabase/supabase-js'
import { parseManifestText, matchManifest, ManifestCtx, ManifestMatch, ManifestText } from '@/lib/manifestParse'
import { registerParsed, loadNameCtx, fmtDate, Parsed } from '@/lib/lineReport'

// 良心マニフェストのグループの書き込みを、処分（廃材）の記録として台帳に入れる（2026-11 社長の依頼）。
// Webhook から呼ぶ。返事はすべて reply（通数を使わない）。社長の決めごと：
// ・毎回返事する（入ったときも、入らなかったときも）
// ・現場が決められない／処分場が未登録のときは、グループで聞き返す
// ・職長の手入力と二重になりそうなときは台帳に入れず、グループで「それでも入れるか」を聞く
// 読み取りの結果は line_reports に残すので、アプリの「LINE報告」からも振り分けられる。

export type LineMessage = Record<string, unknown>
type Candidate = { id: number; name: string }
type ManifestParsed = Parsed & { manifest?: { text: ManifestText; match: ManifestMatch } }
type ReportRow = { id: number; status: string; line_group_id: string | null; project_id: number | null; parsed: ManifestParsed | null }

const text = (t: string, quickReply?: LineMessage): LineMessage => (quickReply ? { type: 'text', text: t, quickReply } : { type: 'text', text: t })
const label = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s)
const postback = (l: string, data: string, displayText: string) => ({ type: 'action', action: { type: 'postback', label: label(l), data, displayText: displayText.slice(0, 300) } })

export async function loadManifestCtx(supabase: SupabaseClient): Promise<ManifestCtx> {
  const [{ data: pj }, { data: ds }, { data: wt }] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    supabase.from('disposal_sites').select('id, name'),
    supabase.from('waste_types').select('id, name, unit, unit_price, disposal_site_id'),
  ])
  return {
    // 進行中の現場だけ（ごみ箱・完了は候補にしない）
    projects: (pj ?? []).filter((p: { status?: string; deleted_at?: string | null }) => p.status === 'active' && !p.deleted_at)
      .map((p: { id: number; name: string }) => ({ id: p.id, name: p.name })),
    disposalSites: (ds ?? []) as ManifestCtx['disposalSites'],
    wasteTypes: (wt ?? []) as ManifestCtx['wasteTypes'],
  }
}

// 書き込みが「マニフェストのつもり」に見えるか（形が崩れていたら書き方を返すため）
const looksLikeManifest = (t: string) => /\d{1,2}\s*[月/／]\s*\d{1,2}/.test(t) && /(kg|ｋｇ|ｔ|t|トン|㎥|立米|円)/i.test(t)

const FORMAT_HELP = '書き方の例：\n11月9日　現場名　2トン\n処分場　廃材の種類\n0.71t（kg・円でも可）'

function describe(ctx: ManifestCtx, m: ManifestText, match: ManifestMatch) {
  const t = ctx.wasteTypes.find(x => x.id === match.wasteTypeId)
  const qty = match.quantity !== null && t ? `${match.quantity}${t.unit}` : ''
  const amount = match.amount ?? (t && match.quantity !== null ? Math.round(t.unit_price * match.quantity) : null)
  return `${m.disposalText}／${t?.name ?? m.typeText} ${qty}${amount !== null ? ` ${amount.toLocaleString()}円` : ''}`.trim()
}

export async function handleManifestText(
  supabase: SupabaseClient, input: { text: string; groupId: string; userId: string | null; eventId: string | null; today: string },
): Promise<LineMessage[] | null> {
  // LINE の再送で同じ書き込みを2回入れない
  if (input.eventId) {
    const { data: dup } = await supabase.from('line_reports').select('id').eq('line_event_id', input.eventId).maybeSingle()
    if (dup) return null
  }
  const m = parseManifestText(input.text, input.today)
  if (!m) {
    // 雑談は記録も返事もしない。マニフェストのつもりで形が崩れているときだけ書き方を返す
    return looksLikeManifest(input.text) ? [text(`読み取れませんでした。台帳には入れていません。\n${FORMAT_HELP}`)] : null
  }
  const ctx = await loadManifestCtx(supabase)
  const match = matchManifest(m, ctx)
  const projectId = match.candidates.length === 1 ? match.candidates[0].id : null
  const parsed: ManifestParsed = {
    is_report: true, project_id: projectId, date: m.date, labor: [], others: [], unmatched: [],
    waste: match.wasteTypeId !== null && match.quantity !== null ? [{ waste_type_id: match.wasteTypeId, quantity: match.quantity, amount: match.amount }] : [],
    manifest: { text: m, match },
  }
  if (match.problem && match.problem !== 'site-ambiguous' && match.problem !== 'site-unknown') parsed.unmatched = [`${m.disposalText} ${m.typeText}`]
  if (match.problem === 'site-unknown') parsed.unmatched = [m.siteText]

  let workerId: number | null = null
  if (input.userId) {
    const { data: w } = await supabase.from('workers').select('id').eq('line_user_id', input.userId).maybeSingle()
    workerId = w?.id ?? null
  }
  const { data: saved, error } = await supabase.from('line_reports').insert({
    line_event_id: input.eventId, line_group_id: input.groupId, line_user_id: input.userId, worker_id: workerId,
    text: input.text, parsed, status: 'pending', project_id: projectId, note: 'マニフェスト',
  }).select('id').single()
  if (error || !saved) {
    console.error('manifest save failed:', error?.message)
    return [text('受け付けましたが、記録できませんでした。アプリから入れてください。')]
  }

  const day = fmtDate(m.date)
  switch (match.problem) {
    case 'site-ambiguous':
      return [text(`${day} の「${m.siteText}」はどちらの現場ですか？下のボタンで選んでください。\n${describe(ctx, m, match)}`, {
        items: match.candidates.slice(0, 13).map(c => postback(c.name, `action=manifest_project&report=${saved.id}&project_id=${c.id}`, `${c.name} です`)),
      })]
    case 'site-unknown':
      return [text(`「${m.siteText}」が進行中の現場に見つかりません。台帳には入れていません。\n現場名を確かめて書き直すか、アプリの「LINE報告」で現場を選んでください。`)]
    case 'disposal-unknown':
      return [text(`処分場「${m.disposalText}」がアプリに登録されていません。台帳には入れていません。\nその他 → マスタ で処分場と廃材の種類を登録してから、アプリの「LINE報告」で登録してください。`)]
    case 'type-unknown':
      return [text(`「${m.disposalText}」に「${m.typeText}」の登録がありません。台帳には入れていません。\nその他 → マスタ で廃材の種類を登録してから、アプリの「LINE報告」で登録してください。`)]
    case 'unit-mismatch': {
      const t = ctx.wasteTypes.find(x => x.id === match.wasteTypeId)
      return [text(`「${m.disposalText}　${m.typeText}」は ${t?.unit ?? ''} で登録されています。量を ${t?.unit ?? ''} で書き直してください。台帳には入れていません。`)]
    }
  }
  return continueManifest(supabase, saved.id, projectId as number, false)
}

// 現場が決まった報告を台帳に入れる。force が無いときは、職長の手入力と二重にならないかを先に見る
async function continueManifest(supabase: SupabaseClient, reportId: number, projectId: number, force: boolean): Promise<LineMessage[]> {
  const { data: report } = await supabase.from('line_reports').select('*').eq('id', reportId).maybeSingle()
  const r = report as ReportRow | null
  const p = r?.parsed
  if (!r || !p || !p.manifest || !p.waste.length) return [text('この報告は台帳に入れられません。アプリの「LINE報告」で確認してください。')]
  const nameCtx = await loadNameCtx(supabase)
  const project = nameCtx.projects.find(x => x.id === projectId)?.name ?? `現場#${projectId}`
  const ctx = await loadManifestCtx(supabase)
  const desc = describe(ctx, p.manifest.text, p.manifest.match)
  const day = fmtDate(p.date)

  if (!force) {
    const w = p.waste[0]
    const { data: same } = await supabase.from('waste_entries').select('id, line_report_id')
      .eq('project_id', projectId).eq('date', p.date).eq('waste_type_id', w.waste_type_id)
    // 比べるのは職長がアプリで手入力した記録だけ（line_report_id が空）。
    // マニフェスト同士は、同じ日に同じ廃材を何往復も運ぶのが普通なので二重扱いしない
    if ((same ?? []).some((e: { line_report_id: number | null }) => !e.line_report_id)) {
      await supabase.from('line_reports').update({ project_id: projectId }).eq('id', reportId)
      return [text(`${project}（${day}）に同じ廃材の記録が既にあります。二重になるので、まだ台帳に入れていません。\n${desc}\n入れるかどうか選んでください。`, {
        items: [
          postback('それでも入れる', `action=manifest_force&report=${reportId}`, 'それでも入れる'),
          postback('入れない', `action=manifest_skip&report=${reportId}`, '入れない'),
        ],
      })]
    }
  }

  try {
    await registerParsed(supabase, reportId, { ...p, project_id: projectId }, projectId, nameCtx)
    return [text(`登録しました：${project}（${day}）\n${desc}\n違っていたら「取消」と返信してください。`)]
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('manifest register failed:', msg)
    if (msg.startsWith('gate:')) return [text(`${project}（${day}）の${msg.slice(5)}がまだなので、処分代を台帳に入れていません。\n済んだら、アプリの「LINE報告」から登録してください。`)]
    if (msg === 'no-column') return [text('受け付けましたが、台帳の準備がまだです（Supabase で supabase-schema-line-reports.sql を実行してください）。')]
    return [text('受け付けましたが、台帳に入れられませんでした。アプリの「LINE報告」から登録してください。')]
  }
}

// グループのボタン（現場の選択・それでも入れる・入れない）。中身は書き換えられる前提で確かめる
export async function handleManifestPostback(supabase: SupabaseClient, params: URLSearchParams, groupId: string | null): Promise<LineMessage[] | null> {
  const action = params.get('action')
  if (action !== 'manifest_project' && action !== 'manifest_force' && action !== 'manifest_skip') return null
  const reportId = Number(params.get('report'))
  if (!Number.isInteger(reportId) || reportId <= 0) return [text('ボタンの内容を読み取れませんでした。')]
  const { data } = await supabase.from('line_reports').select('*').eq('id', reportId).maybeSingle()
  const r = data as ReportRow | null
  // 押されたグループと報告のグループが同じで、まだ確認待ちのものだけ
  if (!r || !groupId || r.line_group_id !== groupId || !r.parsed?.manifest) return [text('この報告は見つかりませんでした。アプリの「LINE報告」で確認してください。')]
  if (r.status !== 'pending') return [text(r.status === 'registered' ? 'この報告はもう台帳に入っています。' : 'この報告はもう片付いています。')]

  if (action === 'manifest_skip') {
    await supabase.from('line_reports').update({ status: 'rejected' }).eq('id', reportId)
    return [text('台帳には入れませんでした。')]
  }
  if (action === 'manifest_project') {
    const projectId = Number(params.get('project_id'))
    const candidates: Candidate[] = r.parsed.manifest.match.candidates ?? []
    if (!candidates.some(c => c.id === projectId)) return [text('その現場は選べません。アプリの「LINE報告」で確認してください。')]
    await supabase.from('line_reports').update({ project_id: projectId, parsed: { ...r.parsed, project_id: projectId } }).eq('id', reportId)
    return continueManifest(supabase, reportId, projectId, false)
  }
  if (!r.project_id) return [text('現場が決まっていません。アプリの「LINE報告」で確認してください。')]
  return continueManifest(supabase, reportId, r.project_id, true)
}
