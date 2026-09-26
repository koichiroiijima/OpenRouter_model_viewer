# ccr_test2 実装記録

OpenRouter モデル料金比較ページの実装メモ。次のセッションや別モデルが作業を再開するための引き継ぎ資料。

最終更新: 2026-09-27

## プロジェクト概要

- OpenRouter の公開 API（`GET https://openrouter.ai/api/v1/models`、CORS 有効。2026-09 時点で約 458 モデル）から料金と指標（Coding / Intelligence / Agent）を取得し、モデル一覧・比較・散布図を表示する静的 Web ページ。
- 純粋な HTML/CSS/JS のみ。ビルドステップ・Node 依存・テスティングフレームワークなし。
- **ページ読み込みごとに API を毎回取得**するため、データは常に最新（キャッシュなし）。
- 実行: `scripts/start.sh`（既定ポート **8001**）→ `http://localhost:8001`。停止は `scripts/stop.sh`。
  - ポートは環境変数 `PORT` で変更可能（例: `PORT=8000 scripts/start.sh`）。8000 番は別プロセスが占有していることがあるため既定は 8001。
  - スクリプトを使わず `python3 -m http.server 8001` を直接実行してもよい。
  - 変更が反映されない場合はブラウザのハードリロード（`Ctrl+Shift+R`）。過去にキャッシュ起因の問題が複数回発生。

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | ページ構造（2 ペイン + 散布図セクション） |
| `style.css` | スタイル（カラートークンは `:root` の CSS 変数に集約） |
| `app.js` | データ取得・正規化・検索・ソート・フィルタ・選択・比較レンダリング・散布図描画 |
| `scripts/start.sh` | 静的 HTTP サーバの起動（バックグラウンド）。PID を `.server.pid`、ログを `.server.log` に出力 |
| `scripts/stop.sh` | `start.sh` で起動したサーバの停止（`.server.pid` を使用） |

## 主要ロジック（app.js）

### データ取得と正規化 `normalize()`

- 料金は **USD / 100万トークン**（1 トークンあたり値 × `PER_MILLION` = 1,000,000）。
- 提供開始日は `created`（Unix秒）→ `released`。`fmtDate()` で日本語日付に整形。
- 指標は `benchmarks.artificial_analysis` の `coding_index` / `intelligence_index` / `agentic_index` → `coding` / `intelligence` / `agent`。欠如は `null` → 表では `—` 表示。
- 料金 0 以下は「データ無し」扱い（`fmtPrice()` / `fmtPriceNum()` が null を返す）。**スコアの 0 は実値として扱う**点に注意。

### 左ペイン（候補リスト / `renderCandidates()`）

- 検索（`visibleModels()`）+ ソート + 各行チェックボックス。
- **表示フィルタ（2026-08-23 追加）**: 検索ボックス下のチェックボックス 2 つ。
  - 「性能KPI有りのみ」(`#filter-kpi`) — Coding / Intelligence / Agent の 3 指標すべてを持つモデルのみ。
  - 「価格有りのみ」(`#filter-price`) — 入力・出力の両価格を持つモデルのみ。**キャッシュ価格は判定に使わない**。
  - フィルタ同士・検索クエリとは AND 条件。**左ペインの表示のみに影響**し、選択状態・比較表・散布図には影響しない。
- ソート: 共通比較関数 `compareBy(a, b, key, dir)`。デフォルトは `released` 降順。

### 右ペイン（比較表 / `renderCompare()`）

- 選択モデルを行、属性を列で表示。検索条件に関わらず選択中全モデルを表示。
- 各価格列で最安値を `best` クラスでハイライト（✓ 付き）。
- 列: モデル / 提供開始 / Coding / Intelligence / Agent / 入力 / 出力 / キャッシュ読込 / 説明。
- 独立したソート状態 `cmpKey`/`cmpDir`（初期 null → 選択順維持）。

### 散布図（2026-08-22〜23 実装 / `renderScatter()`）

- 選択モデルを X/Y 軸 2 指標で SVG 散布図にプロット。
- 軸選択は `METRICS` 定数（6 種類）:
  - スコア系: `coding` / `intelligence` / `agent` — 線形スケール
  - 料金系: `input` / `output` / `cache` — **対数スケール**（価格差が桁で離れるため）
- 対数軸の目盛りは桁ごとの 1・2・5（`logTicks()`）。値域が狭い場合（範囲比 ~1.02 倍未満の目盛りが出ない場合）は線形目盛り `tickValues()` にフォールバック。
- 軸ドメインは `niceDomain()`: min/max に 8% の余裕。min==max の場合は ±1 してから余裕を取る。
- プロット条件: 両軸の指標を持つモデルのみ。料金系は正の値のみ（0 以下は除外）。スコアの 0 は実値。
- 点にはモデル名ラベル（`shortLabel()` で 22 字に省略）とネイティブ `<title>` ツールチップ。
- 右上の注記 (`#scatter-note`) に「N モデルをプロット（指標が無いモデルは除外…」を表示。
- 再描画タイミング: 選択変更（チェックボックス / 比較表 × / クリア）・軸プルダウン変更。
- 描画領域は SVG `viewBox="0 0 760 460"`、パディング `{top:20, right:24, bottom:44, left:56}`。

### 選択状態

- `selectedModels`（`Set`、モデル `id` 管理）。チェックボックス / 比較表の `×` / 「選択をクリア」ボタンで操作。

## 運用上の注意

### ブラウザキャッシュ対策

`index.html` の CSS/JS 参照にキャッシュバースト用バージョンパラメータを付けている（現在 `?v=4`）:

```html
<link rel="stylesheet" href="style.css?v=4">
<script src="app.js?v=4"></script>
```

**JS/CSS を変更したら必ず v を上げること**（旧 JS ＋ 新 HTML の混在で「UI があるのに動かない」という障害が実際に起きた）。

### ポート

8000 番は他プロセスが占有していることがあるため、既定では **8001 番**を使用する（`scripts/start.sh` の既定値）。`PORT` 環境変数で変更可能。

### 起動・停止スクリプト

- `scripts/start.sh`: `nohup python3 -m http.server "$PORT"` をバックグラウンド起動。PID を `.server.pid`、ログを `.server.log` に保存。既に起動中ならそれを検知してスキップ。
- `scripts/stop.sh`: `.server.pid` の PID を停止（最大 2 秒待って残れば `kill -9`）。PID ファイルを削除。
- `.server.pid` / `.server.log`（`*.log`）は `.gitignore` 済み。

## 未完了・今後の候補

- （なし — 直近の機能追加はすべて実装済み。次の要望はユーザーから提示を待つ）

## Git 状態

- 2026-08-23 に `git init` 済み（ブランチ `master`）。初回コミット `753f904` に全実装（CLAUDE.md / app.js / index.html / style.css / docs/implementation.md）を含む。
- 2026-09-27: API 実データを確認（458 モデル・最新提供開始 2026-09-25）し、ドキュメントを現状に更新。`scripts/start.sh` / `scripts/stop.sh` を追加。
- リモートは未設定。push はユーザーに問い合わせること（CLAUDE.md 規約）。
