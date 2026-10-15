const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const database = require('../src/config/database');
const studiesRoute = require('../src/routes/studies');

test('direct HTTP PUT cannot change an existing study date', async () => {
  const originalGetPool = database.getPool;
  const statements = [];
  const fakePool = {
    async query(sql, params) {
      statements.push({ sql, params });
      if (sql.includes('FROM app_sessions s')) return [{ session_id: 1n, id: 9n, username: 'synthetic', display_name: 'Synthetic' }];
      if (sql.includes('FROM user_roles ur')) return [{}];
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    async getConnection() {
      return {
        async query(sql, params) {
          statements.push({ sql, params });
          if (sql.includes('FROM studies s JOIN patients p')) return [{ patientId: 2n, date: '2026-10-05', studyType: 'Synthetic', patientDni: null, patientName: 'Synthetic', version: 1 }];
          throw new Error(`Unexpected connection query: ${sql}`);
        },
        async beginTransaction() {}, async rollback() {}, release() {},
      };
    },
  };
  database.getPool = () => fakePool;
  const app = express();
  app.use(express.json());
  app.use('/api', studiesRoute);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/estudios/77`, {
      method: 'PUT', headers: { cookie: `hcv_session=${'b'.repeat(43)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ patientId: '2', type: 'Synthetic', date: '2026-10-06', professional: '', diagnosis: '', procedure: '', description: '', conclusions: '', version: 1 }),
    });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).error.code, 'STUDY_DATE_IMMUTABLE');
    assert.equal(statements.some(item => /^UPDATE studies/i.test(item.sql)), false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    database.getPool = originalGetPool;
  }
});
