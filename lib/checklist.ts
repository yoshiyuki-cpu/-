import { SupabaseClient } from '@supabase/supabase-js'

// 着工前の確認項目。増やすときはここに足す（DBの変更は要らない）
export const CHECK_ITEMS = [
  { key: 'pipes', label: '管路図を確認した', hint: '水道・ガス・下水・電気の位置。管路図の画面に貼ってあるか' },
  { key: 'manifest', label: 'マニフェストを準備した', hint: '産廃の処分先と伝票' },
  { key: 'neighbors', label: '近隣あいさつをした', hint: '両隣・向かい・裏。工期と連絡先を伝える' },
  { key: 'ky', label: 'KY活動をした', hint: '着工日の朝。KY用紙を撮って登録する' },
] as const

export type CheckKey = typeof CHECK_ITEMS[number]['key']

export type ProjectCheck = {
  id: number
  project_id: number
  key: string
  done_at: string | null
  done_by: number | null
  note: string | null
}

export type ChecklistState = {
  checks: Record<string, ProjectCheck>
  // テーブルがまだ無い環境。画面では案内だけ出して、他の機能は普通に動かす
  missingTable: boolean
  pipeCount: number
  kyCount: number
}

export async function loadChecklist(supabase: SupabaseClient, projectId: number): Promise<ChecklistState> {
  const [{ data, error }, pipes, ky] = await Promise.all([
    supabase.from('project_checks').select('*').eq('project_id', projectId),
    supabase.from('pipe_diagrams').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
    supabase.from('ky_photos').select('id', { count: 'exact', head: true }).eq('project_id', projectId),
  ])
  const checks: Record<string, ProjectCheck> = {}
  ;((data ?? []) as ProjectCheck[]).forEach(c => { checks[c.key] = c })
  return {
    checks,
    missingTable: !!error,
    pipeCount: pipes.count ?? 0,
    kyCount: ky.count ?? 0,
  }
}

export function undoneItems(state: ChecklistState) {
  return CHECK_ITEMS.filter(i => !state.checks[i.key]?.done_at)
}
