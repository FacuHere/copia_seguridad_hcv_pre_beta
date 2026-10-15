const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { once } = require('node:events');
const { start, storageReadiness } = require('../src/server');

test('API startup ignores a residual .service.lock and recovers a pending journaled upload', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcv-startup-recovery-'));
  const bytes = Buffer.from('%PDF-1.7\nstartup recovery fixture');
  const stagingKey = '.staging/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.part';
  const finalKey = 'Pacientes/P-1/Estudios/E-2/D-10 - startup.pdf';
  const markerPath = path.join(root, '.staging', '.service.lock');
  const stagingPath = path.join(root, ...stagingKey.split('/'));
  const finalPath = path.join(root, ...finalKey.split('/'));
  const markerContents = 'inert residual marker; never parsed by startup';
  const document = { id: '10', file_status: 'pending' };
  const operation = {
    operation_id: 'synthetic-upload-op', operation_type: 'upload', operation_state: 'prepared',
    document_id: '10', patient_id: '1', study_id: '2', staging_key: stagingKey,
    new_storage_key: finalKey, original_name: 'startup.pdf', mime_type: 'application/pdf',
    size_bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), actor_user_id: '9',
  };
  const queries = [];
  const pool = {
    async query(sql, params = []) {
      const statement = sql.replace(/\s+/g, ' ').trim();
      queries.push(statement);
      if (statement.startsWith('SELECT * FROM document_file_operations')) {
        return operation.operation_state === 'completed' ? [] : [{ ...operation }];
      }
      if (statement.startsWith('SELECT staging_key, backup_key FROM document_file_operations')) {
        return ['prepared', 'filesystem_applied'].includes(operation.operation_state)
          ? [{ staging_key: operation.staging_key, backup_key: null }]
          : [];
      }
      if (statement.startsWith("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'pending'")) {
        if (String(params[0]) !== document.id || document.file_status !== 'pending') return { affectedRows: 0 };
        document.file_status = 'active';
        return { affectedRows: 1 };
      }
      if (statement.startsWith("UPDATE document_file_operations SET operation_state = 'completed'")) {
        if (params[0] !== operation.operation_id || !['prepared', 'filesystem_applied'].includes(operation.operation_state)) return { affectedRows: 0 };
        operation.operation_state = 'completed';
        return { affectedRows: 1 };
      }
      if (statement.startsWith('INSERT INTO audit_events')) return { affectedRows: 1 };
      throw new Error(`Unexpected startup test SQL: ${statement}`);
    },
    async getConnection() {
      return { query: this.query.bind(this), beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
    },
  };

  const previousReadiness = { ...storageReadiness };
  let server;
  try {
    await fs.mkdir(path.dirname(stagingPath), { recursive: true });
    await fs.writeFile(stagingPath, bytes);
    await fs.writeFile(markerPath, markerContents);

    server = await start({ pool, storageConfig: { root, maxFileSizeBytes: 1024 * 1024 }, listenHost: '127.0.0.1', listenPort: 0 });
    if (!server.listening) await once(server, 'listening');

    assert.equal(server.listening, true);
    assert.equal(storageReadiness.status, 'ready');
    assert.deepEqual(storageReadiness.operations, []);
    assert.equal(operation.operation_state, 'completed');
    assert.equal(document.file_status, 'active');
    assert.deepEqual(await fs.readFile(finalPath), bytes);
    await assert.rejects(fs.stat(stagingPath), { code: 'ENOENT' });
    assert.equal(await fs.readFile(markerPath, 'utf8'), markerContents);
    assert.ok(queries.some(query => query.startsWith('SELECT * FROM document_file_operations')));

    const health = await fetch(`http://127.0.0.1:${server.address().port}/api/health/storage`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ready');
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    Object.assign(storageReadiness, previousReadiness);
    await fs.rm(root, { recursive: true, force: true });
  }
});
