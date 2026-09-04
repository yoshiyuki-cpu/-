'use client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readUser } from '@/lib/user'

// 操作の記録を1行残す。失敗しても本体の処理は止めない（記録のために業務を止めない）。
// テーブルがまだ無い環境では黙って何もしない。
export type AuditAction = 'trash' | 'restore' | 'purge' | 'complete' | 'reopen' | 'edit' | 'delete' | 'create'

export async function logAction(
  supabase: SupabaseClient,
  action: AuditAction,
  targetTable: string,
  targetId: number | null,
  summary: string,
) {
  const u = readUser()
  try {
    await supabase.from('audit_log').insert({
      actor_id: u?.id ?? null,
      actor_name: u?.name ?? null,
      action, target_table: targetTable, target_id: targetId, summary,
    })
  } catch { /* 記録できなくても業務は続ける */ }
}

// 操作した人の名前を一言に添える
export function withActor(text: string) {
  const u = readUser()
  return u ? `${text}（${u.name}）` : text
}
