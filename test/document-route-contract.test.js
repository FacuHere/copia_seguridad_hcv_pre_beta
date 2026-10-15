const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const router = read('src/routes/documents.js');
const migration = read('sql/006_documents_storage_lifecycle.sql');
const studies = read('src/routes/studies.js');
const patients = read('src/routes/patients.js');
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
  assert.match(router, /INSERT INTO documents \(patient_id, study_id/);
  assert.match(router, /currentStudy\.patientId/);
  assert.match(router, /studyForUpload\(transaction, studyId, \{ lock: true \}\)/);
  assert.match(migration, /WHERE r\.code = 'administrador'/);
  assert.doesNotMatch(migration, /WHERE r\.code = 'visualizador'[\s\S]*documents\.(upload|replace|delete)/);
});

test('documents stay behind the API and storage recovery runs before the server listens', () => {
  assert.match(server, /app\.use\('\/api', documentRoutes\)/);
  assert.ok(server.indexOf('recoverOperations(database.getPool(), storage.root)') < server.indexOf('server = app.listen'));
  assert.doesNotMatch(server, /express\.static\([^\n]*FILE_STORAGE_ROOT/i);
  assert.match(router, /router\.get\('\/documentos\/:id\/content'/);
  assert.match(router, /router\.get\('\/documentos\/:id\/download'/);
  assert.match(router, /openRegularFile\(config\.root, document\.storage_key\)/);
  assert.doesNotMatch(server, /STORAGE_RECOVERY_REQUIRED/);
  assert.match(router, /requireStorageReady/);
  assert.match(server, /GET \/api\/health\/storage|\/api\/health\/storage/);
  assert.doesNotMatch(server, /document-storage-lease|acquireStorageLease|storageLeaseRelease/);
  assert.doesNotMatch(read('src/services/document-operations.js'), /leaseHeld|lease_required|document-storage-lease/);
});

test('study_date is rejected if changed and omitted from the study UPDATE statement', () => {
  assert.match(studies, /STUDY_DATE_IMMUTABLE/);
  const updateSql = studies.match(/UPDATE studies SET([\s\S]*?)WHERE id = \? AND version = \?/);
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
