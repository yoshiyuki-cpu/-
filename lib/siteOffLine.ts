import type { SupabaseClient } from '@supabase/supabase-js'
import type { LineMessage } from '@/lib/manifestLine'
import { OWNER_LINE_USER_ID_KEY } from '@/lib/entryReport'
import { parseOffText, setSiteOff, loadOffIds, OffSite } from '@/lib/siteOff'

// 公式LINEの1対1のトークで「休工」と送られたときと、休工のボタン（19:30の報告・ここでの返事）。
//   「今日は○○と○○以外は休工」→ その2現場以外の進行中の現場を、今日の休工にしてよいかボタンで確かめてから付ける
//   「明日 ○○ 休工」→ 明日の印。「全部休工」→ 全部の現場
//   現場名が無い「休工」だけ → 現場のボタンで聞く（1つずつ）
// 現場名は書き違いがある（似た字の取り違えなど）ので、文から付けるときは必ず確かめる。
// 印を付けられるのは、社長と、LINE を連携した作業員だけ。返事は reply（通数を使わない）。

const text = (t: string, quickReply?: LineMessage): LineMessage => (quickReply ? { type: 'text', text: t, quickReply } : { type: 'text', text: t })
const label = (s: string) => (s.length > 20 ? s.slice(0, 19) + '…' : s)
const postback = (l: string, data: string, displayText: string) => ({ type: 'action', action: { type: 'postback', label: label(l), data, displayText: displayText.slice(0, 300) } })

function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number)
  return `${m}/${d}（${'日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`
}
const isDate = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)

// 社長か連携済みの作業員なら名前を返す。知らない人なら null
async function whoIs(supabase: SupabaseClient, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  const { data: owner } = await supabase.from('app_settings').select('value').eq('key', OWNER_LINE_USER_ID_KEY).maybeSingle()
  if (owner?.value && owner.value === userId) return '社長'
  const { data: w } = await supabase.from('workers').select('name').eq('line_user_id', userId).limit(1)
  return (w?.[0] as { name: string } | undefined)?.name ?? null
}

async function activeSites(supabase: SupabaseClient): Promise<OffSite[]> {
  const { data } = await supabase.from('projects').select('*').order('name')
  return ((data ?? []) as { id: number; name: string; status?: string; deleted_at?: string | null }[])
    .filter(p => p.status === 'active' && !p.deleted_at).map(p => ({ id: p.id, name: p.name }))
}

// 現場を選ぶボタン（まだ休工でない現場、12個まで）
function pickButtons(sites: OffSite[], offIds: Set<number>, date: string) {
  return sites.filter(s => !offIds.has(s.id)).slice(0, 12)
    .map(s => postback(s.name, `action=site_off&project_id=${s.id}&date=${date}&off=1`, `${s.name}は休工`))
}

export async function handleOffText(supabase: SupabaseClient, input: { text: string; userId: string | null; today: string; tomorrow: string }): Promise<LineMessage[] | null> {
  const sites = await activeSites(supabase)
  const parsed = parseOffText(input.text, sites)
  if (!parsed) return null
  const who = await whoIs(supabase, input.userId)
  if (!who) return [text('休工の印は、アプリと LINE を連携した人だけが付けられます。')]
  const date = parsed.day === 'tomorrow' ? input.tomorrow : input.today

  if (!parsed.named) {
    const offIds = await loadOffIds(supabase, date)
    const items = pickButtons(sites, offIds, date)
    if (!items.length) return [text(`${dayLabel(date)}は、進行中の現場がすべて休工になっています。`)]
    return [text(`${dayLabel(date)}に休工にする現場を、下のボタンで選んでください（1つずつ）。\n「北町と南市場以外は休工」のように現場名を書いても付けられます。`, { items })]
  }

  if (!parsed.ids.length) return [text(`${dayLabel(date)}に休工にする現場がありませんでした（全部の現場が「以外」に入っています）。`)]
  // 現場名の書き違い（似た字の取り違えなど）で、動く現場まで休工にしないよう、付ける前に必ず確かめる
  const off = sites.filter(s => parsed.ids.includes(s.id))
  const working = sites.filter(s => !parsed.ids.includes(s.id))
  const lines = [
    `${dayLabel(date)}は、次の現場を休工にしますか？`,
    `休工：${off.map(s => s.name).join('、')}`,
    `動く：${working.length ? working.map(s => s.name).join('、') : 'なし'}`,
    '違っていたら「やめる」を押して、現場名をアプリの表記どおりに書き直してください。',
  ]
  return [text(lines.join('\n'), { items: [
    postback('この内容で休工にする', `action=site_off_set&date=${date}&ids=${off.map(s => s.id).join(',')}`, 'この内容で休工にする'),
    postback('やめる', 'action=site_off_cancel', 'やめる'),
  ] })]
}

export async function handleOffPostback(supabase: SupabaseClient, params: URLSearchParams, userId: string | null): Promise<LineMessage[] | null> {
  const action = params.get('action')
  if (action === 'site_off_cancel') return [text('休工の印は付けませんでした。')]
  if (action !== 'site_off' && action !== 'site_off_undo' && action !== 'site_off_set') return null
  const date = params.get('date')
  if (!isDate(date)) return null
  const who = await whoIs(supabase, userId)
  if (!who) return [text('休工の印は、アプリと LINE を連携した人だけが付けられます。')]
  const sites = await activeSites(supabase)
  const ids = (params.get('ids') ?? '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50)
  const nameOf = (id: number) => sites.find(s => s.id === id)?.name ?? `#${id}`

  if (action === 'site_off_undo') {
    for (const id of ids) await setSiteOff(supabase, id, date, false, who)
    return [text(`${dayLabel(date)}の休工を取り消しました：${ids.map(nameOf).join('、')}`)]
  }

  // 確かめたうえで、まとめて休工にする
  if (action === 'site_off_set') {
    const done: number[] = []
    for (const id of ids) {
      if (sites.some(s => s.id === id) && await setSiteOff(supabase, id, date, true, who)) done.push(id)
    }
    if (!done.length) return [text('休工の印を付けられませんでした。アプリの「今日」の画面から付けてください。')]
    return [text(`${dayLabel(date)}を休工にしました（${done.length}現場）\n${done.map(nameOf).join('、')}\nこの現場は、その日の朝・夕方のお知らせから外れ、19:30の報告では「休工」に並びます。`, {
      items: [postback('全部取り消す', `action=site_off_undo&date=${date}&ids=${done.join(',')}`, '休工を取り消す')],
    })]
  }

  const projectId = Number(params.get('project_id'))
  const site = sites.find(s => s.id === projectId)
  if (!site) return [text('その現場は進行中ではないので、休工の印を付けませんでした。')]
  if (!await setSiteOff(supabase, projectId, date, true, who)) return [text('休工の印を付けられませんでした。アプリの「今日」の画面から付けてください。')]
  const offIds = await loadOffIds(supabase, date)
  const items = [
    postback('取り消す', `action=site_off_undo&date=${date}&ids=${projectId}`, `${site.name}の休工を取り消す`),
    ...pickButtons(sites, offIds, date).slice(0, 11),
  ]
  return [text(`${site.name}を${dayLabel(date)}の休工にしました。\nほかにも休工の現場があれば、続けて選んでください。`, { items })]
}
