// 「出面　経費確認」のグループの書き込みを読む部品（2026-11 社長の依頼）。DBにもLINEにも触らない。
// 1日1現場のまとめが、ほぼ同じ形で書き込まれるので、AIを使わずに読む。
//
//   11月9日　西山　元請建設          ← 日付・現場（元請名つき）
//   山田、川上、鈴木さん              ← その日に出た人
//   3人工　計20.5人工                 ← その日の人工と、現場の累計
//   2トン自社1台　計7.5台             ← 車両ごとの台数と累計（0台の行もある）
//   4トンリース 1台　計3.5台
//   処分A　廃材                      ← 廃材（台帳には入れず、マニフェストとの照合だけに使う）
//   2680キロ
//
// scripts/check-demen-parse.mjs で検算できる。

export type DemenVehicle = { text: string; category: 'owned' | 'rental' | null; count: number; total: number | null }
export type DemenWaste = { disposalText: string; typeText: string; quantity: number | null; unit: string | null; amount: number | null }

export type DemenText = {
  date: string
  siteText: string
  names: string[]
  labor: number | null       // その日の人工
  laborTotal: number | null  // 現場の累計人工
  vehicles: DemenVehicle[]
  waste: DemenWaste[]
}

const toHalf = (s: string) => s.replace(/[０-９．，]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, ' ')
const num = (s: string) => Number(s.replace(/,/g, ''))

function resolveDate(month: number, day: number, today: string) {
  const [ty] = today.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  let date = `${ty}-${pad(month)}-${pad(day)}`
  if (date > today) date = `${ty - 1}-${pad(month)}-${pad(day)}`
  return date
}

const QTY = /([\d,]*\.?\d+)\s*(kg|ｋｇ|キロ|t|ｔ|トン|㎥|m3|立米)(?![a-zA-Zァ-ン])/i
const unitOf = (u: string) => (/^(kg|ｋｇ|キロ)$/i.test(u) ? 'kg' : /^(t|ｔ|トン)$/i.test(u) ? 't' : '㎥')

// まとめの形でなければ null（雑談・連絡など）
export function parseDemenText(raw: string, today: string): DemenText | null {
  const lines = toHalf(raw).split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (lines.length < 3) return null
  const dm = lines[0].match(/(\d{1,2})\s*[月/／]\s*(\d{1,2})\s*日?/)
  if (!dm) return null
  const month = Number(dm[1]), day = Number(dm[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const siteText = lines[0].slice((dm.index ?? 0) + dm[0].length).replace(/^\s*[(（][^)）]*[)）]/, '').trim()
  if (!siteText) return null

  const out: DemenText = { date: resolveDate(month, day, today), siteText, names: [], labor: null, laborTotal: null, vehicles: [], waste: [] }
  let currentWaste: { disposalText: string; typeText: string } | null = null

  for (const line of lines.slice(1)) {
    // 人工の行：「4人工　計28.5人工」
    const lab = line.match(/^([\d.]+)\s*人工/)
    if (lab) {
      out.labor = num(lab[1])
      const tot = line.match(/計\s*([\d.]+)\s*人工/)
      out.laborTotal = tot ? num(tot[1]) : null
      currentWaste = null
      continue
    }
    // 車両の行：「2トン自社1台　計7.5台」「PC35　1台　計2.5台」
    const veh = line.match(/^(.+?)\s*([\d.]+)\s*台(?:\s*計\s*([\d.]+)\s*台)?\s*$/)
    if (veh) {
      const text = veh[1].trim()
      out.vehicles.push({
        text: text.replace(/(自社|リース)/g, '').trim(),
        category: /リース/.test(text) ? 'rental' : /自社/.test(text) ? 'owned' : null,
        count: num(veh[2]), total: veh[3] ? num(veh[3]) : null,
      })
      currentWaste = null
      continue
    }
    // 廃材の量・金額の行（直前の「処分場　種類」に付く）
    const yen = line.match(/([\d,]+)\s*円/)
    const q = line.match(QTY)
    if ((yen || q) && currentWaste) {
      out.waste.push({ ...currentWaste, quantity: q ? num(q[1]) : null, unit: q ? unitOf(q[2]) : null, amount: yen ? num(yen[1]) : null })
      continue
    }
    // 名前の行：人工の行より前で、数字を含まない
    if (out.labor === null && !/\d/.test(line)) {
      out.names.push(...line.split(/[、,，・\s]+/).map(s => s.trim()).filter(Boolean))
      continue
    }
    // 「処分場　種類」の行：人工の行より後で、数字を含まない2語以上
    const w = line.split(/\s+/).filter(Boolean)
    if (out.labor !== null && !/\d/.test(line) && w.length >= 2) {
      currentWaste = { disposalText: w[0], typeText: w.slice(1).join(' ') }
      continue
    }
    // それ以外の見出し（「スクラップ」など1語の行）のあとの金額は、廃材に付けない
    currentWaste = null
  }
  if (out.labor === null && !out.vehicles.length) return null
  return out
}

// ---- アプリの登録と突き合わせる ----

export type DemenWorker = { id: number; name: string }
export type DemenVehicleRow = { id: number; name: string; category: string | null; default_price: number | null }

const squash = (s: string) => toHalf(s).replace(/[\s　]/g, '').replace(/(さん|君|くん|ちゃん)$/, '').toLowerCase()

// 書き込みの名前（名字だけ・あだ名）から作業員の候補を出す。1人なら決まり、0人なら未登録
export function matchWorker(text: string, workers: DemenWorker[]): DemenWorker[] {
  const s = squash(text)
  if (!s) return []
  const exact = workers.filter(w => squash(w.name) === s || w.name === text)
  if (exact.length) return exact
  return workers.filter(w => squash(w.name).startsWith(s))
}

// 「2トン」→「2t」のように車両の名前をそろえる
const vehicleKey = (s: string) => toHalf(s).replace(/トン/g, 't').replace(/[\s　]/g, '').toLowerCase()

// 「自社」「リース」が書かれていればその区分、無ければ自社を優先する
export function matchVehicle(v: DemenVehicle, vehicles: DemenVehicleRow[]): DemenVehicleRow | null {
  const same = vehicles.filter(x => vehicleKey(x.name) === vehicleKey(v.text))
  if (!same.length) return null
  const want = v.category ?? 'owned'
  return [...same].sort((a, b) => Number(b.category === want) - Number(a.category === want) || a.id - b.id)[0]
}

// 書き込みの廃材の名前を、よくある書き方の違いだけ読み替える（ハイプラ → 廃プラ）
export function normalizeWasteName(s: string) {
  return toHalf(s).replace(/^ハイプラ/, '廃プラ').replace(/^はいぷら/, '廃プラ').replace(/[\s　]/g, '')
}
