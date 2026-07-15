-- その他費用に「経費」区分を追加（廃材代・人工代・燃料代・リース代に加えて）
alter table other_entries drop constraint if exists other_entries_entry_type_check;
alter table other_entries add constraint other_entries_entry_type_check
  check (entry_type in ('labor', 'fuel', 'lease', 'expense'));

-- 実行予算にも経費の予算欄を追加
alter table projects add column if not exists budget_expense numeric(12,0);
