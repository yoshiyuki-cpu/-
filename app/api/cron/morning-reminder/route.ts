import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchUsageEvents, computeUsageMetrics, toAiPayload, buildUsageAnalysisPrompt } from '@/lib/usageStats'
import { fetchForemanTargets, sendReminderEmail, sendReminderPush, sendLineMessage, projectUrl } from '@/lib/notify'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const maxDuration = 30

// Vercel CronはCRON_SECRETが設定されていればAuthorizationヘッダーに付けて呼び出す。
// 未設定の環境でも動くよう、設定されている場合のみチェックする。
function isAuthorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// Vercel Hobbyプランはプロジェクトあたりcron 2件までのため、
// 朝7:50(JST)に「利用状況分析」と「職長への議事録・KY活動リマインド」を1本にまとめて実行する。
async function runUsageAnalysis() {
  const { events, projects, workers } = await fetchUsageEvents(supabase)
  const metrics = computeUsageMetrics(events, projects, workers)
  const stats = toAiPayload(metrics)

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    messages: [{ role: 'user', content: buildUsageAnalysisPrompt(stats) }],
  })
  const analysis = (message.content[0] as { text: string }).text.trim()
  await supabase.from('usage_analyses').insert({ analysis, stats })
}

async function runMorningReminder() {
  const targets = await fetchForemanTargets(supabase)

  await Promise.all(targets.map(async t => {
    const lines = [
      `${t.name}さん、おはようございます。`,
      '本日の議事録・KY活動の記入をお願いします。',
      '',
      ...t.projects.map(p => `【${p.name}】\n議事録: ${projectUrl('minutes', p.id)}\nKY活動: ${projectUrl('ky', p.id)}`),
    ]
    if (t.email) await sendReminderEmail(t.email, '【良心アプリ】本日の議事録・KY活動の入力をお願いします', lines)
    await sendReminderPush(supabase, t.worker_id, '議事録・KY活動の入力', '本日分の議事録・KY活動の記入をお願いします', projectUrl('minutes', t.projects[0].id))
    if (t.line_user_id) {
      try { await sendLineMessage(t.line_user_id, lines.join('\n')) } catch (e) { console.error('line send failed:', e) }
    }
  }))

  return targets.length
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results = await Promise.allSettled([runUsageAnalysis(), runMorningReminder()])
  const [analysisResult, reminderResult] = results

  if (analysisResult.status === 'rejected') console.error('usage analysis failed:', analysisResult.reason)
  if (reminderResult.status === 'rejected') console.error('morning reminder failed:', reminderResult.reason)

  return NextResponse.json({
    ok: true,
    usageAnalysis: analysisResult.status,
    morningReminder: reminderResult.status === 'fulfilled' ? { notified: reminderResult.value } : 'rejected',
  })
}
