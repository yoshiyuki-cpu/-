-- 燃料の基本単価（軽油／レギュラー）をマスタ管理できるようにする
-- 燃料代は日々変動するため、記録入力画面ではここで設定した単価を初期値として自動計算し、
-- 都度その場で上書きもできる運用とする
create table fuel_prices (
  id serial primary key,
  fuel_type text not null unique check (fuel_type in ('軽油', 'レギュラー')),
  unit_price numeric(10,2) not null,
  updated_at timestamptz default now()
);

insert into fuel_prices (fuel_type, unit_price) values
  ('軽油', 145),
  ('レギュラー', 165);
