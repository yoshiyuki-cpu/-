import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isGoogleCalendarConfigured, insertEvent, deleteEvent, listUpcoming } from '@/lib/googleCalendar'

const TYPE_LABELS: Record<string, string> = {
  construction_start: '着工', night_shift: '夜勤', estimate: '見積り', other: 'その他',
}

// GET: 接続確認（通知設定画面のテストボタン）
export async function GET() {
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ ok: false, configured: false, message: 'GOOGLE_SERVICE_ACCOUNT_JSON と GOOGLE_CALENDAR_ID が設定されていません' })
  }
  try {
    const items = await listUpcoming(5)
    return NextResponse.json({ ok: true, configured: true, items })
  } catch (e) {
    return NextResponse.json({ ok: false, configured: true, message: e instanceof Error ? e.message : 'failed' })
  }
}

// POST: アプリの予定を Google カレンダーに写す／消す。
// 共有カレンダー画面の追加・削除から呼ばれる。失敗してもアプリ側の予定は残す。
export async function POST(req: NextRequest) {
  const { action, eventId } = await req.json()
  if (!eventId || (action !== 'create' && action !== 'delete')) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }
  if (!isGoogleCalendarConfigured()) {
    return NextResponse.json({ ok: true, synced: false, reason: 'not_configured' })
  }

  const { data: ev } = await supabase.from('calendar_events').select('*').eq('id', eventId).maybeSingle()
  if (!ev) return NextResponse.json({ ok: true, synced: false, reason: 'event_not_found' })

  try {
    if (action === 'create') {
      const label = TYPE_LABELS[ev.event_type] ?? 'その他'
      const created = await insertEvent({
        title: `【${label}】${ev.title}`,
        date: ev.event_date,
        description: [ev.note, '（良心アプリから登録）'].filter(Boolean).join('\n'),
      })
      // google_event_id は追加したばかりの列。SQL未実行なら保存だけ失敗するが、
      // Google側には入っているので同期そのものは成功として返す
      const { error } = await supabase.from('calendar_events')
        .update({ google_event_id: created.id }).eq('id', eventId)
      return NextResponse.json({ ok: true, synced: true, googleEventId: created.id, saved: !error, link: created.htmlLink })
    }

    // delete。google_event_id は追加したばかりの列なので、無い環境では undefined になるだけ
    const gid = (ev as { google_event_id?: string | null }).google_event_id
    if (!gid) return NextResponse.json({ ok: true, synced: false, reason: 'no_google_event' })
    await deleteEvent(gid)
    return NextResponse.json({ ok: true, synced: true })
  } catch (e) {
    return NextResponse.json({ ok: false, synced: false, message: e instanceof Error ? e.message : 'failed' })
  }
}
