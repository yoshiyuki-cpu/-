import type { SupabaseClient } from '@supabase/supabase-js'

// 現場の「休工」の印（2026-11 社長の依頼）。現場を空ける日に「今日の現場」のボタンか、
// 公式LINEに「休工」と送って印を付けると、その日はその現場について
//   ・朝7:50（議事録・KY活動）と夕方17:30（台帳の記入）の職長へのお知らせを送らない
//   ・19:30の記入状況では「記録なし」ではなく「休工」に並べる
// 記録は既存の app_settings に site_off:<現場ID>:<日付> で入れる（新しい表は作らない。値は付けた人の名前）。
// 端末とサーバーの両方で読み込むので、ここには送信の部品を入れない。

export const offKey = (projectId: number, date: string) => `site_off:${projectId}:${date}`

// その日に休工の印がある現場ID
export async function loadOffIds(supabase: SupabaseClient, date: string): Promise<Set<number>> {
  const { data, error } = await supabase.from('app_settings').select('key').like('key', `site_off:%:${date}`)
  if (error) return new Set()
  return new Set((data ?? []).map(r => Number(String((r as { key: string }).key).split(':')[1])).filter(n => Number.isFinite(n)))
}

export async function setSiteOff(supabase: SupabaseClient, projectId: number, date: string, off: boolean, by: string | null): Promise<boolean> {
  const key = offKey(projectId, date)
  const { error } = off
    ? await supabase.from('app_settings').upsert({ key, value: by ?? '', updated_at: new Date().toISOString() }, { onConflict: 'key' })
    : await supabase.from('app_settings').delete().eq('key', key)
  return !error
}

// ---- 公式LINEの「休工」の文を読む（DBには触らない） ----

export type OffSite = { id: number; name: string }

// 現場名の呼び名。「西山　元請建設」→「西山」のように、元請名などの前の部分
export function siteShortName(name: string) {
  return name.replace(/[（(].*$/, '').trim().split(/[\s　]+/)[0] || name
}

// 「休工」「明日休工」「今日は北町と南市場以外は休工」などを読む。休工の文でなければ null
// names が空なら、どの現場かはボタンで聞く
export function parseOffText(raw: string, sites: OffSite[]): { day: 'today' | 'tomorrow'; ids: number[]; except: boolean; named: boolean } | null {
  const t = raw.replace(/\s+/g, '')
  // 「休み」は作業員の休みの報告と紛れるので、「休工」だけを見る
  if (!t.includes('休工') || t.length > 120) return null
  if (/取消|取り消/.test(t)) return null
  const day = /明日|あした|あす/.test(t) ? 'tomorrow' : 'today'
  const hits = sites.filter(s => {
    const short = siteShortName(s.name).replace(/\s/g, '')
    return (short.length >= 2 && t.includes(short)) || t.includes(s.name.replace(/\s/g, ''))
  })
  const except = /以外|のほか|の他/.test(t)
  if (!hits.length) {
    if (/全部|全て|すべて|全現場/.test(t)) return { day, ids: sites.map(s => s.id), except: false, named: true }
    return { day, ids: [], except: false, named: false }
  }
  const ids = except ? sites.filter(s => !hits.includes(s)).map(s => s.id) : hits.map(s => s.id)
  return { day, ids, except, named: true }
}
