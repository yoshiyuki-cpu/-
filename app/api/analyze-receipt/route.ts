import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { imageBase64, mediaType } = await req.json()

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
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
            text: 'これはガソリンスタンドのレシートです。以下の情報をJSON形式で抽出してください。{"amount": 税込合計金額の数値, "liters": 給油量（リットル）の数値, "fuel_type": "軽油"または"レギュラー"（レシートの油種名から判断。軽油以外のガソリン類（レギュラー・ハイオク等）はすべて"レギュラー"として扱う。判断できない場合はnull）}。読み取れない項目はnullにしてください。JSONのみ返してください。',
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
    return NextResponse.json({ amount: null, liters: null, fuel_type: null })
  }
}
