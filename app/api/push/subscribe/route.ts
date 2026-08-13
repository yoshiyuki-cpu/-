import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const { workerId, subscription } = await req.json()
  if (!workerId || !subscription?.endpoint) {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 })
  }

  const { error } = await supabase.from('push_subscriptions').upsert({
    worker_id: workerId,
    endpoint: subscription.endpoint,
    p256dh: subscription.keys.p256dh,
    auth: subscription.keys.auth,
  }, { onConflict: 'endpoint' })

  if (error) {
    console.error('push subscribe failed:', error)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
