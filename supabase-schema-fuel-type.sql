-- 燃料代に種類（軽油／レギュラー）を追加。数量列(quantity)は既存のものをリットルとして流用する
alter table other_entries
  add column if not exists fuel_type text
  check (fuel_type in ('軽油', 'レギュラー'));
