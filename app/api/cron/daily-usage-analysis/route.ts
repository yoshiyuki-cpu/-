import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchUsageEvents, computeUsageMetrics, toAiPayload, buildUsageAnalysisPrompt } from '@/lib/usageStats'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export const maxDuration = 30

// Vercel CronはCRON_SECRETが設定されていればAuthorizationヘッダーに付けて呼び出す。
// 未設定の環境でも動くよう、設定されている場合のみチェックする。
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

    return NextResponse.json({ ok: true })
  } catch (e) {
    console.error('daily-usage-analysis failed:', e)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
