-- 出面の残業代（2026-10 社長の依頼）。
--
-- 作業員ごと・日ごとに1つの残業代（円）を持つ。1日に2つの現場へ行った人でも残業代は1つなので、
-- 現場ごとの人工の記録（labor_entries）ではなく、別の表にした。
-- 出面の画面で入れて、月の合計（給料の計算用）に出す。現場の原価（人工費）にも、その日に入っていた現場へ人工の割合で振り分けて入れる（lib/overtime.ts）。
-- 作業員を消しても記録は残す（on delete set null）。同じ人・同じ日は1行（入れ直すと上書き）。
create table if not exists labor_overtime (
  id serial primary key,
  worker_id integer references workers(id) on delete set null,
  date date not null,
  amount numeric(10,0) not null default 0,  -- 残業代（円）
  note text,                                -- 「2時間」「解体延長」など
  created_by text,                          -- 入れた人（端末で選んだ名前）
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (worker_id, date)
);
create index if not exists labor_overtime_date_idx on labor_overtime (date);
