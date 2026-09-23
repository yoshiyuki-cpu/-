import type { SupabaseClient } from '@supabase/supabase-js'
import { TOOLS_START } from '@/lib/morningGate'

// 現場ごとの「今日の記入状況」。19:30の報告（サーバー）と「今日」の画面（端末）の両方で使う。
// ここにはメール・LINE の送信部品を入れない（端末側でも読み込むため）。

export type SiteStatus = {
  id: number
  name: string
  ky: boolean
  minutes: boolean
  tools: boolean         // 朝の道具の確認
  toolsRequired: boolean // 道具の確認を求める日か（表が無い環境・始まる前は false）
  labor: number     // 人数
  waste: number     // 件数
  other: number     // 件数
  unlocked: boolean // 社長が合言葉で解除した
}

export async function collectSiteStatus(supabase: SupabaseClient, date: string): Promise<SiteStatus[]> {
  const [{ data: pj }, { data: ky }, { data: mn }, { data: lb }, { data: ws }, { data: ot }, { data: un }, tc] = await Promise.all([
    supabase.from('projects').select('*').order('name'),
    supabase.from('ky_photos').select('project_id').eq('date', date),
    supabase.from('meeting_notes').select('project_id').eq('date', date),
    supabase.from('labor_entries').select('project_id, worker_id').eq('date', date),
    supabase.from('waste_entries').select('project_id').eq('date', date),
    supabase.from('other_entries').select('project_id').eq('date', date),
    supabase.from('app_settings').select('key').like('key', `morning_gate_unlock:%:${date}`),
    supabase.from('tool_checks').select('project_id').eq('date', date),
  ])
  const toolsRequired = date >= TOOLS_START && !tc.error
  const ids = (rows: unknown[] | null) => (rows ?? []).map(r => (r as { project_id: number }).project_id)
  const count = (list: number[], id: number) => list.filter(x => x === id).length
  const kyIds = ids(ky), mnIds = ids(mn), wsIds = ids(ws), otIds = ids(ot), tcIds = ids(tc.data ?? [])
  const unlockedIds = (un ?? []).map(r => Number(String((r as { key: string }).key).split(':')[1]))
  // 進行中の現場だけ（ごみ箱・完了は除く。deleted_at は列が無い環境もあるので JS 側で見る）
  const active = (pj ?? []).filter((p: { status?: string; deleted_at?: string | null }) => p.status === 'active' && !p.deleted_at)
  return active.map((p: { id: number; name: string }) => ({
    id: p.id,
    name: p.name,
    ky: kyIds.includes(p.id),
    minutes: mnIds.includes(p.id),
    tools: tcIds.includes(p.id),
    toolsRequired,
    labor: new Set((lb ?? []).filter((r: { project_id: number }) => r.project_id === p.id).map((r: { worker_id: number }) => r.worker_id)).size,
    waste: count(wsIds, p.id),
    other: count(otIds, p.id),
    unlocked: unlockedIds.includes(p.id),
  }))
}

// 記入済み：KY活動・議事録・（求める日は）道具の確認・人工がそろっている（処分代は毎日出るとは限らないので条件にしない）
// 記録なし：何ひとつ入っていない（休工の日もある）
// 抜けあり：それ以外
export function classify(s: SiteStatus): 'done' | 'missing' | 'none' {
  const any = s.ky || s.minutes || s.tools || s.labor > 0 || s.waste > 0 || s.other > 0
  if (!any) return 'none'
  if (s.ky && s.minutes && (s.tools || !s.toolsRequired) && s.labor > 0) return 'done'
  return 'missing'
}

