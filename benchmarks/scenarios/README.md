# ベンチマークシナリオ

実装は `../run-scenarios.sh` に集約。Rust 系と lean で次のパスを揃えています。

| シナリオ | メソッド・パス | 備考 |
|----------|----------------|------|
| health | `GET /api/health` | 全実装 |
| login | `POST /api/auth/login` | Rust 系 |
| items | `GET /api/items?page=1&pageSize=10` + Bearer | Rust 系 |
| GraphQL | `POST /api/graphql` | Rust 系（health / nested items+user） |
| version | `GET /api/version` | lean のみ |

計測は HTTP **2xx のみ**（`../lib/bench-lib.sh`）。
