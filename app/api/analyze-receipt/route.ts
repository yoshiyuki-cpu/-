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
            text: 'このレシートの合計金額を数字のみで答えてください。例：3850。税込合計金額が読み取れない場合は「不明」と答えてください。',
          },
        ],
      },
    ],
  })

  const text = (message.content[0] as any).text.trim()
  const amount = parseInt(text.replace(/[^0-9]/g, ''), 10)

  return NextResponse.json({ amount: isNaN(amount) ? null : amount, raw: text })
}
