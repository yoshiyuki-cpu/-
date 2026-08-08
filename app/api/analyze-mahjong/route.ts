import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export async function POST(req: NextRequest) {
  const { imageBase64, mediaType } = await req.json()

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-5',
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
              text: 'これは麻雀の手牌の写真です。写っている牌を左から右の順にすべて読み取り、mpsz形式でJSONのみ返してください。{"tiles": ["1m", "2p", "3s", "1z", ...]}。表記: 萬子=1m〜9m、筒子=1p〜9p、索子=1s〜9s、字牌=東1z 南2z 西3z 北4z 白5z 發6z 中7z、赤5は0m/0p/0s。横向きの牌や副露も含めてください。牌がはっきり判別できない場合や麻雀牌の写真でない場合は {"tiles": []} を返してください。JSONのみ返してください。',
            },
          ],
        },
      ],
    })

    const block = message.content[0]
    const text = block.type === 'text' ? block.text.trim() : ''
    const json = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim())
    const tiles = Array.isArray(json.tiles) ? json.tiles.filter((t: unknown) => typeof t === 'string') : []
    return NextResponse.json({ tiles })
  } catch {
    return NextResponse.json({ tiles: [], error: '画像の解析に失敗しました' }, { status: 500 })
  }
}
