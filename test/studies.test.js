const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serializeStudy } = require('../src/services/study-service');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '../src/routes/studies.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '../src/services/study-service.js'), 'utf8');
const repository = fs.readFileSync(path.join(__dirname, '../src/repositories/study-repository.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../sql/005_seed_general_service.sql'), 'utf8');

test('study frontend reads and writes studies through the API without persisting them in localStorage', () => {
  assert.match(app, /apiRequest\(`\/api\/pacientes\/\$\{encodeURIComponent\(requestedId\)\}\/estudios`\)/);
  assert.match(app, /'\/api\/estudios'/);
  assert.match(app, /'\/api\/estudios\/' \+ encodeURIComponent\(editingId\)/);
  assert.match(app, /method: editingStudy \? 'PUT' : 'POST'/);
  assert.doesNotMatch(app, /FileReader|filesToData|studies:\s*Array\.isArray\(modules\.studies\)/);
  assert.doesNotMatch(app, /patientModules\[[^\]]+\]\.studies\s*=|studies:\s*selectedPatient\.studies/);
});

test('study API resolves the provisional service on the server and stringifies exposed IDs', () => {
  assert.match(route, /studiesController\.listarPorPaciente/);
  assert.match(service, /id: String\(row\.id\)/);
  assert.match(service, /patientId: String\(row\.patientId\)/);
  assert.match(service, /serviceId: String\(row\.serviceId\)/);
  assert.match(repository, /WHERE code = \? AND is_active = TRUE LIMIT 1/);
  assert.match(repository, /\['GENERAL'\]/);

  const row = { id: 1n, patientId: 2n, serviceId: 3n, version: 4 };
  const serialized = serializeStudy(row);
  assert.deepEqual(serialized, { id: '1', patientId: '2', serviceId: '3', version: 4 });
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('GENERAL service seed is idempotent by its unique code', () => {
  assert.match(migration, /VALUES \('GENERAL', 'Servicio general', TRUE\)/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(migration, /user_services|role_service_permissions|INSERT INTO app_users|INSERT INTO user_roles/i);
});
