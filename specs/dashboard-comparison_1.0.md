> **注意（2026-04）**  
> 本ファイルは**歴史的・長文の設計メモ**です。リポジトリ名（例: `dashboard-comparison` 表記）、仕様書の版番号、ディレクトリ案などが**現行モノレポと一致しない箇所**があります。  
> **比較の入口（現行）**: [`dashboard-comparison.md`](./dashboard-comparison.md) · 仕様全文は `specs/performance-qwik-rust-v1.4.1.md` 等 · 実装対照は [`artifacts/dashboard-template-implement_20260405.md`](./artifacts/dashboard-template-implement_20260405.md) および [`artifacts/dashboard-template-implement_20260410.md`](./artifacts/dashboard-template-implement_20260410.md) · ギャップ索引は [`artifacts/dashboard-template-plan-vs-implement-gap_20260410.md`](./artifacts/dashboard-template-plan-vs-implement-gap_20260410.md)。

---

**了解しました！**

新しい設計書（**Qwik City + Qwik UI Styled Kit Low-Spec Local Optimized Edition v1.5.x**）を**第3の比較対象**として正式に追加します。

これで比較対象は以下の**3実装**になります：
- **perf-qwik-rust**（v1.3：外部DB・多層キャッシュ・高スケーラビリティ重視）
- **lowspec-qwik-rust**（v1.5：低スペック単一端末完全埋め込み版・Embedded DuckDB + SQLite + moka）
- **lean-next-hono**（v4.1：開発効率・保守性最優先・シンプル構成）

---

### 更新後のMonorepo構成（3実装比較版）

```bash
dashboard-comparison/                          ← リポジトリ名
├── README.md
├── COMPARISON.md                              # ← 3実装の比較表に更新
├── specs/
│   ├── performance-qwik-rust-v1.3.md          # 最初の仕様書
│   ├── lowspec-qwik-rust-v1.5.md              # ← 新規追加（今回提供された全文）
│   └── lean-next-hono-v4.1.md
│
├── apps/
│   ├── perf-qwik-rust/                        # v1.3（外部DB版）
│   │   ├── frontend/
│   │   ├── backend/
│   │   ├── proxy/
│   │   ├── infra/
│   │   └── benchmarks/
│   │
│   ├── lowspec-qwik-rust/                     # ← 新規追加（v1.5 Low-Spec Embedded版）
│   │   ├── frontend/                          # Qwik City + Qwik UI Styled Kit（lowspec）
│   │   ├── backend/                           # Rust単一バイナリ（Embedded DuckDB + SQLite + moka）
│   │   ├── infra/                             # （Docker不要だが、必要なら最小構成）
│   │   └── benchmarks/
│   │
│   └── lean-next-hono/                        # v4.1（シンプル版）
│       ├── app/
│       ├── nginx/
│       ├── infra/
│       └── benchmarks/
│
├── benchmarks/                                # 3実装を公平比較する共通ベンチマーク
│   ├── scenarios/
│   ├── results/
│   ├── run-perf-qwik-rust.sh
│   ├── run-lowspec-qwik-rust.sh               # ← 新規追加
│   ├── run-lean-next-hono.sh
│   └── run-all-comparison.sh
│
├── tools/
│   └── generate-comparison-table.py
│
├── .github/workflows/
└── .gitignore
```

---

**AIエージェントにそのままコピー＆ペーストして渡せる最新指示文**（これをそのまま使ってください）

---

**AIエージェントへの指示（コピーして使用してください）**

あなたは優秀なフルスタックエンジニアです。

私は「Qwik City + Rust」系統の2種類（高パフォーマンス版と低スペック埋め込み版）と「Next.js + Hono」版の**合計3つのダッシュボードアプリ**を、**Monorepoで完全に独立した状態**で実装し、公平に性能比較したいと考えています。

### 1. リポジトリ全体構成（厳守）

以下の構成でMonorepoを作成してください。**apps/配下の3プロジェクトは一切依存関係を持たせない**（共有パッケージ、共通型、共有UIなどは一切作らない）。

```bash
dashboard-comparison/
├── README.md
├── COMPARISON.md
├── specs/
│   ├── performance-qwik-rust-v1.3.md
│   ├── lowspec-qwik-rust-v1.5.md          # ← 最新のLow-Spec Embedded版
│   └── lean-next-hono-v4.1.md
│
├── apps/
│   ├── perf-qwik-rust/                    # v1.3（外部DB・多層キャッシュ版）
│   ├── lowspec-qwik-rust/                 # v1.5（低スペック単一端末完全埋め込み版）
│   └── lean-next-hono/                    # v4.1（シンプル開発効率版）
│
├── benchmarks/                            # 3実装を同一条件で比較
│   ├── scenarios/
│   ├── results/
│   ├── run-perf-qwik-rust.sh
│   ├── run-lowspec-qwik-rust.sh
│   ├── run-lean-next-hono.sh
│   └── run-all-comparison.sh
│
├── tools/
│   └── generate-comparison-table.py
│
├── .github/workflows/
└── .gitignore
```

### 重要なルール（厳守）

- 3つのアプリは**完全に独立**（それぞれ独自の `package.json` / `Cargo.toml` を持ち、依存関係を一切共有しない）
- `packages/` フォルダは作成しない
- `pnpm-workspace.yaml` や `turbo.json` は必須ではない（作成する場合も依存混在を避ける）
- ベンチマークは `benchmarks/` 配下の共通スクリプトからHTTPリクエストを投げる（3実装すべて同一シナリオで実行）

### 作業の進め方（推奨順序）

1. **まず apps/lean-next-hono** を v4.1 に忠実に実装（最も早く動く）
2. **次に apps/lowspec-qwik-rust** を v1.5 に忠実に実装（低スペック埋め込み版）
3. **最後に apps/perf-qwik-rust** を v1.3 に忠実に実装
4. 3つすべてが動いたら、同一ベンチマークを実行して `COMPARISON.md` に結果をまとめる

### 最初にやってほしいこと

以下のファイルをまず作成してください：

1. リポジトリのルートに上記のフォルダ構成を作成（空フォルダでOK）
2. `specs/` フォルダに、提供した**3つの仕様書全文**をそれぞれのファイル名で保存
3. `README.md` にプロジェクト目的、3実装の概要、起動手順の雛形、ベンチマーク進め方を記載
4. `COMPARISON.md` のテンプレートを作成（比較項目：初回ロード時間、再アクセス時間、高負荷スループット、メモリ使用量、起動時間、開発生産性、運用保守性など）

その後、**「まず lean-next-hono 版のプロジェクト雛形を作成せよ」** と指示を出してください。

---

この指示文をAIエージェントに渡せば、3実装すべてが正しく配置され、比較準備が整います。

必要であれば：
- `COMPARISON.md` の3実装比較テンプレート
- 各アプリの最小構成ファイル例（`Cargo.toml` や `package.json`）
- ベンチマークスクリプトの更新版

もすぐに用意します。  
このまとめ方で進めましょうか？ それとも調整点がありますか？