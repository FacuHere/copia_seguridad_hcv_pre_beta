const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const router = read('src/routes/documents.js');
const documentService = read('src/services/document-service.js');
const documentRepository = read('src/repositories/document-repository.js');
const migration = read('sql/006_documents_storage_lifecycle.sql');
const studies = read('src/services/study-service.js');
const studyRepository = read('src/repositories/study-repository.js');
const patients = read('src/services/patient-service.js');
const healthRouter = read('src/routes/health.js');
const lifecycle = read('src/services/application-lifecycle.js');
const frontend = read('public/js/app.js');
const server = read('src/server.js');

test('document API applies the expected RBAC permissions and study-derived patient association', () => {
  for (const [method, route, permission] of [
    ['get', '/estudios/:studyId/documentos', 'documents.read'],
    ['post', '/estudios/:studyId/documentos', 'documents.upload'],
    ['get', '/documentos/:id/download', 'documents.download'],
    ['put', '/documentos/:id', 'documents.replace'],
    ['delete', '/documentos/:id', 'documents.delete'],
  ]) {
    assert.match(router, new RegExp(`router\\.${method}\\(['"]${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`));
    assert.match(router, new RegExp(`requirePermission\\('${permission}'\\)`));
  }
  assert.match(documentRepository, /INSERT INTO documents \(patient_id, study_id/);
  assert.match(documentService, /currentStudy\.patientId/);
  assert.match(documentService, /findStudyForUpload\(transaction, studyId, true\)/);
  assert.match(migration, /WHERE r\.code = 'administrador'/);
  assert.doesNotMatch(migration, /WHERE r\.code = 'visualizador'[\s\S]*documents\.(upload|replace|delete)/);
});

test('documents stay behind the API and storage recovery runs before the server listens', () => {
  assert.match(server, /app\.use\('\/api', documentRoutes\)/);
  assert.ok(server.indexOf('prepareStorageRecovery(getPool(), configuredStorageConfig)') < server.indexOf('server = app.listen'));
  assert.match(lifecycle, /recoverOperations\(pool, storage\.root\)/);
  assert.match(lifecycle, /cleanupOrphanStaging\(pool, storage\.root/);
  assert.doesNotMatch(server, /express\.static\([^\n]*FILE_STORAGE_ROOT/i);
  assert.match(router, /router\.get\('\/documentos\/:id\/content'/);
  assert.match(router, /router\.get\('\/documentos\/:id\/download'/);
  assert.match(documentService, /openRegularFile\(config\.root, document\.storage_key\)/);
  assert.doesNotMatch(server, /STORAGE_RECOVERY_REQUIRED/);
  assert.match(router, /requireStorageReady/);
  assert.match(healthRouter, /router\.get\('\/storage'/);
  assert.match(server, /app\.use\('\/api\/health', healthRoutes\)/);
  assert.doesNotMatch(server, /document-storage-lease|acquireStorageLease|storageLeaseRelease/);
  assert.doesNotMatch(read('src/services/document-operations.js'), /leaseHeld|lease_required|document-storage-lease/);
});

test('study_date is rejected if changed and omitted from the study UPDATE statement', () => {
  assert.match(studies, /STUDY_DATE_IMMUTABLE/);
  const updateSql = studyRepository.match(/UPDATE studies SET([\s\S]*?)WHERE id = \? AND version = \?/);
  assert.ok(updateSql);
  assert.doesNotMatch(updateSql[1], /study_date/);
  assert.match(frontend, /form\.elements\.date\.disabled = true/);
});

test('patient and study label changes invoke recoverable directory moves by stable IDs', () => {
  assert.match(patients, /type: 'rename_patient'/);
  assert.match(patients, /patientFolderKey\(/);
  assert.match(studies, /type: 'rename_study'/);
  assert.match(studies, /studyFolderKey\(/);
  assert.match(migration, /'rename_patient', 'rename_study'/);
  assert.match(migration, /old_prefix VARCHAR\(255\)/);
  assert.match(migration, /new_prefix VARCHAR\(255\)/);
});
