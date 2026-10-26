const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const database = require('../src/config/database');
const documentRoutes = require('../src/routes/documents');
const { createHash } = require('node:crypto');
const { makeDocxFixture } = require('./helpers/docx-fixture');

class MemoryMariaDb {
  constructor(grants, { studyExists = true, studySnapshots = null } = {}) { this.grants = new Set(grants); this.studyExists = studyExists; this.studySnapshots = studySnapshots; this.studyQueries = []; this.documents = new Map(); this.operations = new Map(); this.audits = []; this.nextId = 1; }
  async query(sql, params = []) { return this.execute(sql, params); }
  async getConnection() {
    return { query: (sql, params) => this.execute(sql, params), beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} };
  }
  async execute(sql, params) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.includes('FROM app_sessions s')) return [{ session_id: 3n, id: 9n, username: 'test-user', display_name: 'Test User' }];
    if (s.includes('FROM user_roles ur')) {
      const permission = s.includes("p.code = 'images.read'") ? 'images.read' : params[1];
      return this.grants.has(permission) ? [{}] : [];
    }
    if (s.includes('FROM studies s JOIN patients p')) {
      this.studyQueries.push(s);
      if (!this.studyExists) return [];
      if (this.studySnapshots) {
        const snapshot = this.studySnapshots[Math.min(this.studyQueries.length - 1, this.studySnapshots.length - 1)];
        return [{ ...snapshot }];
      }
      return [{ studyId: 5n, patientId: 2n, studyDate: '2026-10-05', studyType: 'Test', patientDni: '111', patientName: 'Synthetic' }];
    }
    if (s.startsWith('SELECT d.id, d.patient_id')) {
      const row = this.documents.get(String(params[0]));
      return row?.file_status === 'active' ? [{ ...row, study_date: '2026-10-05', study_type: 'Test', patient_dni: '111', patient_name: 'Synthetic' }] : [];
    }
    if (s.startsWith('SELECT d.id, d.patient_id, d.study_id, d.storage_key')) {
      const row = this.documents.get(String(params[0])); return row ? [{ ...row, study_date: '2026-10-05', study_type: 'Test', patient_dni: '111', patient_name: 'Synthetic' }] : [];
    }
    if (s.startsWith('SELECT id, patient_id, study_id, storage_key')) {
      const row = this.documents.get(String(params[0])); return row ? [{ ...row }] : [];
    }
    if (s.startsWith('INSERT INTO documents')) {
      const id = String(this.nextId++);
      this.documents.set(id, { id: BigInt(id), patient_id: params[0], study_id: params[1], original_name: params[2], storage_key: params[3], mime_type: params[4], size_bytes: params[5], sha256: params[6], uploaded_by: params[7], file_status: 'pending', updated_by: null });
      return { insertId: BigInt(id), affectedRows: 1 };
    }
    if (s.startsWith('UPDATE documents SET storage_key = ? WHERE id = ?')) {
      const row = this.documents.get(String(params[1])); if (!row) return { affectedRows: 0 };
      row.storage_key = params[0]; return { affectedRows: 1 };
    }
    if (s.startsWith('UPDATE documents SET file_status = \'active\' WHERE id = ? AND file_status = \'pending\'')) {
      const row = this.documents.get(String(params[0])); if (!row || row.file_status !== 'pending') return { affectedRows: 0 };
      row.file_status = 'active'; return { affectedRows: 1 };
    }
    if (s.startsWith('UPDATE documents SET file_status = \'replacing\'')) {
      const row = this.documents.get(String(params[0])); if (!row || row.file_status !== 'active') return { affectedRows: 0 };
      row.file_status = 'replacing'; return { affectedRows: 1 };
    }
    if (s.startsWith('UPDATE documents SET storage_key = ?, original_name')) {
      const row = this.documents.get(String(params[6])); if (!row || row.file_status !== 'replacing') return { affectedRows: 0 };
      Object.assign(row, { storage_key: params[0], original_name: params[1], mime_type: params[2], size_bytes: params[3], sha256: params[4], updated_by: params[5], file_status: 'active' });
      return { affectedRows: 1 };
    }
    if (s.startsWith('INSERT INTO document_file_operations')) {
      const id = params[0]; this.operations.set(id, { operation_id: id, operation_state: 'prepared' }); return { affectedRows: 1 };
    }
    if (s.startsWith("UPDATE document_file_operations SET operation_state = 'filesystem_applied'")) {
      const row = this.operations.get(params[0]); if (!row || row.operation_state !== 'prepared') return { affectedRows: 0 };
      row.operation_state = 'filesystem_applied'; return { affectedRows: 1 };
    }
    if (s.startsWith("UPDATE document_file_operations SET operation_state = 'completed'")) {
      const row = this.operations.get(params[0]); if (!row) return { affectedRows: 0 };
      row.operation_state = 'completed'; return { affectedRows: 1 };
    }
    if (s.startsWith('UPDATE document_file_operations SET staging_key = NULL, backup_key = NULL')) {
      const row = this.operations.get(params[0]); if (!row || row.operation_state !== 'completed') return { affectedRows: 0 };
      row.staging_key = null; row.backup_key = null; return { affectedRows: 1 };
    }
    if (s.startsWith("DELETE FROM documents WHERE id = ? AND file_status = 'deleting'")) {
      const row = this.documents.get(String(params[0])); if (!row || row.file_status !== 'deleting') return { affectedRows: 0 };
      this.documents.delete(String(params[0])); return { affectedRows: 1 };
    }
    if (s.startsWith('INSERT INTO audit_events')) { this.audits.push({ sql: s, params }); return { affectedRows: 1 }; }
    if (s.startsWith('SELECT operation_state FROM document_file_operations')) {
      const row = this.operations.get(params[0]); return row ? [{ operation_state: row.operation_state }] : [];
    }
    if (s.startsWith('UPDATE documents SET file_status = \'deleting\'')) {
      const row = this.documents.get(String(params[0])); if (!row || row.file_status !== 'active') return { affectedRows: 0 };
      row.file_status = 'deleting'; return { affectedRows: 1 };
    }
    if (s.startsWith('SELECT id, study_id AS studyId')) return [...this.documents.values()].filter(row => row.file_status === 'active').map(row => ({ id: row.id, studyId: row.study_id, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: row.size_bytes, sha256: row.sha256, uploadedBy: row.uploaded_by, updatedBy: row.updated_by }));
    throw new Error(`Unexpected test SQL: ${s}`);
  }
}

async function withHttp(run, grants, options) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hcv-http-'));
  const previousRoot = process.env.FILE_STORAGE_ROOT;
  const previousLimit = process.env.MAX_FILE_SIZE_BYTES;
  process.env.FILE_STORAGE_ROOT = root;
  process.env.MAX_FILE_SIZE_BYTES = '1048576';
  const originalGetPool = database.getPool;
  const pool = new MemoryMariaDb(grants, options);
  database.getPool = () => pool;
  const app = express();
  app.use('/api', documentRoutes);
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try { await run({ root, pool, base: `http://127.0.0.1:${server.address().port}` }); }
  finally {
    await new Promise(resolve => server.close(resolve));
    database.getPool = originalGetPool;
    if (previousRoot === undefined) delete process.env.FILE_STORAGE_ROOT; else process.env.FILE_STORAGE_ROOT = previousRoot;
    if (previousLimit === undefined) delete process.env.MAX_FILE_SIZE_BYTES; else process.env.MAX_FILE_SIZE_BYTES = previousLimit;
    await fs.rm(root, { recursive: true, force: true });
  }
}

const cookie = `hcv_session=${'a'.repeat(43)}`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const multipart = (bytes, name, mime) => { const body = new FormData(); body.append('file', new Blob([bytes], { type: mime }), name); return body; };

async function seedDocument(root, pool, { id = '90', name = 'report.pdf', mime = 'application/pdf', bytes = Buffer.from('%PDF-1.7\nseed') } = {}) {
  const storageKey = `seed/${id}-${name}`;
  const filePath = path.join(root, ...storageKey.split('/'));
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  pool.documents.set(id, {
    id: BigInt(id), patient_id: 2n, study_id: 5n, original_name: name, storage_key: storageKey,
    mime_type: mime, size_bytes: bytes.length, sha256: sha(bytes), uploaded_by: 9n,
    updated_by: null, file_status: 'active',
  });
  return { storageKey, filePath, bytes };
}

test('HTTP upload, download, replacement and physical delete preserve bytes and audit using a disposable in-memory DB adapter', async () => {
  await withHttp(async ({ root, pool, base }) => {
    const original = Buffer.from('%PDF-1.7\nfirst version');
    let response = await fetch(`${base}/api/estudios/5/documentos`, { method: 'POST', headers: { cookie }, body: multipart(original, 'report.pdf', 'application/pdf') });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    assert.equal(created.patientId, '2');
    assert.equal(created.sha256, sha(original));
    const doc = pool.documents.get(created.id);
    assert.equal(doc.file_status, 'active');
    const physical = path.join(root, ...doc.storage_key.split('/'));
    assert.deepEqual(await fs.readFile(physical), original);
    assert.equal(path.resolve(physical).startsWith(path.resolve(root)), true);

    response = await fetch(`${base}/api/documentos/${created.id}/download`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
    response = await fetch(`${base}/api/documentos/${created.id}/content`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), original);
    response = await fetch(`${base}/api/estudios/5/documentos`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.length, 1);

    const replacement = Buffer.from('%PDF-1.7\nreplacement');
    response = await fetch(`${base}/api/documentos/${created.id}`, { method: 'PUT', headers: { cookie }, body: multipart(replacement, 'corrected.pdf', 'application/pdf') });
    assert.equal(response.status, 200);
    assert.equal(pool.documents.get(created.id).id.toString(), created.id);
    assert.equal(pool.documents.get(created.id).sha256, sha(replacement));
    const replacementPath = path.join(root, ...pool.documents.get(created.id).storage_key.split('/'));
    assert.deepEqual(await fs.readFile(replacementPath), replacement);
    assert.notEqual(physical, replacementPath);
    await assert.rejects(fs.stat(physical), { code: 'ENOENT' });

    response = await fetch(`${base}/api/documentos/${created.id}`, { method: 'DELETE', headers: { cookie } });
    assert.equal(response.status, 204, JSON.stringify([...pool.documents.values()].map(row => ({ id: String(row.id), file_status: row.file_status }))));
    assert.equal(pool.documents.has(created.id), false);
    await assert.rejects(fs.stat(replacementPath), { code: 'ENOENT' });
    assert.deepEqual(pool.audits.map(event => event.params[1]), ['document.upload', 'document.download', 'document.view', 'document.list', 'document.replace', 'document.delete']);
  }, ['documents.upload', 'documents.download', 'documents.read', 'images.read', 'documents.replace', 'documents.delete']);
});

test('HTTP upload and authenticated download preserve a synthetic DOCX and its database metadata', async () => {
  await withHttp(async ({ root, pool, base }) => {
    const bytes = makeDocxFixture();
    const response = await fetch(base + '/api/estudios/5/documentos', {
      method: 'POST',
      headers: { cookie },
      body: multipart(bytes, 'synthetic.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    assert.equal(created.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(created.sha256, sha(bytes));
    const row = pool.documents.get(created.id);
    assert.equal(row.file_status, 'active');
    assert.equal(row.patient_id, 2n);
    assert.equal(String(row.study_id), '5');
    const storedPath = path.join(root, ...row.storage_key.split('/'));
    assert.deepEqual(await fs.readFile(storedPath), bytes);
    const downloaded = await fetch(base + '/api/documentos/' + created.id + '/download', { headers: { cookie } });
    assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    const inline = await fetch(base + '/api/documentos/' + created.id + '/content', { headers: { cookie } });
    assert.equal(inline.status, 415);
    assert.equal(pool.operations.size, 1);
    assert.equal([...pool.operations.values()][0].operation_state, 'completed');
    assert.ok(pool.audits.some(event => event.params[1] === 'document.upload'));
  }, ['documents.upload', 'documents.download', 'documents.read']);
});
test('visualizer is denied file upload by the actual HTTP permission middleware', async () => {
  await withHttp(async ({ base, pool }) => {
    const response = await fetch(`${base}/api/estudios/5/documentos`, { method: 'POST', headers: { cookie }, body: multipart(Buffer.from('%PDF-1.7'), 'blocked.pdf', 'application/pdf') });
    assert.equal(response.status, 403);
    assert.equal(pool.documents.size, 0);
  }, ['documents.read', 'documents.download', 'images.read']);
});

test('visualizer can list, view and download permitted files but cannot replace or delete them', async () => {
  await withHttp(async ({ root, base, pool }) => {
    const pdf = await seedDocument(root, pool);
    const image = await seedDocument(root, pool, { id: '91', name: 'image.png', mime: 'image/png', bytes: Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]) });
    let response = await fetch(`${base}/api/estudios/5/documentos`, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.length, 2);
    for (const item of [pdf, image]) {
      const id = item === pdf ? '90' : '91';
      response = await fetch(`${base}/api/documentos/${id}/content`, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), item.bytes);
      response = await fetch(`${base}/api/documentos/${id}/download`, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), item.bytes);
    }
    const before = pool.documents.get('90').sha256;
    response = await fetch(`${base}/api/documentos/90`, { method: 'PUT', headers: { cookie }, body: multipart(Buffer.from('%PDF-1.7\nforbidden'), 'new.pdf', 'application/pdf') });
    assert.equal(response.status, 403);
    response = await fetch(`${base}/api/documentos/90`, { method: 'DELETE', headers: { cookie } });
    assert.equal(response.status, 403);
    assert.equal(pool.documents.get('90').sha256, before);
    assert.equal(pool.documents.size, 2);
  }, ['documents.read', 'documents.download', 'images.read']);
});

test('user without document permissions is denied every document operation without changing files or rows', async () => {
  await withHttp(async ({ root, base, pool }) => {
    const { filePath } = await seedDocument(root, pool);
    const endpoints = [
      [`/api/estudios/5/documentos`, { headers: { cookie } }],
      [`/api/documentos/90/content`, { headers: { cookie } }],
      [`/api/documentos/90/download`, { headers: { cookie } }],
      [`/api/estudios/5/documentos`, { method: 'POST', headers: { cookie }, body: multipart(Buffer.from('%PDF-1.7'), 'new.pdf', 'application/pdf') }],
      [`/api/documentos/90`, { method: 'PUT', headers: { cookie }, body: multipart(Buffer.from('%PDF-1.7'), 'new.pdf', 'application/pdf') }],
      [`/api/documentos/90`, { method: 'DELETE', headers: { cookie } }],
    ];
    for (const [url, init] of endpoints) assert.equal((await fetch(`${base}${url}`, init)).status, 403, `${init.method || 'GET'} ${url}`);
    assert.equal(pool.documents.size, 1);
    await fs.access(filePath);
  }, []);
});

test('upload rejects a nonexistent study and rejects a client-supplied patient association', async () => {
  await withHttp(async ({ base, pool }) => {
    let response = await fetch(`${base}/api/estudios/404/documentos`, { method: 'POST', headers: { cookie }, body: multipart(Buffer.from('%PDF-1.7'), 'report.pdf', 'application/pdf') });
    assert.equal(response.status, 404);
    assert.equal(pool.documents.size, 0);
  }, ['documents.upload'], { studyExists: false });
  await withHttp(async ({ base, pool }) => {
    const body = multipart(Buffer.from('%PDF-1.7'), 'report.pdf', 'application/pdf');
    body.append('patientId', '999');
    const response = await fetch(`${base}/api/estudios/5/documentos`, { method: 'POST', headers: { cookie }, body });
    assert.equal(response.status, 400);
    assert.equal(pool.documents.size, 0);
  }, ['documents.upload']);
});

test('upload locks and uses the current patient and study labels after the file has streamed', async () => {
  const beforeUpload = { studyId: 5n, patientId: 2n, studyDate: '2026-10-05', studyType: 'Original Study', patientDni: '111', patientName: 'Original Patient' };
  const afterConcurrentRename = { ...beforeUpload, studyType: 'Updated Study', patientDni: '222', patientName: 'Updated Patient' };
  await withHttp(async ({ base, pool, root }) => {
    const bytes = Buffer.from('%PDF-1.7\nlabels changed during upload');
    const response = await fetch(`${base}/api/estudios/5/documentos`, { method: 'POST', headers: { cookie }, body: multipart(bytes, 'labels.pdf', 'application/pdf') });
    assert.equal(response.status, 201);
    const created = (await response.json()).data;
    const row = pool.documents.get(created.id);
    assert.equal(row.patient_id, afterConcurrentRename.patientId);
    assert.match(row.storage_key, /P-2 - 222 - Updated Patient\/Estudios\/E-5 - 2026-10-05 - Updated Study/);
    assert.equal(pool.studyQueries.length, 2);
    assert.doesNotMatch(pool.studyQueries[0], /FOR UPDATE$/);
    assert.match(pool.studyQueries[1], /FOR UPDATE$/);
    assert.deepEqual(await fs.readFile(path.join(root, ...row.storage_key.split('/'))), bytes);
  }, ['documents.upload'], { studySnapshots: [beforeUpload, afterConcurrentRename] });
});

test('HTTP serving detects a same-size file alteration before sending any bytes and blocks clinical API', async () => {
  const { state } = require('../src/services/storage-readiness');
  const previous = { ...state };
  try {
    await withHttp(async ({ root, base, pool }) => {
      const seeded = await seedDocument(root, pool);
      await fs.writeFile(seeded.filePath, Buffer.from('X'.repeat(seeded.bytes.length)));
      const response = await fetch(`${base}/api/documentos/90/download`, { headers: { cookie } });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, 'DOCUMENT_INTEGRITY_MISMATCH');
      assert.equal(state.status, 'blocked');
    }, ['documents.download']);
  } finally { Object.assign(state, previous); }
});

test('DICOM upload and download preserve bytes with and without the Part 10 DICM prefix', async () => {
  await withHttp(async ({ base, pool }) => {
    const instances = [Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from([2, 0, 0, 0])]), Buffer.from([8, 0, 22, 0, 85, 73, 68, 0])];
    for (const bytes of instances) {
      const response = await fetch(`${base}/api/estudios/5/documentos`, { method: 'POST', headers: { cookie }, body: multipart(bytes, 'instance.dcm', 'application/dicom') });
      assert.equal(response.status, 201);
      const data = (await response.json()).data;
      assert.equal(data.sha256, sha(bytes));
      const saved = pool.documents.get(data.id);
      assert.equal(saved.mime_type, 'application/dicom');
      const downloaded = await fetch(`${base}/api/documentos/${data.id}/download`, { headers: { cookie } });
      assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
    }
  }, ['documents.upload', 'documents.download']);
});
