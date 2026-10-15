const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../src/config/database');
const patientRoutes = require('../src/routes/patients');

async function requestPatientRename({ hasDocuments }) {
  const originalGetPool = database.getPool;
  const originalRoot = process.env.FILE_STORAGE_ROOT;
  delete process.env.FILE_STORAGE_ROOT;
  let updated = false;
  const pool = {
    async query(sql, params) {
      if (sql.includes('FROM app_sessions s')) return [{ session_id: 1n, id: 9n, username: 'synthetic', display_name: 'Synthetic' }];
      if (sql.includes('FROM user_roles ur')) return [{}];
      throw new Error(`Unexpected pool SQL: ${sql} ${params}`);
    },
    async getConnection() {
      return {
        async query(sql) {
          if (sql.includes('SELECT id, full_name AS fullName, dni, version FROM patients')) return [{ id: 4n, fullName: 'Old Name', dni: '100', version: 1 }];
          if (sql.startsWith('SELECT id FROM documents WHERE patient_id')) return hasDocuments ? [{ id: 31n }] : [];
          if (sql.startsWith('UPDATE patients SET')) { updated = true; return { affectedRows: 1 }; }
          if (sql.startsWith('INSERT INTO audit_events')) return { affectedRows: 1 };
          throw new Error(`Unexpected connection SQL: ${sql}`);
        },
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
      };
    },
  };
  database.getPool = () => pool;
  const app = express(); app.use(express.json()); app.use('/api/pacientes', patientRoutes);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/pacientes/4`, {
      method: 'PUT', headers: { cookie: `hcv_session=${'c'.repeat(43)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'New Name', dni: '200', birthDate: '', phone: '', address: '', notes: '', version: 1 }),
    });
    return { status: response.status, body: await response.json(), updated };
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.getPool = originalGetPool;
    if (originalRoot === undefined) delete process.env.FILE_STORAGE_ROOT; else process.env.FILE_STORAGE_ROOT = originalRoot;
  }
}

test('patient name/DNI change without storage is rejected before metadata update when documents exist', async () => {
  const result = await requestPatientRename({ hasDocuments: true });
  assert.equal(result.status, 503);
  assert.equal(result.body.error.code, 'FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME');
  assert.equal(result.updated, false);
});

test('patient name/DNI change remains available without storage when no documents are affected', async () => {
  const result = await requestPatientRename({ hasDocuments: false });
  assert.equal(result.status, 200);
  assert.equal(result.updated, true);
});
