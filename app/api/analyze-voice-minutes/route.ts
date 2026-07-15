import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { text } = await req.json()

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `これは工事現場のKY活動（危険予知活動）を音声認識で文字起こししたテキストです。音声認識特有の誤字脱字・誤変換を文脈から自然に修正したうえで、内容を「危険箇所」「注意事項」「伝達事項」に分類してJSON形式で返してください。{"danger_points": "危険箇所の内容", "cautions": "注意事項の内容", "notices": "伝達事項の内容"}。該当する内容がない項目はnullにしてください。JSONのみ返してください。\n\n文字起こしテキスト：\n${text}`,
      },
    ],
  })

  try {
    const t = (message.content[0] as any).text.trim()
    const json = JSON.parse(t.replace(/```json\n?|\n?```/g, '').trim())
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ danger_points: null, cautions: null, notices: null })
  }
}
