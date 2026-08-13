import crypto from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

function verifySignature(body: string, signature: string | null) {
  const secret = process.env.LINE_CHANNEL_SECRET
  if (!secret || !signature) return false
  const hash = crypto.createHmac('sha256', secret).update(body).digest('base64')
  return hash === signature
}

async function reply(replyToken: string, text: string) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN
  if (!token) return
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('x-line-signature')
  if (!verifySignature(body, signature)) {
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  const { events } = JSON.parse(body)

  await Promise.all((events ?? []).map(async (event: any) => {
    const userId = event.source?.userId
    if (!userId) return

    if (event.type === 'follow') {
      await reply(event.replyToken, '友達追加ありがとうございます。\nマスタ管理画面で発行された「連携コード」を、このトーク画面にそのまま送信してください。')
      return
    }

    if (event.type === 'message' && event.message?.type === 'text') {
      const code = event.message.text.trim()
      const { data: worker } = await supabase.from('workers').select('id, name').eq('line_link_code', code).maybeSingle()
      if (worker) {
        await supabase.from('workers').update({ line_user_id: userId, line_link_code: null }).eq('id', worker.id)
        await reply(event.replyToken, `${worker.name}さんとして連携しました。今後、朝夕のリマインダーをこちらに送ります。`)
      } else {
        await reply(event.replyToken, 'コードが見つかりませんでした。マスタ管理画面で発行した連携コードを確認して、もう一度送信してください。')
      }
    }
  }))

  return NextResponse.json({ ok: true })
}
