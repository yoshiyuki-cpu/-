import crypto from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { jstToday } from '@/lib/date'
import { loadNameCtx, sanitizeParsed, summaryLines, hasEntries, registerParsed, cancelReport, fmtDate, NameCtx, Parsed } from '@/lib/lineReport'

// LINE 公式アカウントの Webhook。
// 1) 1対1トークで連携コードが送られてきたら、その人の LINE を作業員に結び付ける（従来どおり）
// 2) それ以外の文章は「現場の報告」として AI に読ませ、現場が分かれば台帳に仮登録して返信する。
//    現場が分からなければ確認待ちにして、アプリの「LINE報告」で振り分けてもらう。
//    「取消」と送られたら、その人が直前に入れた報告の行を台帳から消す。
// 雑談（報告ではない文章）には返信しない。グループでうるさくしないため。
export const maxDuration = 30

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
// 手元の動作確認で LINE の代わりのサーバーに向けられるようにしておく（Google カレンダーと同じやり方）
const LINE_API = process.env.LINE_API_BASE || 'https://api.line.me'

function verifySignature(body: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret || !signature) return false
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64')
  return hash === signature
}

async function reply(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return
  await fetch(`${LINE_API}/v2/bot/message/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  })
}

// 文章を AI に読ませる。名前は登録済みの一覧から選ばせ、一覧に無いものは unmatched に入れさせる
async function parseText(text: string, ctx: NameCtx, today: string): Promise<Parsed> {
  const list = (xs: { id: number; name: string }[]) => xs.map(x => `${x.id}: ${x.name}`).join('\n') || '（なし）'
  const wasteList = ctx.wasteTypes.map(t => `${t.id}: ${t.name}（${t.unit}、単価${t.unit_price}円）`).join('\n') || '（なし）'
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: `これは解体工事会社のグループ LINE に書かれた1件のメッセージです。現場の職長が「どの現場で、誰が働いて（人工）、廃材を何トン出して、いくら経費がかかったか」を報告している場合、それを下の一覧の ID に当てはめて JSON で返してください。

ルール：
- 報告ではない文章（挨拶・雑談・質問・写真だけの説明など）なら {"is_report": false} だけ返す
- 現場は一覧の中から選ぶ。略称・地名の一部（「福田」「ベルジャパン」など）でも一覧の現場名に含まれていれば当てる。分からなければ null
- 日付は今日（${today}）を基準に。「昨日」なら前日、「9/20」なら ${today.slice(0, 4)}-09-20 のように YYYY-MM-DD で。書かれていなければ今日
- 人工は作業員一覧から選ぶ。「半日」「午前だけ」「午後だけ」は half、それ以外は full。「西谷と山田 1日ずつ」は2人とも full
- 廃材は廃材の種類一覧から選ぶ。数量は数値（「3t」→3）。金額が書かれていれば amount に、無ければ null
- 燃料代・車両代（重機・トラックのリース）・その他の経費は others に。entry_type は fuel / lease / expense。車両名が一覧にあれば vehicle_id
- 一覧に無い名前や、読み取れなかった部分は unmatched に元の文字列で入れる。勝手に増やさない
- JSON のみ返す

{"is_report": true, "project_id": 数値またはnull, "date": "YYYY-MM-DD", "labor": [{"worker_id": 数値, "day_type": "full"または"half"}], "waste": [{"waste_type_id": 数値, "quantity": 数値, "amount": 数値またはnull}], "others": [{"entry_type": "fuel"または"lease"または"expense", "amount": 数値, "note": "文字列またはnull", "vehicle_id": 数値またはnull}], "unmatched": ["文字列"]}

現場一覧：
${list(ctx.projects)}

作業員一覧：
${list(ctx.workers)}

廃材の種類一覧：
${wasteList}

車両一覧：
${list(ctx.vehicles)}

メッセージ：
${text}`,
    }],
  })
  const raw = (message.content[0] as { text?: string }).text ?? ''
  let json: unknown = null
  try { json = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim()) } catch { json = null }
  return sanitizeParsed(json, ctx, today)
}

type LineEvent = {
  type: string
  webhookEventId?: string
  replyToken?: string
  source?: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string }
  message?: { type: string; text?: string }
}

async function handleLinkCode(event: LineEvent, code: string): Promise<boolean> {
  const userId = event.source?.userId
  if (!userId) return false
  const { data: worker } = await supabase.from('workers').select('id, name').eq('line_link_code', code).maybeSingle()
  if (!worker) return false
  await supabase.from('workers').update({ line_user_id: userId, line_link_code: null }).eq('id', worker.id)
  if (event.replyToken) await reply(event.replyToken, `${worker.name}さんとして連携しました。今後、朝夕のリマインダーをこちらに送ります。`)
  return true
}

async function handleCancel(event: LineEvent): Promise<void> {
  const userId = event.source?.userId
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  let q = supabase.from('line_reports').select('*').eq('status', 'registered').gte('received_at', since)
    .order('received_at', { ascending: false }).limit(1)
  if (userId) q = q.eq('line_user_id', userId)
  const { data } = await q
  const target = data?.[0]
  if (!target) {
    if (event.replyToken) await reply(event.replyToken, '取り消せる報告が見つかりませんでした（24時間以内に登録したものだけ取り消せます）。アプリの「LINE報告」から直してください。')
    return
  }
  const removed = await cancelReport(supabase, target.id)
  if (event.replyToken) await reply(event.replyToken, `${fmtDate(target.parsed?.date ?? target.received_at.slice(0, 10))} の報告を取り消しました（${removed}件を台帳から消しました）。`)
}

async function handleReport(event: LineEvent, text: string): Promise<void> {
  const today = jstToday()
  // LINE は返事が遅いと同じ出来事を再送してくる。AI に読ませる前に、もう受け取っていないか見る
  if (event.webhookEventId) {
    const { data: dup } = await supabase.from('line_reports').select('id').eq('line_event_id', event.webhookEventId).maybeSingle()
    if (dup) return
  }
  const ctx = await loadNameCtx(supabase)
  const source = event.source
  const groupId = source?.type === 'group' ? source.groupId : source?.type === 'room' ? source.roomId : null
  const userId = source?.userId ?? null

  // 送った人が連携済みなら、誰の報告か分かるようにしておく
  let workerId: number | null = null
  if (userId) {
    const { data: w } = await supabase.from('workers').select('id').eq('line_user_id', userId).maybeSingle()
    workerId = w?.id ?? null
  }

  let parsed: Parsed
  try {
    parsed = await parseText(text, ctx, today)
  } catch (e) {
    console.error('line report parse failed:', e)
    parsed = { is_report: true, project_id: null, date: today, labor: [], waste: [], others: [], unmatched: [text] }
  }

  // 報告ではない文章は記録だけ残して黙っている
  const { data: saved, error: saveError } = await supabase.from('line_reports').insert({
    line_event_id: event.webhookEventId ?? null, line_group_id: groupId, line_user_id: userId, worker_id: workerId,
    text, parsed, status: parsed.is_report ? 'pending' : 'ignored', project_id: parsed.project_id,
  }).select('id').single()
  if (saveError) {
    // 同じ出来事の再送（unique 違反）は黙って終わる。表が無い（SQL 未実行）ときも、グループを騒がせない
    console.error('line report save failed:', saveError.message)
    return
  }
  if (!parsed.is_report) return

  const lines = summaryLines(parsed, ctx)
  const tail = parsed.unmatched.length ? [`読み取れなかった部分：${parsed.unmatched.join('、')}`] : []

  if (parsed.project_id == null || !hasEntries(parsed)) {
    const why = parsed.project_id == null ? 'どの現場か分かりませんでした' : '人工・廃材・経費が読み取れませんでした'
    if (event.replyToken) {
      await reply(event.replyToken, [`${why}。アプリの「LINE報告」で振り分けてください。`, ...lines, ...tail].join('\n'))
    }
    return
  }

  try {
    const { inserted, skippedLabor } = await registerParsed(supabase, saved.id, parsed, parsed.project_id, ctx)
    const project = ctx.projects.find(p => p.id === parsed.project_id)?.name ?? ''
    const skipped = skippedLabor.length ? [`（${skippedLabor.join('、')} は同じ日に登録済みのため重ねていません）`] : []
    if (event.replyToken) {
      await reply(event.replyToken, [
        `${project}（${fmtDate(parsed.date)}）に登録しました`,
        ...lines.map(l => '・' + l), ...skipped, ...tail,
        inserted > 0 ? '違っていたら「取消」と返信してください。アプリの「LINE報告」からも直せます。' : '',
      ].filter(Boolean).join('\n'))
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('line report register failed:', msg)
    if (event.replyToken) {
      await reply(event.replyToken, msg === 'no-column'
        ? '受け付けましたが、台帳の準備がまだです（Supabase で supabase-schema-line-reports.sql を実行してください）。アプリの「LINE報告」に残しています。'
        : '受け付けましたが、台帳に入れられませんでした。アプリの「LINE報告」から登録してください。')
    }
  }
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-line-signature')
  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const { events } = JSON.parse(body) as { events?: LineEvent[] }

  await Promise.all((events ?? []).map(async (event) => {
    try {
      if (event.type === 'follow') {
        if (event.replyToken) await reply(event.replyToken, '友達追加ありがとうございます。\nマスタ管理画面で発行された「連携コード」を、このトーク画面にそのまま送信してください。\n現場の報告（人工・廃材・経費）もここに書けば台帳に入ります。')
        return
      }
      if (event.type !== 'message' || event.message?.type !== 'text') return
      const text = (event.message.text ?? '').trim()
      if (!text) return

      // 連携コード（英数6文字）は先に試す。1対1のトークでしか来ない前提だが、グループでも害はない
      if (/^[A-Z0-9]{6}$/i.test(text) && await handleLinkCode(event, text.toUpperCase())) return

      if (/^(取消|取り消し|とりけし|キャンセル)$/.test(text)) { await handleCancel(event); return }

      await handleReport(event, text)
    } catch (e) {
      console.error('line webhook event failed:', e)
    }
  }))

  return NextResponse.json({ ok: true })
}
