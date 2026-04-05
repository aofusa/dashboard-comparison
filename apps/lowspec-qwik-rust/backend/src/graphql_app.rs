//! GraphQL 統一 API（REST 廃止後）。DataLoader・Mutation・Arrow はバイナリ HTTP 分岐（`main.rs`）。

use std::collections::HashMap;
use std::future::Future;
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{
    Context, EmptySubscription, ErrorExtensions, InputValueError, InputValueResult, Object, Scalar,
    ScalarType, Schema, SimpleObject, Value,
};
use async_graphql::{Error as GqlError, Result as GqlResult};
use tower_sessions::Session;

use crate::auth_flow::{self, LoginError};
use crate::content_repo::ContentRepository;
use crate::meta_repo::{MetaRepository, SqliteMetaRepository};
use crate::AppState;

/// HTTP `Authorization: Bearer` の生トークン（`authLogout` で JWT sub の Refresh 削除に使用）。
#[derive(Clone, Default)]
pub struct BearerToken(pub Option<String>);

#[derive(Clone, Debug)]
pub struct UserId(pub String);

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

#[Object]
impl GqlItem {
    async fn id(&self) -> &str {
        &self.id
    }
    async fn title(&self) -> &str {
        &self.title
    }
    /// JSON レスポンスでは camelCase `updatedAt`
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

/// スキーマ上の印。実体のバイト列は `POST /api/graphql` のバイナリ分岐で返す（JSON 実行では不可）。
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
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        if page < 1 || page_size < 1 || page_size > 100 {
            return Err(GqlError::new("invalid pagination"));
        }
        let offset = ((page - 1) * page_size) as i64;
        let total = content
            .count_items(&uid.0)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let rows = content
            .list_items(&uid.0, page_size as i64, offset)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let items: Vec<GqlItem> = rows
            .into_iter()
            .map(|(id, title, user_id, updated_at)| GqlItem {
                id,
                title,
                user_id,
                updated_at,
            })
            .collect();
        Ok(ItemsConnection {
            total: total as i32,
            items,
        })
    }

    async fn items_slice(
        &self,
        ctx: &Context<'_>,
        limit: i32,
        offset: i32,
    ) -> GqlResult<ItemsSliceConnection> {
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let lim = limit.clamp(1, 100_000) as i64;
        let off = offset.max(0) as i64;
        let rows = content
            .list_items(&uid.0, lim, off)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let items: Vec<GqlItem> = rows
            .into_iter()
            .map(|(id, title, user_id, updated_at)| GqlItem {
                id,
                title,
                user_id,
                updated_at,
            })
            .collect();
        Ok(ItemsSliceConnection { items })
    }

    async fn items_updated_after(
        &self,
        ctx: &Context<'_>,
        #[graphql(name = "updatedAfter")] updated_after: String,
    ) -> GqlResult<ItemsSliceConnection> {
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        if updated_after.trim().is_empty() {
            return Ok(ItemsSliceConnection { items: vec![] });
        }
        let rows = content
            .list_items_updated_after(&uid.0, updated_after.trim())
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let items: Vec<GqlItem> = rows
            .into_iter()
            .map(|(id, title, user_id, updated_at)| GqlItem {
                id,
                title,
                user_id,
                updated_at,
            })
            .collect();
        Ok(ItemsSliceConnection { items })
    }

    async fn item_stats(&self, ctx: &Context<'_>) -> GqlResult<ItemStatsPayload> {
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let total = content
            .count_items(&uid.0)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        let stats = content
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
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        content
            .list_item_ids(&uid.0)
            .await
            .map_err(|e| GqlError::new(e.to_string()))
    }

    /// JSON 実行では常にエラー。バイナリは `operationName: ItemsArrowBinary` + `Accept` を `main` が処理。
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
        let state = ctx
            .data::<Arc<AppState>>()
            .map_err(|_| GqlError::new("internal"))?;
        let t = auth_flow::login_issue_tokens(
            session,
            state.meta.as_ref(),
            &state.jwt_secret,
            state.jwt_access_secs,
            state.jwt_refresh_days,
            &email,
            &password,
        )
        .await
        .map_err(|e| match e {
            LoginError::Unauthorized => GqlError::new("Unauthorized").extend_with(|_, ex| {
                ex.set("code", 401);
            }),
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
        let state = ctx
            .data::<Arc<AppState>>()
            .map_err(|_| GqlError::new("internal"))?;
        let t = auth_flow::refresh_access_token(
            state.meta.as_ref(),
            &state.jwt_secret,
            state.jwt_access_secs,
            state.jwt_refresh_days,
            &refresh_token,
        )
        .await
        .map_err(|e| match e {
            LoginError::Unauthorized => GqlError::new("Unauthorized").extend_with(|_, ex| {
                ex.set("code", 401);
            }),
            LoginError::Internal => GqlError::new("internal"),
        })?;
        Ok(AuthPayload {
            token: t.token,
            refresh_token: t.refresh_token,
            expires_in: t.expires_in as i64,
        })
    }

    async fn auth_logout(&self, ctx: &Context<'_>) -> GqlResult<LogoutPayload> {
        let state = ctx
            .data::<Arc<AppState>>()
            .map_err(|_| GqlError::new("internal"))?;
        let session = ctx
            .data::<Session>()
            .map_err(|_| GqlError::new("no session"))?;
        let bt = ctx
            .data::<BearerToken>()
            .map_err(|_| GqlError::new("internal"))?;
        if let Some(ref tok) = bt.0 {
            if let Ok(uid) = auth_flow::user_id_from_jwt(&state.jwt_secret, tok) {
                let _ = state
                    .meta
                    .delete_refresh_tokens_for_user(&uid)
                    .await
                    .map_err(|_| GqlError::new("internal"))?;
            }
        }
        auth_flow::logout_user(session, state.meta.as_ref())
            .await
            .map_err(|_| GqlError::new("internal"))?;
        Ok(LogoutPayload { ok: true })
    }

    async fn create_item(&self, ctx: &Context<'_>, title: String) -> GqlResult<GqlItem> {
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let row = content
            .create_item(&uid.0, &title)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        Ok(GqlItem {
            id: row.0,
            title: row.1,
            user_id: row.2,
            updated_at: row.3,
        })
    }

    async fn update_item(
        &self,
        ctx: &Context<'_>,
        id: String,
        title: String,
    ) -> GqlResult<GqlItem> {
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let row = content
            .update_item(&uid.0, &id, &title)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?
            .ok_or_else(|| {
                GqlError::new("not found").extend_with(|_, e| {
                    e.set("code", 404);
                })
            })?;
        Ok(GqlItem {
            id: row.0,
            title: row.1,
            user_id: row.2,
            updated_at: row.3,
        })
    }

    async fn delete_item(&self, ctx: &Context<'_>, id: String) -> GqlResult<bool> {
        let content = ctx
            .data::<Arc<dyn ContentRepository>>()
            .map_err(|_| GqlError::new("internal"))?;
        let uid = ctx
            .data_opt::<UserId>()
            .ok_or_else(|| GqlError::new("Unauthorized").extend_with(|_, e| {
                e.set("code", 401);
            }))?;
        let ok = content
            .delete_item(&uid.0, &id)
            .await
            .map_err(|e| GqlError::new(e.to_string()))?;
        if !ok {
            return Err(
                GqlError::new("not found").extend_with(|_, e| {
                    e.set("code", 404);
                }),
            );
        }
        Ok(true)
    }
}

pub type AppSchema = Schema<QueryRoot, MutationRoot, EmptySubscription>;

pub fn build_schema() -> AppSchema {
    Schema::build(QueryRoot, MutationRoot, EmptySubscription).finish()
}

#[derive(Clone)]
pub struct EmailLoader {
    pub meta: Arc<SqliteMetaRepository>,
}

impl Loader<String> for EmailLoader {
    type Value = String;
    type Error = GqlError;

    fn load(
        &self,
        keys: &[String],
    ) -> impl Future<Output = Result<HashMap<String, String>, Self::Error>> + Send {
        let meta = self.meta.clone();
        let keys = keys.to_vec();
        async move {
            meta.get_emails_by_ids(&keys)
                .await
                .map_err(|e| GqlError::new(e.to_string()))
        }
    }
}
