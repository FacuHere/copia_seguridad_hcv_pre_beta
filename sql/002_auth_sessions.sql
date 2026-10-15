-- Sesiones persistentes para autenticación por cookie opaca.
-- Aplicar después de 001_initial_schema.sql.

CREATE TABLE IF NOT EXISTS app_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_sessions_token_hash (token_hash),
  KEY idx_app_sessions_user_expiry (user_id, expires_at),
  KEY idx_app_sessions_expiry (expires_at),
  CONSTRAINT fk_app_sessions_user FOREIGN KEY (user_id) REFERENCES app_users (id)
    ON UPDATE RESTRICT ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
