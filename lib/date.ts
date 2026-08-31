// 日本の「今日」を YYYY-MM-DD で返す。
//
// new Date().toISOString() は UTC を返すため、日本時間の朝9時前に使うと前日になる。
// 職長の入力は7時50分の通知で始まるので、まさにその時間帯に当たっていた。
// 実際に議事録・KY写真・人工・車両代・廃材が前日の日付で保存されていた（給料と原価に直結する）。
//
// 端末のタイムゾーン設定に左右されないよう、UTCからの加算ではなく Asia/Tokyo で組み立てる。
export function jstToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

// 日本の今日から days 日ずらした日付。days が負なら過去。
export function jstDateOffset(days: number, now = new Date()) {
  const [y, m, d] = jstToday(now).split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + days))
  return shifted.toISOString().split('T')[0]
}
