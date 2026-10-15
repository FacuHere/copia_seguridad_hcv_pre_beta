-- Almacenamiento privado de documentos, operaciones recuperables y RBAC documental.
-- Aplicar manualmente después de 005_seed_general_service.sql.
-- PRECONDICIÓN: revisar que documents no tenga patient_id/study_id NULL ni sha256 NULL.
-- La migración falla sin modificar esos registros si la precondición no se cumple.

ALTER TABLE documents
  MODIFY patient_id BIGINT UNSIGNED NOT NULL,
  MODIFY study_id BIGINT UNSIGNED NOT NULL,
  MODIFY sha256 CHAR(64) NOT NULL,
  ADD COLUMN file_status ENUM('pending', 'active', 'replacing', 'deleting', 'moving') NOT NULL DEFAULT 'active',
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD COLUMN updated_by BIGINT UNSIGNED NULL,
  ADD COLUMN derived_from_document_id BIGINT UNSIGNED NULL,
  ADD KEY idx_documents_derived_from (derived_from_document_id),
  ADD CONSTRAINT fk_documents_updated_by FOREIGN KEY (updated_by) REFERENCES app_users (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT,
  ADD CONSTRAINT fk_documents_derived_from FOREIGN KEY (derived_from_document_id) REFERENCES documents (id)
    ON UPDATE RESTRICT ON DELETE RESTRICT;

CREATE TABLE document_file_operations (
  operation_id CHAR(36) NOT NULL,
  operation_type ENUM('upload', 'replace', 'delete', 'rename_patient', 'rename_study') NOT NULL,
  operation_state ENUM('prepared', 'filesystem_applied', 'completed', 'failed') NOT NULL,
  document_id BIGINT UNSIGNED NULL,
  patient_id BIGINT UNSIGNED NULL,
  study_id BIGINT UNSIGNED NULL,
  staging_key VARCHAR(255) NULL,
  backup_key VARCHAR(255) NULL,
  old_storage_key VARCHAR(255) NULL,
  new_storage_key VARCHAR(255) NULL,
  old_prefix VARCHAR(255) NULL,
  new_prefix VARCHAR(255) NULL,
  original_name VARCHAR(255) NULL,
  mime_type VARCHAR(160) NULL,
  size_bytes BIGINT UNSIGNED NULL,
  sha256 CHAR(64) NULL,
  old_sha256 CHAR(64) NULL,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  failure_code VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (operation_id),
  KEY idx_document_file_operations_state (operation_state, created_at),
  KEY idx_document_file_operations_document (document_id),
  KEY idx_document_file_operations_patient (patient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (code, description)
VALUES
  ('documents.upload', 'Cargar documentos e imágenes en estudios.'),
  ('documents.replace', 'Reemplazar el archivo de un documento.'),
  ('documents.delete', 'Eliminar físicamente documentos e imágenes.');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code IN ('documents.upload', 'documents.replace', 'documents.delete')
WHERE r.code = 'administrador';
