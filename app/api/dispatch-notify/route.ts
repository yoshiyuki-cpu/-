import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { notifyDispatch } from '@/lib/dispatchNotify'

// 段取り画面の「職長に通知する」ボタンから呼ばれる。
// 18:30の自動送信（/api/cron/dispatch-reminder）と同じロジックを使う
export async function POST(req: NextRequest) {
  const { date } = await req.json()
  if (!date) return NextResponse.json({ error: 'invalid request' }, { status: 400 })

  const result = await notifyDispatch(supabase, date)
  if (!result.ok) {
    const message = result.reason === 'plan_not_found'
      ? 'この日の段取りがまだありません'
      : '配員がまだ決まっていません'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  return NextResponse.json({
    ok: true, notified: result.notified, preview: result.preview, errors: result.errors,
  })
}
