-- 議事録に、手書きメモを撮影した写真のURLを保存できるようにする
alter table meeting_notes add column if not exists photo_url text;
