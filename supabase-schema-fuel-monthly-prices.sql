-- 燃料の単価を月ごとに持つ（2026-11 社長の依頼）。
-- 燃料はガソリンカードで入れていてレシートに金額が出ないため、月初に「11月度　レギュラー○円・軽油○円」を入れておき、
-- 給油量（リットル）× 給油した月の単価で燃料代を出す。手入力の燃料代と、燃料カードのグループの写真の両方で使う。
-- その月の単価が無いときは、それより前の月の単価、それも無ければ fuel_prices（基本単価）を使う。
-- month は 'YYYY-MM'（例 2026-11）。過去の燃料代の記録は書き換えない。
create table if not exists fuel_monthly_prices (
  id serial primary key,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  fuel_type text not null check (fuel_type in ('軽油', 'レギュラー')),
  unit_price numeric(10,2) not null check (unit_price > 0),
  updated_at timestamptz default now(),
  unique (month, fuel_type)
);
