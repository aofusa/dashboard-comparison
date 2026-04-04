//! パスワード（Argon2）と検証。ログインのトークン発行は **`auth_flow`**。

use argon2::password_hash::{PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Argon2, PasswordHash};

pub fn hash_password(pw: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
    Ok(Argon2::default()
        .hash_password(pw.as_bytes(), &salt)?
        .to_string())
}

pub(crate) fn verify_password(pw: &str, hash: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(hash) else {
        return false;
    };
    Argon2::default()
        .verify_password(pw.as_bytes(), &parsed)
        .is_ok()
}
