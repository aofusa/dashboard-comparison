# 3 実装 比較

`benchmarks/run-scenarios.sh` の同一シナリオで計測。未計測は `—`。仕様全文は `specs/*-v1.4.1.md` / `*-v1.5.2.md`（lowspec） / `*-v4.1.1.md` を参照。

## API ベンチマーク

```bash
python3 tools/generate-comparison-table.py
```

**注意**: タイミングは HTTP **2xx のみ**。`BASE_URL` は API が直接 2xx を返す向きに指定する。

| シナリオ | perf-qwik-rust | lowspec-qwik-rust | lean-next-hono |
|----------|------------------|-------------------|----------------|
| （上記コマンドで生成） | | | |

## サマリー（ブラウザ・主観）

| 項目 | perf-qwik-rust | lowspec-qwik-rust | lean-next-hono |
|------|----------------|-------------------|----------------|
| 初回ロード p95 (ms) | | | |
| 再アクセス p95 (ms) | | | |
| スループット | | | |
| メモリ (MB) | | | |
| 起動〜健全 OK (s) | | | |
| 開発生産性 (1–5) | | | |
| 運用保守性 (1–5) | | | |
| 外部依存 | | | |

## 結果ファイル

- `benchmarks/results/<実装>_<UTC>.json`
