-- 利用状況のAI分析結果を保存する（手動ボタン・毎日の自動実行の両方から書き込む）
-- 利用状況ページはここから最新1件を読み込んで表示することで、
-- 毎回AIに問い合わせなくても直近の分析結果をすぐ表示できるようにする
create table usage_analyses (
  id serial primary key,
  analysis text not null,
  stats jsonb,
  created_at timestamptz default now()
);
