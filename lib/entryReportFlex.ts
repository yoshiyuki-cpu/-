import { projectUrl } from '@/lib/notify'
import { classify, SiteStatus } from '@/lib/siteStatus'

// 19:30の「現場の記入状況」を LINE の Flex Message にする。中身はメール版（buildEntryReportLines）と同じ。
// 記録なし・抜けがある現場には「記入する」ボタンを付け、押すとその現場の今日の記入画面が開く。
// 1通にまとめて送る（現場ごとに送ると通数を使い、通知も多すぎるため）。

const APP_URL = process.env.APP_URL || 'https://koji-daichou-zeta.vercel.app'
// Flex の1通には大きさの上限（約30KB）がある。現場が多い日は残りをアプリへ誘導する
const MAX_ROWS = 20
const SIZE_LIMIT = 28000

type FlexComponent = Record<string, unknown>

const mark = (b: boolean) => (b ? '○' : '×')

function detail(s: SiteStatus) {
  return `KY${mark(s.ky)} 議事録${mark(s.minutes)}${s.toolsRequired ? ` 道具${mark(s.tools)}` : ''} 人工${s.labor > 0 ? `${s.labor}名` : '×'} 処分${s.waste > 0 ? `${s.waste}件` : 'なし'}${s.other > 0 ? ` 経費${s.other}件` : ''}${s.unlocked ? '（社長が解除）' : ''}`
}

const text = (t: string, extra: FlexComponent = {}): FlexComponent => ({ type: 'text', text: t, wrap: true, size: 'sm', ...extra })

function section(title: string, color: string, rows: FlexComponent[]): FlexComponent {
  return { type: 'box', layout: 'vertical', spacing: 'sm', contents: [text(title, { weight: 'bold', color }), ...rows] }
}

// withDetail：内訳を出すか / withButton：「記入する」ボタンを付けるか
function siteRows(list: SiteStatus[], withDetail: boolean, withButton: boolean): FlexComponent[] {
  const shown = list.slice(0, MAX_ROWS)
  const rows: FlexComponent[] = shown.map(s => {
    const name = text(s.name, { weight: 'bold', flex: 1, gravity: 'center' })
    const head: FlexComponent = withButton
      ? { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [name, { type: 'button', style: 'secondary', height: 'sm', flex: 0, action: { type: 'uri', label: '記入する', uri: projectUrl('today', s.id) } }] }
      : name
    return { type: 'box', layout: 'vertical', contents: [head, ...(withDetail ? [text(detail(s), { size: 'xs', color: '#6b7280' })] : [])] }
  })
  if (list.length > shown.length) rows.push(text(`ほか：${list.slice(MAX_ROWS).map(s => s.name).join('、')}（アプリで確認してください）`, { size: 'xs', color: '#6b7280' }))
  return rows
}

export type FlexMessage = { type: 'flex'; altText: string; contents: FlexComponent }

export function buildEntryReportFlex(statuses: SiteStatus[], date: string, timeLabel: string, late: string[]): FlexMessage {
  const [y, m, d] = date.split('-').map(Number)
  const wd = '日月火水木金土'[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  const missing = statuses.filter(s => classify(s) === 'missing')
  const done = statuses.filter(s => classify(s) === 'done')
  const none = statuses.filter(s => classify(s) === 'none')

  const build = (withDoneDetail: boolean) => {
    const body: FlexComponent[] = []
    if (missing.length) body.push(section(`■ 抜けがある現場 ${missing.length}`, '#b91c1c', siteRows(missing, true, true)))
    if (none.length) body.push(section(`■ 今日の記録なし（休工？） ${none.length}`, '#b45309', siteRows(none, false, true)))
    if (done.length) body.push(section(`■ 記入済み ${done.length}`, '#047857', siteRows(done, withDoneDetail, false)))
    if (late.length) body.push(section(`■ 後入れ（前の日の入れ忘れ） ${late.length}`, '#4b5563', late.slice(0, MAX_ROWS).map(l => text(l, { size: 'xs', color: '#374151' }))))
    if (!statuses.length) body.push(text('進行中の現場がありません。'))
    body.push(text(`${timeLabel}時点の集計です。それより後の記入は入っていません。`, { size: 'xxs', color: '#9ca3af' }))
    return {
      type: 'bubble', size: 'giga',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#1e3a8a', contents: [
          text(`本日の記入状況（${timeLabel}時点）`, { color: '#ffffff', weight: 'bold', size: 'md' }),
          text(`${m}/${d}(${wd})`, { color: '#c7d2fe', size: 'xs' }),
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'lg', contents: body },
      footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'link', height: 'sm', action: { type: 'uri', label: 'アプリを開く', uri: APP_URL } }] },
    }
  }

  // 大きすぎるときは、記入済みの内訳を省いて1通に収める
  let contents: FlexComponent = build(true)
  if (JSON.stringify(contents).length > SIZE_LIMIT) contents = build(false)
  const altText = `📋 ${m}/${d}(${wd}) 現場の記入状況（${timeLabel}時点）抜け${missing.length}・記録なし${none.length}・記入済み${done.length}`
  return { type: 'flex', altText: altText.slice(0, 400), contents }
}
