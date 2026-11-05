// 売上と請求書のデータの出し入れ。画面と定期実行はここだけを通す。
// 【今の状態】社長の指示で機能を先に作っているので、他の画面と同じくanonキーで直接読み書きする。
// セキュリティを組むときは、この関数の中身をサーバーのAPI呼び出しへ差し替える。
import { supabase } from '@/lib/supabase'
import { calcTotals, defaultInvoiceDates, InvoiceTotals, LineType } from '@/lib/billingCalc'

export type BillingRole = 'view' | 'edit' | 'confirm'

export type BillingClient = {
  id: number
  name: string
  postal_code: string | null
  address: string | null
  honorific: string
  payment_note: string | null
  active: boolean
}

export type BillingSettings = {
  id: number
  issuer_name: string | null
  postal_code: string | null
  address: string | null
  office_name: string | null
  tel: string | null
  invoice_registration_no: string | null
  bank_name: string | null
  bank_branch: string | null
  account_type: string | null
  account_number: string | null
  stamp_data: string | null
}

export type BillingMember = {
  id: number
  worker_id: number | null
  name: string
  role: BillingRole
  passcode_hash: string | null
  email: string | null
  active: boolean
}

export type BillingEntry = {
  id: number
  project_id: number | null
  client_id: number | null
  billing_month: string | null
  line_type: LineType
  item_name: string
  quantity: number
  unit: string
  unit_price: number | null
  amount: number
  note: string | null
  created_by: string | null
  deleted_at: string | null
  created_at: string
}

export type EntryInput = Pick<BillingEntry,
  'project_id' | 'client_id' | 'billing_month' | 'line_type' | 'item_name' | 'quantity' | 'unit' | 'unit_price' | 'amount' | 'note'>

export type InvoiceSnapshot = {
  client: { name: string; postal_code: string | null; address: string | null; honorific: string }
  settings: BillingSettings | null
  lines: BillingEntry[]
  totals: InvoiceTotals
}

export type BillingInvoice = {
  id: number
  client_id: number | null
  billing_month: string
  invoice_no: string
  issue_date: string
  due_date: string
  note: string | null
  status: 'draft' | 'confirmed'
  snapshot: InvoiceSnapshot | null
  confirmed_by: string | null
  confirmed_at: string | null
}

// テーブルがまだ無い（SQL未実行の）ときの失敗かどうか
export function isNotReady(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /billing_\w+/.test(error.message ?? '') && /does not exist|schema cache/.test(error.message ?? '')
}

export const NOT_READY_MESSAGE = '売上の準備がまだです。Supabaseで supabase-schema-billing.sql を実行してください。'

function fail(error: { code?: string; message?: string }, fallback: string): never {
  throw new Error(isNotReady(error) ? NOT_READY_MESSAGE : fallback)
}

// ---- 権限まわり ----
export async function fetchMembers() {
  const { data, error } = await supabase.from('billing_members').select('*').order('id')
  if (error) fail(error, '名前の一覧を読み込めませんでした。もう一度開き直してください。')
  return (data ?? []) as BillingMember[]
}

export async function saveMember(id: number | null, values: Partial<BillingMember>) {
  const { error } = id
    ? await supabase.from('billing_members').update(values).eq('id', id)
    : await supabase.from('billing_members').insert(values)
  if (error) fail(error, '保存できませんでした。もう一度お試しください。')
}

// ---- 元請 ----
export async function fetchClients() {
  const { data, error } = await supabase.from('billing_clients').select('*').order('name')
  if (error) fail(error, '元請を読み込めませんでした。もう一度開き直してください。')
  return (data ?? []) as BillingClient[]
}

export async function saveClient(id: number | null, values: Partial<BillingClient>) {
  const { error } = id
    ? await supabase.from('billing_clients').update(values).eq('id', id)
    : await supabase.from('billing_clients').insert(values)
  if (error) fail(error, '元請を保存できませんでした。もう一度お試しください。')
}

// ---- 発行者の情報 ----
export async function fetchSettings() {
  const { data, error } = await supabase.from('billing_settings').select('*').eq('id', 1).maybeSingle()
  if (error) fail(error, '請求書の設定を読み込めませんでした。もう一度開き直してください。')
  return (data ?? null) as BillingSettings | null
}

export async function saveSettings(values: Partial<BillingSettings>) {
  const { error } = await supabase.from('billing_settings')
    .upsert({ ...values, id: 1, updated_at: new Date().toISOString() })
  if (error) fail(error, '請求書の設定を保存できませんでした。もう一度お試しください。')
}

// ---- 売上 ----
export async function fetchEntries() {
  const { data, error } = await supabase.from('billing_entries').select('*')
    .is('deleted_at', null).order('created_at', { ascending: false })
  if (error) fail(error, '売上を読み込めませんでした。もう一度開き直してください。')
  return (data ?? []) as BillingEntry[]
}

async function assertNotConfirmed(clientId: number | null, month: string | null) {
  if (!clientId || !month) return
  const { data, error } = await supabase.from('billing_invoices').select('status')
    .eq('client_id', clientId).eq('billing_month', month).limit(1)
  if (error) fail(error, '確認できませんでした。もう一度お試しください。')
  if (data?.[0]?.status === 'confirmed') {
    const [y, m] = month.split('-').map(Number)
    throw new Error(`${y}年${m}月の請求書は確定済みです。確定を解除してから直してください。`)
  }
}

// 確定済みの請求書に関わる売上は、移す元も移す先も動かさない
export async function saveEntry(previous: BillingEntry | null, values: EntryInput, actor: string) {
  if (previous) await assertNotConfirmed(previous.client_id, previous.billing_month)
  await assertNotConfirmed(values.client_id, values.billing_month)
  const { error } = previous
    ? await supabase.from('billing_entries').update({ ...values, updated_at: new Date().toISOString() }).eq('id', previous.id)
    : await supabase.from('billing_entries').insert({ ...values, created_by: actor })
  if (error) fail(error, '売上を保存できませんでした。もう一度お試しください。')
}

export async function deleteEntry(entry: BillingEntry) {
  await assertNotConfirmed(entry.client_id, entry.billing_month)
  const { error } = await supabase.from('billing_entries')
    .update({ deleted_at: new Date().toISOString() }).eq('id', entry.id)
  if (error) fail(error, '売上を消せませんでした。もう一度お試しください。')
}

// ---- 請求書 ----
export async function fetchInvoices(month?: string) {
  let q = supabase.from('billing_invoices').select('*').order('billing_month', { ascending: false })
  if (month) q = q.eq('billing_month', month)
  const { data, error } = await q
  if (error) fail(error, '請求書を読み込めませんでした。もう一度開き直してください。')
  return (data ?? []) as BillingInvoice[]
}

export async function fetchInvoice(id: number) {
  const { data, error } = await supabase.from('billing_invoices').select('*').eq('id', id).maybeSingle()
  if (error) fail(error, '請求書を読み込めませんでした。もう一度開き直してください。')
  return (data ?? null) as BillingInvoice | null
}

export async function updateInvoice(id: number, values: Partial<BillingInvoice>) {
  const { error } = await supabase.from('billing_invoices')
    .update({ ...values, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) fail(error, '請求書を保存できませんでした。もう一度お試しください。')
}

export function sortInvoiceLines(lines: BillingEntry[]) {
  // 見本は工事代金が上、常用工事が下。同じ区分は入力順
  const order = (l: BillingEntry) => (l.line_type === 'construction' ? 0 : 1)
  return [...lines].sort((a, b) => order(a) - order(b) || a.created_at.localeCompare(b.created_at) || a.id - b.id)
}

export async function fetchInvoiceLines(clientId: number, month: string) {
  const { data, error } = await supabase.from('billing_entries').select('*')
    .eq('client_id', clientId).eq('billing_month', month).is('deleted_at', null)
  if (error) fail(error, '明細を読み込めませんでした。もう一度開き直してください。')
  return sortInvoiceLines((data ?? []) as BillingEntry[])
}

export async function confirmInvoice(invoice: BillingInvoice, client: BillingClient, actor: string) {
  const [lines, settings] = await Promise.all([fetchInvoiceLines(client.id, invoice.billing_month), fetchSettings()])
  if (lines.length === 0) throw new Error('明細が1行もないので確定できません。')
  const snapshot: InvoiceSnapshot = {
    client: { name: client.name, postal_code: client.postal_code, address: client.address, honorific: client.honorific },
    settings, lines, totals: calcTotals(lines),
  }
  await updateInvoice(invoice.id, { status: 'confirmed', snapshot, confirmed_by: actor, confirmed_at: new Date().toISOString() })
}

export async function unlockInvoice(id: number) {
  await updateInvoice(id, { status: 'draft', snapshot: null, confirmed_by: null, confirmed_at: null })
}

// 指定の月の売上から、まだ無い請求書の下書きを作る。何度呼んでも増えず、
// 直した内容や確定済みの請求書は上書きしない（unique と ignoreDuplicates に任せる）
export async function createDraftsForMonth(month: string) {
  const { data, error } = await supabase.from('billing_entries').select('client_id')
    .eq('billing_month', month).is('deleted_at', null)
  if (error) fail(error, '売上を読み込めませんでした。')
  const clientIds = [...new Set((data ?? []).map(r => r.client_id as number | null).filter((v): v is number => !!v))]
  if (clientIds.length === 0) return { created: 0, clients: 0 }
  const { data: existing, error: e2 } = await supabase.from('billing_invoices').select('client_id').eq('billing_month', month)
  if (e2) fail(e2, '請求書を読み込めませんでした。')
  const have = new Set((existing ?? []).map(r => r.client_id))
  const missing = clientIds.filter(id => !have.has(id))
  if (missing.length > 0) {
    const dates = defaultInvoiceDates(month)
    const rows = missing.map(client_id => ({ client_id, billing_month: month, ...dates }))
    const { error: e3 } = await supabase.from('billing_invoices')
      .upsert(rows, { onConflict: 'client_id,billing_month', ignoreDuplicates: true })
    if (e3) fail(e3, '請求書の下書きを作れませんでした。')
  }
  return { created: missing.length, clients: clientIds.length }
}

// 請求月か元請が決まっていない売上の件数。請求書に載らないので通知で知らせる
export async function countUnassigned() {
  const { data, error } = await supabase.from('billing_entries').select('client_id, billing_month').is('deleted_at', null)
  if (error) fail(error, '売上を読み込めませんでした。')
  return (data ?? []).filter(r => !r.client_id || !r.billing_month).length
}
