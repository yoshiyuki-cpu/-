# Obsidian と Claude の連携ガイド

- 作成日: 2026-08-22
- 対象: 工事台帳アプリの開発・運用でのメモ / 設計書 / 現場記録の管理
- ステータス: 手順書（Phase 1 未着手）

## 1. Obsidian とは（3行で）

- 実体は「Markdown（`.md`）ファイルが入ったただのフォルダ」を開くノートアプリ。このフォルダを **Vault（保管庫）** と呼ぶ
- ノート同士を `[[リンク]]` でつなげられ、全文検索・タグ・バックリンクが使える
- データが独自形式ではなく素のテキストなので、**Claude がそのまま読み書きできる**（これが Notion との決定的な違い）

## 2. なぜこの構成を選ぶか

Obsidian の Vault を GitHub リポジトリにすると、ノートが「Git で同期される Markdown 置き場」になる。すると:

| できること | 効果 |
|---|---|
| クラウド上の Claude がノートを直接読み書き | PC を開いていなくても、議事録の要約や仕様の整理を任せられる |
| iPhone / PC の Obsidian で同じノートを閲覧・編集 | 現場でメモ → 事務所で清書、が同じファイルで完結 |
| 変更履歴が Git に残る | 「いつ誰が何を決めたか」が後から追える |

MCP サーバー方式（Claude Desktop から Vault を読む）は PC が起点になるため、クラウドの Claude からは届かない。Obsidian プラグインを自作する方式は保守コストが高い。まずはこの Git 方式が最小コストで効果が大きい。

## 3. セットアップ手順

### Phase 1: Vault を作って GitHub に載せる

1. **Obsidian をインストール**（PC）— https://obsidian.md からダウンロード
2. **新しい Vault を作成** — 名前は `ryoshin-notes` など。保存場所はホームフォルダ直下が扱いやすい
3. **GitHub に空のプライベートリポジトリを作成** — 名前は Vault と揃えて `ryoshin-notes`
4. **Vault フォルダを Git リポジトリにする**（PC のターミナルで、Vault フォルダに移動してから）

   ```bash
   git init
   git add -A
   git commit -m "Obsidian Vault の初期化"
   git branch -M main
   git remote add origin https://github.com/yoshiyuki-cpu/ryoshin-notes.git
   git push -u origin main
   ```

5. **Obsidian Git プラグインを入れる** — Obsidian の 設定 → コミュニティプラグイン → 制限モードをオフ → 「Obsidian Git」を検索してインストール・有効化
6. **自動同期を設定** — プラグイン設定で以下を指定する
   - `Vault backup interval (minutes)`: `10`（10分ごとに自動コミット・プッシュ）
   - `Auto pull on startup`: オン（起動時に他端末の変更を取り込む）

### Phase 2: スマホからも使う

- iPhone / iPad の App Store から Obsidian を入れる
- 同じ Vault を使うには、iCloud Drive 経由の同期か、モバイル版 Obsidian Git（要追加設定）のどちらかを選ぶ
- 現場でのメモ取りが主目的なら、まずは iCloud 同期で十分。Git は PC 側だけで回す運用でも成立する

### Phase 3: Claude に触らせる

Vault リポジトリを Claude Code のセッションに追加すれば、そのまま読み書きできる。頼み方の例:

- 「`現場/佐藤様邸.md` の議事録から、次回までのToDoだけ抜き出して同じノートの末尾に追記して」
- 「`現場/` 配下のノートを全部読んで、今月よく出てくる問題点をまとめたノートを作って」
- 「`docs/scaffold-spec.md` の内容を、Vault の `仕様/足場計算.md` に現場向けの言葉で書き直して」

## 4. Vault の初期フォルダ構成案

工事台帳アプリの現状（現場・見積・足場・議事録）に合わせた構成:

```
ryoshin-notes/
├── 現場/                  # 現場ごとに1ノート（工事台帳の projects と対応）
│   └── 佐藤様邸.md
├── 議事録/                # 日付ごと。現場ノートへ [[佐藤様邸]] でリンクする
│   └── 2026-08-22 定例.md
├── 仕様/                  # アプリの設計メモ。docs/ の設計書と行き来する
│   └── 足場計算.md
├── 単価・相場/            # 単管・足場材・燃料の相場メモ
└── 日誌/                  # デイリーノート（その日の気づき）
```

ノートの先頭にフロントマターを書いておくと、後から Claude が機械的に扱いやすい:

```markdown
---
現場名: 佐藤様邸
着工日: 2026-09-01
担当: 山田
状態: 進行中
---

# 佐藤様邸

## 議事録
- [[2026-08-22 定例]]
```

## 5. 次のステップ（Phase 4 / 未着手）

Vault が動き出したら、工事台帳アプリ側から Obsidian 用の Markdown を書き出す機能を足すと、二重入力がなくなる。

- 対象: `app/projects/[id]/minutes`（議事録）、`app/projects/[id]/scaffold`（足場拾い出し結果）、見積
- 形式: 上記フロントマター付きの `.md` をダウンロード、または Vault リポジトリへ直接コミット
- 着手時はこのドキュメントの構成案をノートのテンプレートとして使う
