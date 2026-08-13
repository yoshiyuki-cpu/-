import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendReminderEmail, sendReminderPush, sendLineMessage } from '@/lib/notify'

export async function POST(req: NextRequest) {
  const { workerId } = await req.json()
  if (!workerId) return NextResponse.json({ error: 'invalid request' }, { status: 400 })

  const { data: worker } = await supabase.from('workers').select('id, name, email, line_user_id').eq('id', workerId).maybeSingle()
  if (!worker) return NextResponse.json({ error: 'worker not found' }, { status: 404 })

  const result = {
    emailAttempted: false, emailError: null as string | null,
    pushAttempted: false, pushError: null as string | null,
    lineAttempted: false, lineError: null as string | null,
  }

  if (worker.email) {
    result.emailAttempted = true
    try {
      await sendReminderEmail(worker.email, '【良心アプリ】テスト通知', [
        `${worker.name}さん、これはテスト通知です。`,
        '朝・夕のリマインダーはこの形式で届きます。',
      ])
    } catch (e: any) {
      result.emailError = e?.message ?? 'unknown error'
    }
  }

  const { data: subs } = await supabase.from('push_subscriptions').select('id').eq('worker_id', workerId)
  if (subs && subs.length > 0) {
    result.pushAttempted = true
    try {
      await sendReminderPush(supabase, workerId, 'テスト通知', 'これはテスト通知です。この形式で朝・夕のリマインダーが届きます。', '/')
    } catch (e: any) {
      result.pushError = e?.message ?? 'unknown error'
    }
  }

  if (worker.line_user_id) {
    result.lineAttempted = true
    try {
      await sendLineMessage(worker.line_user_id, `${worker.name}さん、これはテスト通知です。\n朝・夕のリマインダーはこの形式で届きます。`)
    } catch (e: any) {
      result.lineError = e?.message ?? 'unknown error'
    }
  }

  return NextResponse.json({
    ok: true, ...result,
    hasEmail: !!worker.email, hasPush: (subs?.length ?? 0) > 0, hasLine: !!worker.line_user_id,
  })
}
