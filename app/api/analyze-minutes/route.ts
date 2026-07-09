import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { imageBase64, mediaType } = await req.json()

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: imageBase64 },
          },
          {
            type: 'text',
            text: 'これは工事現場の議事録（危険箇所・注意事項・伝達事項）の手書きメモです。以下の情報をJSON形式で抽出してください。{"danger_points": "危険箇所の内容", "cautions": "注意事項の内容", "notices": "伝達事項の内容"}。読み取れない項目や書かれていない項目はnullにしてください。JSONのみ返してください。',
          },
        ],
      },
    ],
  })

  try {
    const text = (message.content[0] as any).text.trim()
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
    return NextResponse.json(json)
  } catch {
    return NextResponse.json({ danger_points: null, cautions: null, notices: null })
  }
}
