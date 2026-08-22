# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 表示言語について（重要）

このページの表示テキスト（UI 文言・ラベル・メッセージ）は**日本語**を使用すること。

**中国語を表示に使わないこと。** コメントや説明文などの表示テキストも日本語で書くこと。

コード識別子（変数名・関数名など）やコメント自体は日本語・英語のどちらでもよいが、ユーザー画面に表示される文字列は必ず日本語にすること。

## プロジェクト概要

OpenRouter の公開 API（`GET https://openrouter.ai/api/v1/models`、CORS 有効）から最新のモデル料金と指標（Coding / Intelligence / Agent）を取得し、モデル一覧と選択モデルの比較を表示する静的 Web ページ。

- 純粋な HTML/CSS/JS のみ。ビルドステップや Node 依存なし。
- 実行・確認: `python3 -m http.server 8000` → `http://localhost:8000`
  - 変更が反映されない場合はブラウザの**ハードリロード**（`Ctrl+Shift+R`）を案内する（過去にキャッシュ起因の問題があった）。

## 構成

- `index.html` — ページ構造（2ペイン: 左=候補リスト / 右=比較表）。テーブル列は `data-key` で app.js のソートキーと対応。
- `style.css` — 2ペイン・テーブル・レスポンシブのスタイル。最大幅はブラウザの **85%**。
- `app.js` — データ取得・正規化・検索・ソート・選択・比較レンダリング（すべてここに集約）。

## 主要ロジック

### データ取得と正規化（app.js `normalize()`）
- `GET https://openrouter.ai/api/v1/models` を直接 fetch（CORS 有効、約337モデル）。
- 各モデルをフラットなオブジェクトに正規化。主なフィールド:
  - 料金は **USD / 100万トークン**（`pricing.prompt` 等の1トークンあたり値を ×1,000,000）。
  - 提供開始日は `created`（Unix秒）→ `released`。`fmtDate()` で日本語の日付（`2026/08/02`）に整形。
  - **Coding / Intelligence / Agent 指標**は `benchmarks.artificial_analysis` の `coding_index` / `intelligence_index` / `agentic_index` を `coding` / `intelligence` / `agent` として保持。値なし（フィールド欠如）は `null` にし、`—` 表示（`fmtScore()` は「小数1桁」、`0` は明示的な実値として表示）。
- データは全部で3ファイルのみ。ビルド・依存・テスティングフレームワークなし。

### 表示（2ペイン）
- **左ペイン（候補リスト / `renderCandidates()`）**: 全モデル。検索（`visibleModels()`）+ ソート + 各行にチェックボックス。
- **右ペイン（比較表 / `renderCompare()`）**: 選択モデルをモデルが行・属性が列で表示。各価格列で最安値を `best` クラスでハイライト。検索条件に関わらず選択中全モデルを表示。
- 比較表の列: モデル / 提供開始 / Coding / Intelligence / Agent / 入力 / 出力 / キャッシュ読込 / 説明（プロバイダ・コンテキストは比較表に**ない**）。

### ソート
- 共通比較関数 `compareBy(a, b, key, dir)`。テキスト列（name/provider/description）は文字列比較、それ以外（数値・日付）は数値比較。
- **左ペイン**: `sortKey`/`sortDir`。デフォルトは `released` 降順（新しいモデルが上）。
- **右ペイン**: 独立した `cmpKey`/`cmpDir`（初期は未指定 → 選択順維持）。クリックで昇順⇄降順トグル。

### 選択状態
- `selectedModels`（`Set`、モデル `id` で管理）。チェックボックス / 比較表の `×` / クリアボタンで操作。
