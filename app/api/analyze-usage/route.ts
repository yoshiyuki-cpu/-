import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { stats } = await req.json()
  if (!stats) return NextResponse.json({ error: 'no stats' }, { status: 400 })

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `あなたは解体工事会社の経営アドバイザーです。以下は自社の工事台帳アプリの利用状況データ（JSON）です。

${JSON.stringify(stats, null, 1)}

補足:
- weekly は週別の記録件数（最後の週は今週で集計途中）
- projectsLastInput の ago は最終入力からの経過日数（null は90日以上入力なし）
- workersLabor30d は直近30日で人工（出面）記録があった日数

このデータを社長向けに日本語で分析してください。以下の4項目で、専門用語を使わず、全体で400字程度に簡潔にまとめてください。

【定着度】アプリがどれくらい使われているかの評価（1行）
【良い点】数字を挙げて2点まで
【注意点】入力が止まっている現場・記録漏れの可能性など、具体名を挙げて
【今週のアクション】社長が今週やるべきことを1〜2個、具体的に

分析文のみ返してください。前置きは不要です。`,
        },
      ],
    })
    const text = (message.content[0] as { text: string }).text.trim()
    return NextResponse.json({ analysis: text })
  } catch {
    return NextResponse.json({ error: 'analysis failed' }, { status: 500 })
  }
}
