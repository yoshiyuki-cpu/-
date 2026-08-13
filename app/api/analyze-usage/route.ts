import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { buildUsageAnalysisPrompt } from '@/lib/usageStats'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

// AI応答の生成に10秒以上かかることがあるため、関数の実行時間上限を延長する
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const { stats } = await req.json()
  if (!stats) return NextResponse.json({ error: 'no stats' }, { status: 400 })

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: buildUsageAnalysisPrompt(stats) }],
    })
    const text = (message.content[0] as { text: string }).text.trim()
    await supabase.from('usage_analyses').insert({ analysis: text, stats })
    return NextResponse.json({ analysis: text })
  } catch (e) {
    console.error('analyze-usage failed:', e)
    return NextResponse.json({ error: 'analysis failed' }, { status: 500 })
  }
}
