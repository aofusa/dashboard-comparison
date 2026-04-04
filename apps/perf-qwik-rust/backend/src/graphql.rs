use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::extensions::apollo_persisted_queries::{ApolloPersistedQueries, LruCacheStorage};
use async_graphql::{
    Context, EmptySubscription, ErrorExtensions, InputValueError, InputValueResult, Object, Scalar,
    ScalarType, Schema, SimpleObject, Value,
};
use async_graphql::{Error as GqlError, Result as GqlResult};
use sqlx::mysql::MySql;
use sqlx::MySqlPool;
use sqlx::QueryBuilder;

use tower_sessions::Session;

use crate::auth_flow::LoginError;
use crate::config::Config;
use crate::content_repository::{ContentRepository, ItemRow};
use crate::refresh_repo;

#[derive(Clone, Default)]
pub struct BearerToken(pub Option<String>);

#[derive(Clone, Debug)]
pub struct UserId(pub String);

#[derive(Clone)]
pub struct GraphqlExtras {
    pub pool: MySqlPool,
    pub jwt_secret: String,
    pub jwt_access_secs: u64,
    pub jwt_refresh_days: u64,
}

#[derive(SimpleObject, Clone)]
pub struct GqlUser {
    pub email: String,
}

pub struct GqlItem {
    pub id: String,
    pub title: String,
    pub user_id: String,
    pub updated_at: Option<String>,
}

fn gql_item(user_id: &str, row: ItemRow) -> GqlItem {
    let updated_at = if row.updated_at.is_empty() {
        None
    } else {
        Some(row.updated_at)
    };
    GqlItem {
        id: row.id,
        title: row.title,
        user_id: user_id.to_string(),
        updated_at,
    }
}

#[Object]
impl GqlItem {
    async fn id(&self) -> &str {
        &self.id
    }
    async fn title(&self) -> &str {
        &self.title
    }
    #[graphql(name = "updatedAt")]
    async fn updated_at_camel(&self) -> Option<&str> {
        self.updated_at.as_deref()
    }
    async fn user(&self, ctx: &Context<'_>) -> GqlResult<GqlUser> {
        let loader = ctx.data::<DataLoader<EmailLoader>>()?;
        let email = loader
            .load_one(self.user_id.clone())
            .await?
            .ok_or_else(|| GqlError::new("user not found"))?;
        Ok(GqlUser { email })
    }
}

#[derive(SimpleObject)]
pub struct ItemsConnection {
    pub total: i32,
    pub items: Vec<GqlItem>,
}

#[derive(SimpleObject)]
pub struct ItemsSliceConnection {
    pub items: Vec<GqlItem>,
}

#[derive(SimpleObject, Clone)]
pub struct ByInitialEntry {
    pub letter: String,
    pub count: i32,
}

#[derive(SimpleObject, Clone)]
pub struct ItemStatsPayload {
    pub total: i32,
    #[graphql(name = "byInitial")]
    pub by_initial: Vec<ByInitialEntry>,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ArrowIPCZstdScalar;

#[Scalar(name = "ArrowIPCZstd")]
impl ScalarType for ArrowIPCZstdScalar {
    fn parse(_value: Value) -> InputValueResult<Self> {
        Err(InputValueError::custom(
            "ArrowIPCZstd is only available via binary HTTP response",
        ))
    }

    fn to_value(&self) -> Value {
        Value::Null
    }
}

#[derive(SimpleObject, Clone)]
pub struct AuthPayload {
    pub token: String,
    #[graphql(name = "refreshToken")]
    pub refresh_token: String,
    #[graphql(name = "expiresIn")]
    pub expires_in: i64,
}

#[derive(SimpleObject, Clone)]
pub struct LogoutPayload {
    pub ok: bool,
}

#[derive(Clone)]
pub struct AppServices {
    pub content: Arc<dyn ContentRepository>,
}

pub struct QueryRoot;

#[Object]
impl QueryRoot {
    async fn health(&self) -> &'static str {
        "ok"
    }

    async fn items(
        &self,
        ctx: &Context<'_>,
        #[graphql(name = "page")] page: i32,
        #[graphql(name = "pageSize")] page_size: i32,
    ) -> GqlResult<ItemsConnection> {
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        if page < 1 || page_size < 1 || page_size > 100 {
            return Err(GqlError::new("invalid pagination"));
        }
        let page_u = page as u32;
        let page_size_u = page_size as u32;
        let conn = svc
            .content
            .items_page_for_user(&uid.0, page_u, page_size_u)
            .await
            .map_err(|e| GqlError::new(format!("content: {e}")))?;
        let total = i32::try_from(conn.total).unwrap_or(i32::MAX);
        let items: Vec<GqlItem> = conn
            .items
            .into_iter()
            .map(|row| gql_item(&uid.0, row))
            .collect();
        Ok(ItemsConnection { total, items })
    }

    async fn items_slice(
        &self,
        ctx: &Context<'_>,
        limit: i32,
        offset: i32,
    ) -> GqlResult<ItemsSliceConnection> {
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let lim = limit.clamp(1, 100_000) as i64;
        let off = offset.max(0) as i64;
        let rows = svc
            .content
            .list_items_slice(&uid.0, lim, off)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let items = rows.into_iter().map(|row| gql_item(&uid.0, row)).collect();
        Ok(ItemsSliceConnection { items })
    }

    async fn items_updated_after(
        &self,
        ctx: &Context<'_>,
        #[graphql(name = "updatedAfter")] updated_after: String,
    ) -> GqlResult<ItemsSliceConnection> {
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        if updated_after.trim().is_empty() {
            return Ok(ItemsSliceConnection { items: vec![] });
        }
        let rows = svc
            .content
            .list_items_updated_after(&uid.0, updated_after.trim())
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let items = rows.into_iter().map(|row| gql_item(&uid.0, row)).collect();
        Ok(ItemsSliceConnection { items })
    }

    async fn item_stats(&self, ctx: &Context<'_>) -> GqlResult<ItemStatsPayload> {
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let total = svc
            .content
            .count_items(&uid.0)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let stats = svc
            .content
            .item_title_initial_stats(&uid.0)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let by_initial = stats
            .into_iter()
            .map(|(letter, count)| ByInitialEntry {
                letter,
                count: count as i32,
            })
            .collect();
        Ok(ItemStatsPayload {
            total: total as i32,
            by_initial,
        })
    }

    async fn item_ids(&self, ctx: &Context<'_>) -> GqlResult<Vec<String>> {
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        svc.content
            .list_item_ids(&uid.0)
            .await
            .map_err(|e| GqlError::new(e.to_string()))
    }

    async fn items_arrow_binary(&self) -> GqlResult<ArrowIPCZstdScalar> {
        Err(GqlError::new(
            "itemsArrowBinary: use POST /api/graphql with operationName ItemsArrowBinary and Accept: application/vnd.apache.arrow.stream; codecs=zstd (or application/x-arrow-ipc+zstd)",
        )
        .extend_with(|_, e| {
            e.set("code", 400);
        }))
    }
}

pub struct MutationRoot;

#[Object]
impl MutationRoot {
    async fn auth_login(
        &self,
        ctx: &Context<'_>,
        email: String,
        password: String,
    ) -> GqlResult<AuthPayload> {
        let session = ctx
            .data::<Session>()
            .map_err(|_| GqlError::new("no session"))?;
        let ex = ctx
            .data::<GraphqlExtras>()
            .map_err(|_| GqlError::new("internal"))?;
        let t = crate::auth_flow::login_issue_tokens(
            session,
            &ex.pool,
            &ex.jwt_secret,
            ex.jwt_access_secs,
            ex.jwt_refresh_days,
            &email,
            &password,
        )
        .await
        .map_err(|e| match e {
            LoginError::Unauthorized => {
                GqlError::new("invalid credentials").extend_with(|_, ev| {
                    ev.set("code", 401);
                })
            }
            LoginError::Internal => GqlError::new("internal"),
        })?;
        Ok(AuthPayload {
            token: t.token,
            refresh_token: t.refresh_token,
            expires_in: t.expires_in as i64,
        })
    }

    async fn auth_refresh(
        &self,
        ctx: &Context<'_>,
        #[graphql(name = "refreshToken")] refresh_token: String,
    ) -> GqlResult<AuthPayload> {
        let ex = ctx
            .data::<GraphqlExtras>()
            .map_err(|_| GqlError::new("internal"))?;
        let t = crate::auth_flow::refresh_access_token(
            &ex.pool,
            &ex.jwt_secret,
            ex.jwt_access_secs,
            ex.jwt_refresh_days,
            &refresh_token,
        )
        .await
        .map_err(|e| match e {
            LoginError::Unauthorized => {
                GqlError::new("Unauthorized").extend_with(|_, ev| {
                    ev.set("code", 401);
                })
            }
            LoginError::Internal => GqlError::new("internal"),
        })?;
        Ok(AuthPayload {
            token: t.token,
            refresh_token: t.refresh_token,
            expires_in: t.expires_in as i64,
        })
    }

    async fn auth_logout(&self, ctx: &Context<'_>) -> GqlResult<LogoutPayload> {
        let ex = ctx
            .data::<GraphqlExtras>()
            .map_err(|_| GqlError::new("internal"))?;
        let session = ctx
            .data::<Session>()
            .map_err(|_| GqlError::new("no session"))?;
        let bt = ctx
            .data::<BearerToken>()
            .map_err(|_| GqlError::new("internal"))?;
        if let Some(ref tok) = bt.0 {
            if let Ok(uid) = crate::auth_flow::user_id_from_jwt(&ex.jwt_secret, tok) {
                let _ = refresh_repo::delete_refresh_tokens_for_user(&ex.pool, &uid).await;
            }
        }
        crate::auth_flow::logout_user(session, &ex.pool)
            .await
            .map_err(|_| GqlError::new("internal"))?;
        Ok(LogoutPayload { ok: true })
    }

    async fn create_item(&self, ctx: &Context<'_>, title: String) -> GqlResult<GqlItem> {
        let title = title.trim();
        if title.is_empty() {
            return Err(GqlError::new("empty title"));
        }
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let row = svc
            .content
            .create_item(&uid.0, title)
            .await
            .map_err(|e| GqlError::new(format!("content: {e}")))?;
        Ok(gql_item(&uid.0, row))
    }

    async fn update_item(
        &self,
        ctx: &Context<'_>,
        id: String,
        title: String,
    ) -> GqlResult<GqlItem> {
        let title = title.trim();
        if title.is_empty() {
            return Err(GqlError::new("empty title"));
        }
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let row = svc
            .content
            .update_item(&uid.0, &id, title)
            .await
            .map_err(|e| {
                if e.to_string() == "not_found" {
                    GqlError::new("not found").extend_with(|_, ev| {
                        ev.set("code", 404);
                    })
                } else {
                    GqlError::new(format!("content: {e}"))
                }
            })?;
        Ok(gql_item(&uid.0, row))
    }

    async fn delete_item(&self, ctx: &Context<'_>, id: String) -> GqlResult<bool> {
        let svc = ctx
            .data::<Arc<AppServices>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        svc.content
            .delete_item(&uid.0, &id)
            .await
            .map_err(|e| {
                if e.to_string() == "not_found" {
                    GqlError::new("not found").extend_with(|_, ev| {
                        ev.set("code", 404);
                    })
                } else {
                    GqlError::new(format!("content: {e}"))
                }
            })?;
        Ok(true)
    }
}

pub type AppSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub fn build_schema(cfg: &Config) -> AppSchema {
    Schema::build(QueryRoot, MutationRoot, EmptySubscription)
        .extension(ApolloPersistedQueries::new(LruCacheStorage::new(
            cfg.graphql_apq_cache_size,
        )))
        .limit_depth(cfg.graphql_max_depth)
        .limit_complexity(cfg.graphql_max_complexity)
        .finish()
}

#[derive(Clone)]
pub struct EmailLoader {
    pub pool: sqlx::MySqlPool,
}

impl Loader<String> for EmailLoader {
    type Value = String;
    type Error = GqlError;

    fn load(
        &self,
        keys: &[String],
    ) -> impl Future<Output = Result<HashMap<String, String>, Self::Error>> + Send {
        let pool = self.pool.clone();
        let keys = keys.to_vec();
        async move {
            if keys.is_empty() {
                return Ok(HashMap::new());
            }
            let mut qb: QueryBuilder<MySql> =
                QueryBuilder::new("SELECT id, email FROM users WHERE id IN (");
            {
                let mut separated = qb.separated(", ");
                for k in &keys {
                    separated.push_bind(k);
                }
            }
            qb.push(")");
            let rows = qb
                .build_query_as::<(String, String)>()
                .fetch_all(&pool)
                .await
                .map_err(|e| GqlError::new(e.to_string()))?;
            Ok(rows.into_iter().collect())
        }
    }
}
