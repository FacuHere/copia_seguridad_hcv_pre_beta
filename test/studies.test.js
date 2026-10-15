const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const studiesRoute = require('../src/routes/studies');

const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const route = fs.readFileSync(path.join(__dirname, '../src/routes/studies.js'), 'utf8');
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
  assert.match(route, /WHERE code = \? AND is_active = TRUE LIMIT 1/);
  assert.match(route, /\['GENERAL'\]/);
  assert.match(route, /id: String\(row\.id\)/);
  assert.match(route, /patientId: String\(row\.patientId\)/);
  assert.match(route, /serviceId: String\(row\.serviceId\)/);

  const row = { id: 1n, patientId: 2n, serviceId: 3n, version: 4 };
  const serialized = studiesRoute.serializeStudy(row);
  assert.deepEqual(serialized, { id: '1', patientId: '2', serviceId: '3', version: 4 });
  assert.doesNotThrow(() => JSON.stringify(serialized));
});

test('GENERAL service seed is idempotent by its unique code', () => {
  assert.match(migration, /VALUES \('GENERAL', 'Servicio general', TRUE\)/);
  assert.match(migration, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(migration, /user_services|role_service_permissions|INSERT INTO app_users|INSERT INTO user_roles/i);
});
