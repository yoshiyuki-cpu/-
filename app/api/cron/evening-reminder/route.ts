import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchForemanTargets, sendReminderEmail, sendReminderPush, projectUrl } from '@/lib/notify'

export const maxDuration = 30

function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const targets = await fetchForemanTargets(supabase)

    await Promise.all(targets.map(async t => {
      const lines = [
        `${t.name}さん、本日もお疲れさまです。`,
        '工事台帳の記入・写真の貼り付けをお願いします。',
        '',
        ...t.projects.map(p => `【${p.name}】\n記入: ${projectUrl('entry', p.id)}`),
      ]
      if (t.email) await sendReminderEmail(t.email, '【良心アプリ】本日の工事台帳記入・写真貼り付けをお願いします', lines)
      await sendReminderPush(supabase, t.worker_id, '工事台帳の記入', '本日分の工事台帳記入・写真の貼り付けをお願いします', projectUrl('entry', t.projects[0].id))
    }))

    return NextResponse.json({ ok: true, notified: targets.length })
  } catch (e) {
    console.error('evening-reminder failed:', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
