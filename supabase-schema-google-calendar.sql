-- Google カレンダー連携。アプリの予定を Google 側に写したとき、その予定のIDを控える。
--
-- アプリで予定を消したときに Google 側も消すために必要。
-- 空欄なら「Google には写していない」という意味（連携の設定前に作った予定など）。
alter table calendar_events add column if not exists google_event_id text;
