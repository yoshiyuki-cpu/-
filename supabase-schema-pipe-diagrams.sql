-- 管路図（各現場の埋設管の図面・写真）。
--
-- 解体では水道・ガス・下水・電気の位置を事前に押さえておかないと切ってしまうため、
-- 現場ごとに図面の写真を残せるようにする。役所や施主からもらった図面を撮った写真、
-- スマホに送られてきた画像、現場で書いた手書きの図、どれも同じように貼れる形にした。
--
-- 種別（水道・ガスなど）は種類が増えたり現場によって呼び方が違うので、
-- 決まった選択肢にせず自由入力の note で持つ。
create table if not exists pipe_diagrams (
  id serial primary key,
  -- 現場を消したら図面も一緒に消えてよい（他の現場では使えないため）
  project_id integer references projects(id) on delete cascade,
  -- 図面を受け取った日・撮った日
  date date not null,
  photo_url text not null,
  -- 「水道」「ガス」「下水」「電気」など。空欄可
  note text,
  created_at timestamptz default now()
);

-- 現場ごとに新しいものから並べて出すので、その順を速くする
create index if not exists pipe_diagrams_project_idx on pipe_diagrams (project_id, date desc);
