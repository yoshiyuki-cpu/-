-- 振り返りを「失敗だけ」から「良かったこと・悪かったこと」に広げ、日付ごとに残せるようにする。
--
-- テーブル名は failure_notes のままにしている。名前は実態と合わなくなるが、
-- 名前を変えると過去の記録との紐付けを触ることになり、得より危険が大きいため。
-- 中身は「振り返り（良い・悪い両方）」として扱う。

-- 'good' = 良かったこと / 'bad' = 悪かったこと。
-- 既存の行はすべて失敗の記録なので 'bad' が既定値でよい
alter table failure_notes add column if not exists kind text not null default 'bad';

alter table failure_notes drop constraint if exists failure_notes_kind_check;
alter table failure_notes add constraint failure_notes_kind_check check (kind in ('good', 'bad'));

-- その日その日で振り返れるようにする。month だけでは日が分からない
alter table failure_notes add column if not exists date date;

-- 日付が無い既存の行にだけ、その月の1日を入れる。行は消さない・増やさない
update failure_notes set date = (month || '-01')::date where date is null;

-- 月の分を日付順に引くのが主な使い方
create index if not exists failure_notes_month_date_idx on failure_notes (month, date desc);
