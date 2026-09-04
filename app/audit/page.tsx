'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Row = {
  id: number; actor_name: string | null; action: string
  target_table: string; target_id: number | null; summary: string | null; created_at: string
}

const ACTION_LABEL: Record<string, string> = {
  trash: 'ごみ箱', restore: '戻す', purge: '完全削除', complete: '完了', reopen: '進行中に', edit: '修正', delete: '削除', create: '追加',
}
const ACTION_STYLE: Record<string, string> = {
  trash: 'bg-amber-100 text-amber-800', restore: 'bg-emerald-100 text-emerald-700', purge: 'bg-red-100 text-red-700',
  complete: 'bg-blue-100 text-blue-700', reopen: 'bg-gray-100 text-gray-600', edit: 'bg-gray-100 text-gray-600',
  delete: 'bg-red-100 text-red-700', create: 'bg-gray-100 text-gray-600',
}

function when(ts: string) {
  const d = new Date(ts)
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

// 誰が何をしたかの一覧。社長が「これ誰が消した？」を調べる場所
export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200)
      .then(({ data, error }) => {
        if (error) setMissing(true)
        setRows((data ?? []) as Row[])
        setLoading(false)
      })
  }, [])

  return (
    <div>
      <h1 className="text-xl font-bold mb-1">操作の記録</h1>
      <p className="text-xs text-gray-500 mb-4">
        ごみ箱・完了・記録の修正や削除を、誰がいつ行ったか。上の帯で選んだ名前が残ります。
      </p>
      {missing && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-4">
          <p className="text-sm text-amber-800">操作の記録の準備がまだです。</p>
          <p className="text-xs text-amber-700 mt-0.5">Supabaseで <span className="font-mono">supabase-schema-audit-log.sql</span> を実行すると残り始めます。</p>
        </div>
      )}
      {loading && <p className="text-center py-10 text-gray-500">読み込み中...</p>}
      {!loading && !missing && rows.length === 0 && <p className="text-center py-10 text-gray-400 text-sm">まだ記録はありません。</p>}
      <div className="flex flex-col gap-1.5">
        {rows.map(r => (
          <div key={r.id} className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2.5">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${ACTION_STYLE[r.action] ?? 'bg-gray-100 text-gray-600'}`}>
                {ACTION_LABEL[r.action] ?? r.action}
              </span>
              <span className="text-sm font-medium">{r.actor_name ?? <span className="text-gray-400">名前なし</span>}</span>
              <span className="ml-auto text-[11px] text-gray-400">{when(r.created_at)}</span>
            </div>
            <p className="text-sm text-gray-700">{r.summary}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
