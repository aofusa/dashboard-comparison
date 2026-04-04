CREATE TABLE IF NOT EXISTS refresh_tokens (
    id VARCHAR(36) PRIMARY KEY NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL,
    INDEX idx_refresh_hash (token_hash),
    INDEX idx_refresh_user (user_id),
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
