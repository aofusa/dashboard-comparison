# lowspec-qwik-rust v1.5（要約・復元用）

## 目的

低スペック単一端末向け。**SQLite（メタ・アプリデータ）**、**埋め込み DuckDB（分析）**、プロセス内 **moka** キャッシュで外部サービスなし運用を目指す。

## API

perf 版と同一の REST/GraphQL シナリオに揃え、`benchmarks/run-scenarios.sh` がそのまま使えること。

## フロント

Qwik City + **Qwik UI Styled Kit**（Park UI / Ark UI / Panda CSS は仕様上採用しない。本復元では最小ルートのみでも可）。

## バックエンド

単一 Rust バイナリ、`BIND_ADDR` で待受。DuckDB はオプション（未使用でもビルド可能な構成にできる）。
