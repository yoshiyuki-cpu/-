import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadManifestCtx, LineMessage } from '@/lib/manifestLine'
import { fmtDate, Parsed } from '@/lib/lineReport'

// 「スクラップ」「燃料カード」のグループに送られた写真を読み、台帳に入れる（2026-11 社長の依頼）。社長の決めごと：
// ・伝票（スクラップ業者の計量票）やレシート（給油）だけを読む。荷台や品物の写真は黙って飛ばす（記録もしない）
// ・写真には現場名が無いので、読み取った内容を返事し、進行中の現場のボタンで「どの現場か」を聞く
// ・同じ日に同じ金額の記録がアプリにあれば、二重かもしれないので「それでも入れる／入れない」を聞く
// ・返事はすべて reply（通数を使わない）。違っていたら「取消」で消せる
// LINE の仕組みで、アルバムに追加した写真は公式LINEに届かない。トークに直接送った写真だけ読める。

export type PhotoKind = 'scrap' | 'fuel'
type ScrapRead = { is_slip: boolean; date: string | null; vendor: string | null; items: { name: string; weight: number | null; amount: number | null }[]; total: number | null }
type FuelRead = { is_receipt: boolean; date: string | null; station: string | null; liters: number | null; amount: number | null; fuel_type: '軽油' | 'レギュラー' | null; plate: string | null }
type PhotoExtra = { kind: PhotoKind; scrap?: ScrapRead; fuel?: FuelRead; amount: number }
type PhotoParsed = Parsed & { photo?: PhotoExtra }
type ReportRow = { id: number; status: string; line_group_id: string | null; project_id: number | null; parsed: PhotoParsed | null }

const LINE_DATA_API = process.env.LINE_DATA_API_BASE || 'https://api-data.line.me'
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const text = (t: string, quickReply?: LineMessage): LineMessage => (quickReply ? { type: 'text', text: t, quickReply } : { type: 'text', text: t })
const label = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s)
const postback = (l: string, data: string, displayText: string) => ({ type: 'action', action: { type: 'postback', label: label(l), data, displayText: displayText.slice(0, 300) } })
const yen = (n: number) => `${Math.round(n).toLocaleString()}円`
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
// スクラップの台帳で「どのLINE報告から入ったか」を見分ける印（scrap_records に line_report_id の列が無いため備考に入れる）
export const scrapMark = (reportId: number) => `（LINE#${reportId}）`

const PROMPTS: Record<PhotoKind, string> = {
  scrap: 'これは解体業者のLINEグループに送られた写真です。スクラップ業者の伝票・計量票・買取明細のどれかなら、内容をJSONで返してください。荷台や品物、人や景色の写真なら {"is_slip": false} だけ返してください。\n{"is_slip": true, "date": "YYYY-MM-DD または null", "vendor": "業者名 または null", "items": [{"name": "品目", "weight": 重量kgの数値またはnull, "amount": 金額の数値またはnull}], "total": 合計金額の数値またはnull}\n読み取れない項目は null。推測で数字を作らない。JSONのみ返す。',
  fuel: 'これは解体業者のLINEグループに送られた写真です。ガソリンスタンドの給油レシートが写っていれば、内容をJSONで返してください。レシートが無い写真なら {"is_receipt": false} だけ返してください。\n{"is_receipt": true, "date": "YYYY-MM-DD または null", "station": "スタンド名 または null", "liters": 給油量リットルの数値またはnull, "amount": 税込合計金額の数値またはnull, "fuel_type": "軽油" または "レギュラー"（軽油以外のガソリンはレギュラー。分からなければ null）, "plate": "写っている車のナンバーの数字部分（例 42-52）または null"}\n読み取れない項目は null。推測で数字を作らない。JSONのみ返す。',
}

async function downloadImage(messageId: string): Promise<{ data: string; mediaType: string } | null> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return null
  const res = await fetch(`${LINE_DATA_API}/v2/bot/message/${encodeURIComponent(messageId)}/content`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) { console.error('line image download failed:', res.status); return null }
  const buf = Buffer.from(await res.arrayBuffer())
  // 画像の読み取りは1枚5MBまで。それより大きい写真は読まない
  if (buf.length > 5 * 1024 * 1024) return null
  const type = res.headers.get('content-type') ?? 'image/jpeg'
  return { data: buf.toString('base64'), mediaType: /png|gif|webp/.test(type) ? type : 'image/jpeg' }
}

async function readImage(kind: PhotoKind, image: { data: string; mediaType: string }): Promise<unknown> {
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: image.mediaType as 'image/jpeg', data: image.data } },
      { type: 'text', text: PROMPTS[kind] },
    ] }],
  })
  const raw = (message.content[0] as { text?: string }).text ?? ''
  try { return JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim()) } catch { return null }
}

// AI の返事を、こちらが扱える形に絞る
export function sanitizeScrap(raw: unknown): ScrapRead | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.is_slip !== true) return null
  const items = (Array.isArray(r.items) ? r.items : []).map(i => i as Record<string, unknown>)
    .filter(i => typeof i.name === 'string' && i.name.trim())
    .map(i => ({ name: String(i.name).trim().slice(0, 40), weight: num(i.weight), amount: num(i.amount) }))
  const sum = items.reduce((s, i) => s + (i.amount ?? 0), 0)
  return { is_slip: true, date: isDate(r.date) ? r.date : null, vendor: typeof r.vendor === 'string' ? r.vendor.slice(0, 40) : null, items, total: num(r.total) ?? (sum > 0 ? sum : null) }
}

export function sanitizeFuel(raw: unknown): FuelRead | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (r.is_receipt !== true) return null
  return {
    is_receipt: true, date: isDate(r.date) ? r.date : null, station: typeof r.station === 'string' ? r.station.slice(0, 40) : null,
    liters: num(r.liters), amount: num(r.amount), fuel_type: r.fuel_type === '軽油' || r.fuel_type === 'レギュラー' ? r.fuel_type : null,
    plate: typeof r.plate === 'string' ? r.plate.slice(0, 20) : null,
  }
}

// 先の日付は読み違いとみなして今日にする
const pickDate = (d: string | null, today: string) => (d && d <= today ? d : today)

function describe(x: PhotoExtra) {
  if (x.kind === 'scrap' && x.scrap) {
    const items = x.scrap.items.map(i => `${i.name}${i.weight !== null ? ` ${i.weight}kg` : ''}${i.amount !== null ? ` ${yen(i.amount)}` : ''}`).join('、')
    return `${x.scrap.vendor ? `${x.scrap.vendor}　` : ''}${items || '品目不明'}\n合計 ${yen(x.amount)}`
  }
  const f = x.fuel as FuelRead
  return `${f.station ? `${f.station}　` : ''}${f.fuel_type ?? '油種不明'} ${f.liters !== null ? `${f.liters}L ` : ''}${yen(x.amount)}${f.plate ? `　車 ${f.plate}` : ''}`
}

export async function handlePhoto(
  supabase: SupabaseClient, input: { kind: PhotoKind; messageId: string; groupId: string; userId: string | null; eventId: string | null; today: string },
): Promise<LineMessage[] | null> {
  if (input.eventId) {
    const { data: dup } = await supabase.from('line_reports').select('id').eq('line_event_id', input.eventId).maybeSingle()
    if (dup) return null
  }
  const image = await downloadImage(input.messageId)
  if (!image) return null
  let raw: unknown = null
  try { raw = await readImage(input.kind, image) } catch (e) { console.error('photo read failed:', e); return null }
  const scrap = input.kind === 'scrap' ? sanitizeScrap(raw) : null
  const fuel = input.kind === 'fuel' ? sanitizeFuel(raw) : null
  // 伝票・レシートではない写真は黙って飛ばす（記録もしない）
  if (!scrap && !fuel) return null
  const label = input.kind === 'scrap' ? 'スクラップの伝票' : '給油のレシート'
  const amount = scrap?.total ?? fuel?.amount ?? null
  if (amount === null || amount <= 0) return [text(`${label}の写真を受け取りましたが、金額が読み取れませんでした。台帳には入れていません。\n明るい場所で、伝票全体が入るように撮り直して送ってください。`)]

  const date = pickDate(scrap?.date ?? fuel?.date ?? null, input.today)
  const extra: PhotoExtra = { kind: input.kind, scrap: scrap ?? undefined, fuel: fuel ?? undefined, amount }
  const parsed: PhotoParsed = { is_report: true, project_id: null, date, labor: [], waste: [], others: [], unmatched: [], photo: extra }
  let workerId: number | null = null
  if (input.userId) {
    const { data: w } = await supabase.from('workers').select('id').eq('line_user_id', input.userId).maybeSingle()
    workerId = w?.id ?? null
  }
  const { data: saved, error } = await supabase.from('line_reports').insert({
    line_event_id: input.eventId, line_group_id: input.groupId, line_user_id: input.userId, worker_id: workerId,
    text: `[写真] ${label}`, parsed, status: 'pending', note: input.kind === 'scrap' ? 'スクラップ' : '燃料',
  }).select('id').single()
  if (error || !saved) { console.error('photo save failed:', error?.message); return [text('写真を受け取りましたが、記録できませんでした。アプリから入れてください。')] }

  const { projects } = await loadManifestCtx(supabase)
  return [text(`${label}を読み取りました（${fmtDate(date)}）\n${describe(extra)}\nどの現場の分ですか？下のボタンで選んでください。`, {
    items: [
      ...projects.slice(0, 12).map(p => postback(p.name, `action=photo_project&report=${saved.id}&project_id=${p.id}`, `${p.name} です`)),
      postback('入れない', `action=photo_skip&report=${saved.id}`, '入れない'),
    ],
  })]
}

async function insertPhoto(supabase: SupabaseClient, r: ReportRow, projectId: number): Promise<void> {
  const p = r.parsed as PhotoParsed
  const x = p.photo as PhotoExtra
  if (x.kind === 'scrap') {
    const s = x.scrap as ScrapRead
    const { error } = await supabase.from('scrap_records').insert({
      project_id: projectId, date: p.date, amount: Math.round(x.amount),
      items: s.items.length ? JSON.stringify(s.items.map(i => ({ name: i.name, amount: i.amount ?? 0 }))) : null,
      note: `LINEの伝票写真から${s.vendor ? `（${s.vendor}）` : ''}${scrapMark(r.id)}`,
    })
    if (error) throw new Error(error.message)
  } else {
    const f = x.fuel as FuelRead
    const { error } = await supabase.from('other_entries').insert({
      project_id: projectId, entry_type: 'fuel', date: p.date, quantity: f.liters ?? 1, unit_price: Math.round(x.amount), amount: Math.round(x.amount),
      fuel_type: f.fuel_type, vehicle_id: null, line_report_id: r.id,
      note: ['LINEのレシート写真から', f.station, f.plate ? `車 ${f.plate}` : null].filter(Boolean).join(' '),
    })
    if (error) throw new Error(error.message)
  }
  await supabase.from('line_reports').update({ status: 'registered', project_id: projectId, registered_at: new Date().toISOString() }).eq('id', r.id)
}

// 現場が決まった写真を台帳に入れる。force が無いときは、同じ日に同じ金額の記録が無いかを先に見る
async function registerPhoto(supabase: SupabaseClient, r: ReportRow, projectId: number, force: boolean): Promise<LineMessage[]> {
  const p = r.parsed as PhotoParsed
  const x = p.photo as PhotoExtra
  const { projects } = await loadManifestCtx(supabase)
  const project = projects.find(q => q.id === projectId)?.name ?? `現場#${projectId}`
  if (!force) {
    const amount = Math.round(x.amount)
    const { data } = x.kind === 'scrap'
      ? await supabase.from('scrap_records').select('id, note').eq('date', p.date).eq('amount', amount)
      : await supabase.from('other_entries').select('id, line_report_id').eq('date', p.date).eq('entry_type', 'fuel').eq('amount', amount)
    const others = (data ?? []).filter((e: { note?: string | null; line_report_id?: number | null }) =>
      x.kind === 'scrap' ? !(e.note ?? '').includes(scrapMark(r.id)) : e.line_report_id !== r.id)
    if (others.length) {
      await supabase.from('line_reports').update({ project_id: projectId }).eq('id', r.id)
      return [text(`${fmtDate(p.date)} に同じ金額（${yen(amount)}）の記録がアプリに既にあります。二重になるかもしれないので、まだ台帳に入れていません。入れるかどうか選んでください。`, {
        items: [postback('それでも入れる', `action=photo_force&report=${r.id}`, 'それでも入れる'), postback('入れない', `action=photo_skip&report=${r.id}`, '入れない')],
      })]
    }
  }
  try {
    await insertPhoto(supabase, r, projectId)
  } catch (e) {
    console.error('photo register failed:', e instanceof Error ? e.message : e)
    return [text('台帳に入れられませんでした。アプリから入れてください。')]
  }
  return [text(`登録しました：${project}（${fmtDate(p.date)}）\n${x.kind === 'scrap' ? 'スクラップ' : '燃料代'} ${yen(x.amount)}\n違っていたら「取消」と返信してください。`)]
}

// 写真のボタン（現場の選択・それでも入れる・入れない）。中身は書き換えられる前提で確かめる
export async function handlePhotoPostback(supabase: SupabaseClient, params: URLSearchParams, groupId: string | null): Promise<LineMessage[] | null> {
  const action = params.get('action')
  if (action !== 'photo_project' && action !== 'photo_force' && action !== 'photo_skip') return null
  const reportId = Number(params.get('report'))
  const { data } = await supabase.from('line_reports').select('*').eq('id', reportId).maybeSingle()
  const r = data as ReportRow | null
  if (!r || !groupId || r.line_group_id !== groupId || !r.parsed?.photo) return [text('この写真の記録は見つかりませんでした。アプリで確認してください。')]
  if (r.status !== 'pending') return [text(r.status === 'registered' ? 'この写真はもう台帳に入っています。' : 'この写真はもう片付いています。')]
  if (action === 'photo_skip') {
    await supabase.from('line_reports').update({ status: 'rejected' }).eq('id', reportId)
    return [text('台帳には入れませんでした。')]
  }
  if (action === 'photo_project') {
    const projectId = Number(params.get('project_id'))
    const { projects } = await loadManifestCtx(supabase)
    if (!projects.some(q => q.id === projectId)) return [text('その現場は選べません。アプリで確認してください。')]
    return registerPhoto(supabase, r, projectId, false)
  }
  if (!r.project_id) return [text('現場が決まっていません。アプリで確認してください。')]
  return registerPhoto(supabase, r, r.project_id, true)
}
