import type { SupabaseClient } from '@supabase/supabase-js'

// 朝の KY活動・議事録・道具の確認が済むまで、その現場のその日の人工・処分代（廃材）を入力させない仕組み。
// 入力画面・LINE報告の Webhook・LINE報告の画面の3か所から同じ判定を使う。
//
// ・この日より前の日付は止めない（始める前の記録の後入れを止めないため）
// ・回線の都合などで確認できなかったときは止めない（圏外で人工が入れられなくなるのを避ける）
// ・社長が合言葉で解除した日は止めない（雨で KY が撮れなかった、などの例外用）
export const GATE_START = '2026-09-24'
// 道具の確認は1日遅れて始める（表を作る SQL を実行してから）。表がまだ無い環境では求めない
export const TOOLS_START = '2026-09-25'

export const gateUnlockKey = (projectId: number, date: string) => `morning_gate_unlock:${projectId}:${date}`

export type GateState = {
  date: string
  ky: boolean
  minutes: boolean
  tools: boolean
  toolsRequired: boolean
  unlockedBy: string | null
  exempt: boolean   // 始める前の日付
  unknown: boolean  // 確認できなかった
}

export async function loadGate(supabase: SupabaseClient, projectId: number, date: string): Promise<GateState> {
  const base: GateState = { date, ky: false, minutes: false, tools: false, toolsRequired: false, unlockedBy: null, exempt: false, unknown: false }
  if (!date || date < GATE_START) return { ...base, exempt: true }
  try {
    const [ky, mn, un, tc] = await Promise.all([
      supabase.from('ky_photos').select('id').eq('project_id', projectId).eq('date', date).limit(1),
      supabase.from('meeting_notes').select('id').eq('project_id', projectId).eq('date', date).limit(1),
      supabase.from('app_settings').select('value').eq('key', gateUnlockKey(projectId, date)).limit(1),
      supabase.from('tool_checks').select('id').eq('project_id', projectId).eq('date', date).limit(1),
    ])
    if (ky.error || mn.error) return { ...base, unknown: true }
    // 道具の確認の表が無い（SQL 未実行）ときは、道具の確認を求めない
    const toolsRequired = date >= TOOLS_START && !tc.error
    return {
      ...base,
      ky: (ky.data ?? []).length > 0,
      minutes: (mn.data ?? []).length > 0,
      tools: (tc.data ?? []).length > 0,
      toolsRequired,
      unlockedBy: (un.data?.[0] as { value?: string } | undefined)?.value ?? null,
    }
  } catch {
    return { ...base, unknown: true }
  }
}

export function gateOpen(g: GateState) {
  return g.exempt || g.unknown || !!g.unlockedBy || (g.ky && g.minutes && (g.tools || !g.toolsRequired))
}

// 足りないものを「KY活動・議事録」のように並べる
export function gateMissing(g: GateState) {
  return [!g.ky && 'KY活動', !g.minutes && '議事録', g.toolsRequired && !g.tools && '道具の確認'].filter(Boolean).join('・')
}
