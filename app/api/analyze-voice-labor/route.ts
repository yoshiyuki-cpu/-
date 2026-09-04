import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

type Worker = { id: number; name: string }

// 「横山と田中、全日。松尾は半日」のような文字起こしから、誰が全日／半日かを取り出す。
// 名前は音声認識で崩れる（横山→よこやま／横浜）ので、登録済みの作業員一覧を渡して
// その中から選ばせる。一覧に無い人は返さない（勝手に増やさない）。
// 結果は画面の選択に入れるだけで、保存は職長が確認して押す。
export async function POST(req: NextRequest) {
  const { text, workers } = await req.json() as { text?: string; workers?: Worker[] }
  if (!text || !workers || workers.length === 0) {
    return NextResponse.json({ entries: [], unmatched: [] })
  }

  const list = workers.map(w => `${w.id}: ${w.name}`).join('\n')
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: `これは解体工事の職長が「今日誰が働いたか（人工）」を音声で言った文字起こしです。音声認識特有の誤変換（名前の漢字違い・ひらがな・似た音）を文脈から補って、下の作業員一覧の中から該当する人を選び、それぞれ全日か半日かを判定してJSONで返してください。
「半日」「半分」「午前だけ」「午後だけ」「昼まで」などは half、何も言われなければ full です。
一覧に無い名前は entries に入れず unmatched に文字列で入れてください。
{"entries": [{"worker_id": 数値, "day_type": "full" または "half"}], "unmatched": ["一覧に無かった名前"]}
JSONのみ返してください。

作業員一覧：
${list}

文字起こし：
${text}`,
    }],
  })

  try {
    const raw = (message.content[0] as { text?: string }).text ?? ''
    const json = JSON.parse(raw.replace(/```json\n?|\n?```/g, '').trim())
    // 一覧に無いIDが混ざっても画面側で困らないよう、ここで落とす
    const ids = new Set(workers.map(w => w.id))
    const entries = (Array.isArray(json.entries) ? json.entries : [])
      .filter((e: { worker_id?: number; day_type?: string }) => typeof e.worker_id === 'number' && ids.has(e.worker_id))
      .map((e: { worker_id: number; day_type?: string }) => ({ worker_id: e.worker_id, day_type: e.day_type === 'half' ? 'half' : 'full' }))
    const unmatched = Array.isArray(json.unmatched) ? json.unmatched.filter((u: unknown) => typeof u === 'string') : []
    return NextResponse.json({ entries, unmatched })
  } catch {
    // 読み取れなくても画面は落とさない。職長が手で選べばよい
    return NextResponse.json({ entries: [], unmatched: [], failed: true })
  }
}
