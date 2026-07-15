-- 議事録に添付する「その日撮った写真」（複数枚・手書きメモ写真とは別の一般写真）
create table meeting_note_photos (
  id serial primary key,
  meeting_note_id integer references meeting_notes(id) on delete cascade,
  photo_url text not null,
  created_at timestamptz default now()
);
