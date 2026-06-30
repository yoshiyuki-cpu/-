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
            text: 'これはスクラップ業者の伝票です。以下の情報をJSON形式で抽出してください。{"items": [{"name": "品目名", "amount": 金額の数値}], "total": 合計金額の数値}。品目が複数ある場合はすべて含めてください。金額が読み取れない場合はnullにしてください。JSONのみ返してください。',
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
    return NextResponse.json({ items: [], total: null })
  }
}
