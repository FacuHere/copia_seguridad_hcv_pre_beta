const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { cleanupOrphanStaging, finishDelete, finishReplacement, recoverOperations, prepareRenameInTransaction, assertRenameDoesNotAffectDocuments } = require('../src/services/document-operations');
const { state: storageReadiness } = require('../src/services/storage-readiness');

async function withRoot(run) {
  const root = await fs.mkdtemp(path.join(__dirname, '.hcv-ops-test-'));
  try { await run(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fakePool({ operations = [], documents = [], failDocumentUpdate = false, comprobarAntesDeEliminar } = {}) {
  const events = [];
  const run = async (sql, params = []) => {
    const statement = sql.replace(/\s+/g, ' ').trim();
    if (statement.startsWith('SELECT * FROM document_file_operations')) return operations.filter(row => ['prepared', 'filesystem_applied'].includes(row.operation_state) || (row.operation_state === 'completed' && row.backup_key)).map(row => ({ ...row }));
    if (statement.startsWith('SELECT staging_key, backup_key FROM document_file_operations')) return operations.filter(row => ['prepared', 'filesystem_applied'].includes(row.operation_state)).map(row => ({ ...row }));
    if (statement.startsWith('SELECT operation_state FROM document_file_operations')) return operations.filter(row => row.operation_id === params[0]).map(row => ({ operation_state: row.operation_state }));
    if (statement.startsWith('SELECT operation_state, staging_key, backup_key FROM document_file_operations')) return operations.filter(row => row.operation_id === params[0]).map(row => ({ ...row }));
    if (statement.startsWith('UPDATE document_file_operations SET staging_key = NULL, backup_key = NULL')) {
      const row = operations.find(item => item.operation_id === params[0] && item.operation_state === 'completed');
      if (!row) return { affectedRows: 0 };
      row.staging_key = null; row.backup_key = null;
      return { affectedRows: 1 };
    }
    if (statement.startsWith('UPDATE document_file_operations SET operation_state = \'filesystem_applied\'')) {
      const row = operations.find(item => item.operation_id === params[0]);
      if (row?.operation_state === 'prepared') { row.operation_state = 'filesystem_applied'; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (statement.startsWith('UPDATE documents SET storage_key =')) {
      if (failDocumentUpdate) return { affectedRows: 0 };
      const row = documents.find(item => String(item.id) === String(params[6]));
      if (!row || row.file_status !== 'replacing') return { affectedRows: 0 };
      Object.assign(row, { storage_key: params[0], original_name: params[1], mime_type: params[2], size_bytes: params[3], sha256: params[4], updated_by: params[5], file_status: 'active' });
      return { affectedRows: 1 };
    }
    if (statement.startsWith("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'pending'")) {
      const row = documents.find(item => String(item.id) === String(params[0]));
      if (!row || row.file_status !== 'pending') return { affectedRows: 0 };
      row.file_status = 'active'; return { affectedRows: 1 };
    }
    if (statement.startsWith('DELETE FROM documents')) {
      if (comprobarAntesDeEliminar) await comprobarAntesDeEliminar();
      const index = documents.findIndex(item => String(item.id) === String(params[0]) && item.file_status === 'deleting');
      if (index < 0) return { affectedRows: 0 };
      documents.splice(index, 1); return { affectedRows: 1 };
    }
    if (statement.startsWith('INSERT INTO audit_events')) { events.push({ sql: statement, params }); return { affectedRows: 1 }; }
    if (statement.startsWith('UPDATE document_file_operations SET operation_state = \'completed\'')) {
      const row = operations.find(item => item.operation_id === params[0]);
      if (!row || !['prepared', 'filesystem_applied'].includes(row.operation_state)) return { affectedRows: 0 };
      row.operation_state = 'completed'; return { affectedRows: 1 };
    }
    if (statement.startsWith('UPDATE document_file_operations SET operation_state = \'failed\'')) {
      const row = operations.find(item => item.operation_id === params[1]);
      if (row) row.operation_state = 'failed';
      return { affectedRows: row ? 1 : 0 };
    }
    if (statement.startsWith('UPDATE documents SET file_status = \'active\'')) {
      const row = documents.find(item => String(item.id) === String(params[0]));
      if (row) row.file_status = 'active';
      return { affectedRows: row ? 1 : 0 };
    }
    if (statement.startsWith('DELETE FROM documents')) return { affectedRows: 0 };
    if (statement.startsWith('SELECT storage_key, size_bytes, sha256 FROM documents')) {
      const row = documents.find(item => String(item.id) === String(params[0]) && item.file_status === 'moving');
      return row ? [{ ...row }] : [];
    }
    if (statement.startsWith('SELECT id, storage_key, file_status FROM documents WHERE')) {
      const patientScope = statement.includes('patient_id = ?');
      const rows = documents.filter(item => String(item[patientScope ? 'patient_id' : 'study_id']) === String(params[0]));
      return rows.map(({ id, storage_key, file_status }) => ({ id, storage_key, file_status }));
    }
    if (statement.startsWith('UPDATE documents SET storage_key = ?, file_status = \'moving\'')) {
      const row = documents.find(item => String(item.id) === String(params[1]) && item.file_status === 'active');
      if (!row) return { affectedRows: 0 };
      row.storage_key = params[0]; row.file_status = 'moving'; return { affectedRows: 1 };
    }
    if (statement.startsWith("UPDATE documents SET file_status = 'active' WHERE id = ? AND file_status = 'moving'")) {
      const row = documents.find(item => String(item.id) === String(params[0]) && item.file_status === 'moving');
      if (!row) return { affectedRows: 0 };
      row.file_status = 'active'; return { affectedRows: 1 };
    }
    if (statement.startsWith('UPDATE documents SET file_status = \'active\'')) return { affectedRows: 1 };
    if (statement.startsWith('UPDATE document_file_operations')) return { affectedRows: 1 };
    events.push({ sql: statement, params });
    return { affectedRows: 1 };
  };
  return {
    events,
    operations,
    documents,
    query: run,
    async getConnection() { return { query: run, beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {} }; },
  };
}

test('orphan staging cleanup preserves journaled files and removes known untracked temporary files', async () => {
  await withRoot(async root => {
    await fs.mkdir(path.join(root, '.staging'), { recursive: true });
    const activeName = '11111111-1111-4111-8111-111111111111.part';
    const oldName = '22222222-2222-4222-8222-222222222222.part';
    const recentName = '33333333-3333-4333-8333-333333333333.old';
    const legacyLease = path.join(root, '.staging', '.service.lock');
    await Promise.all([activeName, oldName, recentName].map(name => fs.writeFile(path.join(root, '.staging', name), 'x')));
    await fs.writeFile(legacyLease, 'legacy marker; leave untouched');
    const pool = fakePool({ operations: [{ operation_state: 'prepared', staging_key: `.staging/${activeName}`, backup_key: null }] });
    const outcomes = await cleanupOrphanStaging(pool, root);
    assert.equal(outcomes.find(item => item.key === `.staging/${activeName}`).outcome, 'preserved_active');
    assert.equal(outcomes.find(item => item.key === `.staging/${oldName}`).outcome, 'orphan_removed');
    assert.equal(outcomes.find(item => item.key === `.staging/${recentName}`).outcome, 'orphan_removed');
    await assert.rejects(fs.stat(path.join(root, '.staging', oldName)), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(root, '.staging', recentName)), { code: 'ENOENT' });
    await fs.access(path.join(root, '.staging', activeName));
    await fs.access(legacyLease);
  });
});

test('unknown staging entries require attention and remain untouched', async () => {
  await withRoot(async root => {
    const target = path.join(root, '.staging', 'unexpected.tmp');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'preserve');
    const outcomes = await cleanupOrphanStaging(fakePool(), root);
    assert.equal(outcomes[0].outcome, 'needs_attention');
    assert.equal(outcomes[0].reason, 'UNRECOGNIZED_STAGING_ENTRY');
    await fs.access(target);
  });
});

test('label changes with documents stop while document recovery is blocked', async () => {
  const previous = { ...storageReadiness };
  storageReadiness.status = 'blocked';
  const statements = [];
  const connection = { async query(sql) {
    statements.push(sql.replace(/\s+/g, ' ').trim());
    if (statements.at(-1).startsWith('SELECT id, storage_key, file_status FROM documents')) {
      return [{ id: '1', storage_key: 'Pacientes/P-1/Estudios/E-2/a.pdf', file_status: 'active' }];
    }
    throw new Error(`Unexpected SQL: ${statements.at(-1)}`);
  } };
  try {
    await assert.rejects(prepareRenameInTransaction(connection, {
      type: 'rename_patient', patientId: '1', oldPrefix: 'Pacientes/P-1', newPrefix: 'Pacientes/P-1-new', actorUserId: '8',
    }), { code: 'STORAGE_RECOVERY_REQUIRED' });
    assert.equal(statements.length, 1);
  } finally {
    Object.assign(storageReadiness, previous);
  }
});

test('delete recovery physically removes a journaled file before deleting its database row', async () => {
  await withRoot(async root => {
    const content = Buffer.from('delete only after recorded intent');
    const oldKey = 'Pacientes/P-1/Estudios/E-2/D-3.pdf';
    const backupKey = '.staging/44444444-4444-4444-8444-444444444444.deleted';
    const backupPath = path.join(root, ...backupKey.split('/'));
    await fs.mkdir(path.dirname(backupPath), { recursive: true });
    await fs.writeFile(backupPath, content);
    const operation = { operation_id: 'op1', operation_type: 'delete', operation_state: 'prepared', document_id: '3', patient_id: '1', study_id: '2', old_storage_key: oldKey, backup_key: backupKey, old_sha256: digest(content), actor_user_id: '9' };
    const doc = { id: '3', file_status: 'deleting' };
    const pool = fakePool({ operations: [operation], documents: [doc] });
    await finishDelete(pool, root, operation);
    assert.equal(pool.documents.length, 0);
    await assert.rejects(fs.stat(backupPath), { code: 'ENOENT' });
    assert.equal(operation.operation_state, 'completed');
    assert.equal(operation.backup_key, null);
    assert.ok(pool.events.some(event => event.sql.startsWith('INSERT INTO audit_events')));
  });
});

test('delete recovery refuses to erase metadata when both physical locations are unexpectedly missing', async () => {
  await withRoot(async root => {
    const operation = { operation_id: 'op2', operation_type: 'delete', operation_state: 'prepared', document_id: '4', patient_id: '1', study_id: '2', old_storage_key: 'old.pdf', backup_key: '.staging/55555555-5555-4555-8555-555555555555.deleted', actor_user_id: '9' };
    const pool = fakePool({ operations: [operation], documents: [{ id: '4', file_status: 'deleting' }] });
    const result = await recoverOperations(pool, root);
    assert.equal(result[0].outcome, 'needs_attention');
    assert.equal(pool.documents.length, 1);
    assert.equal(operation.operation_state, 'prepared');
  });
});

test('replacement recovery keeps the original document id and validates final bytes before finalizing', async () => {
  await withRoot(async root => {
    const old = Buffer.from('old content');
    const fresh = Buffer.from('new content');
    const oldKey = 'Pacientes/P-1/Estudios/E-2/D-3 - old.pdf';
    const newKey = 'Pacientes/P-1/Estudios/E-2/D-3 - new.pdf';
    const stagedKey = '.staging/66666666-6666-4666-8666-666666666666.part';
    const backupKey = '.staging/77777777-7777-4777-8777-777777777777.old';
    const put = async (key, bytes) => { const p = path.join(root, ...key.split('/')); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, bytes); };
    await put(oldKey, old); await put(stagedKey, fresh);
    const operation = { operation_id: 'op3', operation_type: 'replace', operation_state: 'prepared', document_id: '3', patient_id: '1', study_id: '2', staging_key: stagedKey, backup_key: backupKey, old_storage_key: oldKey, new_storage_key: newKey, old_sha256: digest(old), sha256: digest(fresh), size_bytes: fresh.length, original_name: 'new.pdf', mime_type: 'application/pdf', actor_user_id: '9' };
    const document = { id: '3', file_status: 'replacing' };
    const pool = fakePool({ operations: [operation], documents: [document] });
    const result = await recoverOperations(pool, root);
    assert.equal(result[0].outcome, 'completed', JSON.stringify(result));
    assert.equal(document.id, '3');
    assert.equal(document.storage_key, newKey);
    assert.equal(document.sha256, digest(fresh));
    assert.deepEqual(await fs.readFile(path.join(root, ...newKey.split('/'))), fresh);
    await assert.rejects(fs.stat(path.join(root, ...backupKey.split('/'))), { code: 'ENOENT' });
    assert.equal(operation.backup_key, null);
    assert.equal(operation.staging_key, null);
  });
});

test('la eliminación normal con claves camelCase borra el archivo antes de eliminar los metadatos', async () => {
  await withRoot(async root => {
    const bytes = Buffer.from('archivo sintetico para eliminar');
    const claveTemporal = '.staging/55555555-5555-4555-8555-555555555555.deleted';
    const rutaTemporal = path.join(root, ...claveTemporal.split('/'));
    await fs.mkdir(path.dirname(rutaTemporal), { recursive: true });
    await fs.writeFile(rutaTemporal, bytes);
    const fila = { operation_id: 'eliminar-normal', operation_state: 'filesystem_applied', backup_key: claveTemporal };
    let eliminadoAntesDeLosMetadatos = false;
    const pool = fakePool({
      operations: [fila], documents: [{ id: '7', file_status: 'deleting' }],
      async comprobarAntesDeEliminar() {
        await assert.rejects(fs.stat(rutaTemporal), { code: 'ENOENT' });
        eliminadoAntesDeLosMetadatos = true;
      },
    });
    await finishDelete(pool, root, { operationId: fila.operation_id, documentId: '7', patientId: '1', studyId: '2',
      actorId: '9', oldKey: 'anterior.pdf', backupKey: claveTemporal, oldSha256: digest(bytes), operation_state: 'filesystem_applied' });
    assert.equal(eliminadoAntesDeLosMetadatos, true);
    assert.equal(pool.documents.length, 0);
    assert.equal(fila.backup_key, null);
  });
});

test('la recuperación limpia referencias completed históricas con o sin una copia física residual', async () => {
  for (const existeCopia of [true, false]) {
    await withRoot(async root => {
      const claveTemporal = '.staging/66666666-6666-4666-8666-666666666666.old';
      const rutaTemporal = path.join(root, ...claveTemporal.split('/'));
      await fs.mkdir(path.dirname(rutaTemporal), { recursive: true });
      if (existeCopia) await fs.writeFile(rutaTemporal, 'copia anterior sintetica');
      const operacion = { operation_id: 'historica', operation_state: 'completed', operation_type: 'replace', backup_key: claveTemporal, staging_key: null };
      const pool = fakePool({ operations: [operacion] });
      const resultados = await recoverOperations(pool, root);
      assert.equal(resultados[0].outcome, 'cleanup_completed');
      assert.equal(operacion.backup_key, null);
      assert.equal(operacion.operation_state, 'completed');
      await assert.rejects(fs.stat(rutaTemporal), { code: 'ENOENT' });
      assert.deepEqual(await recoverOperations(pool, root), []);
    });
  }
});

test('un fallo de eliminación física conserva la referencia completed para reintentar su limpieza', async () => {
  await withRoot(async root => {
    const claveTemporal = '.staging/77777777-7777-4777-8777-777777777777.old';
    const rutaTemporal = path.join(root, ...claveTemporal.split('/'));
    await fs.mkdir(rutaTemporal, { recursive: true });
    const operacion = { operation_id: 'limpieza-fallida', operation_type: 'replace', operation_state: 'completed', backup_key: claveTemporal };
    const pool = fakePool({ operations: [operacion] });
    assert.equal((await recoverOperations(pool, root))[0].outcome, 'needs_attention');
    assert.equal(operacion.backup_key, claveTemporal);
    assert.equal(operacion.operation_state, 'completed');
    await fs.access(rutaTemporal);
  });
});

test('replacement does not discard its old physical copy when MariaDB refuses the metadata update', async () => {
  await withRoot(async root => {
    const fresh = Buffer.from('verified replacement');
    const newKey = 'Pacientes/P-1/Estudios/E-2/D-3 - newer.pdf';
    const backupKey = '.staging/88888888-8888-4888-8888-888888888888.old';
    const put = async (key, bytes) => { const p = path.join(root, ...key.split('/')); await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, bytes); };
    await put(newKey, fresh);
    await put(backupKey, Buffer.from('original retained'));
    const operation = { operation_id: 'op4', operation_state: 'filesystem_applied', document_id: '3', new_storage_key: newKey, original_name: 'newer.pdf', mime_type: 'application/pdf', size_bytes: fresh.length, sha256: digest(fresh), old_sha256: digest(Buffer.from('original retained')), actor_user_id: '9' };
    const document = { id: '3', file_status: 'replacing' };
    const pool = fakePool({ operations: [operation], documents: [document], failDocumentUpdate: true });
    await assert.rejects(finishReplacement(pool, root, operation), error => error.code === 'DOCUMENT_OPERATION_ROW_MISMATCH_FINALIZE_REPLACEMENT');
    assert.equal(document.file_status, 'replacing');
    await fs.access(path.join(root, ...backupKey.split('/')));
    assert.equal(pool.events.some(event => event.sql.startsWith('INSERT INTO audit_events')), false);
  });
});

test('upload recovery verifies staged bytes, installs them, then activates the database row', async () => {
  await withRoot(async root => {
    const bytes = Buffer.from('%PDF-1.7\nrecover upload');
    const stagingKey = '.staging/99999999-9999-4999-8999-999999999999.part';
    const newKey = 'Pacientes/P-1/Estudios/E-2/D-10 - report.pdf';
    const stagePath = path.join(root, ...stagingKey.split('/'));
    await fs.mkdir(path.dirname(stagePath), { recursive: true });
    await fs.writeFile(stagePath, bytes);
    const operation = { operation_id: 'op5', operation_type: 'upload', operation_state: 'prepared', document_id: '10', patient_id: '1', study_id: '2', staging_key: stagingKey, new_storage_key: newKey, original_name: 'report.pdf', mime_type: 'application/pdf', size_bytes: bytes.length, sha256: digest(bytes), actor_user_id: '9' };
    const document = { id: '10', file_status: 'pending' };
    const pool = fakePool({ operations: [operation], documents: [document] });
    const outcomes = await recoverOperations(pool, root);
    assert.equal(outcomes[0].outcome, 'completed');
    assert.equal(document.file_status, 'active');
    assert.equal(operation.operation_state, 'completed');
    assert.deepEqual(await fs.readFile(path.join(root, ...newKey.split('/'))), bytes);
    await assert.rejects(fs.stat(stagePath), { code: 'ENOENT' });
  });
});

test('label change journal and document moving keys are prepared inside the caller transaction before its metadata update', async () => {
  const statements = [];
  const document = { id: '31', patient_id: '4', storage_key: 'Pacientes/P-4-old/Estudios/E-8/test.pdf', file_status: 'active' };
  const connection = { async query(sql, params) {
    const statement = sql.replace(/\s+/g, ' ').trim(); statements.push(statement);
    if (statement.startsWith('SELECT id, storage_key, file_status FROM documents')) return [{ id: document.id, storage_key: document.storage_key, file_status: document.file_status }];
    if (statement.startsWith('INSERT INTO document_file_operations')) return { affectedRows: 1 };
    if (statement.startsWith('UPDATE documents SET storage_key = ?, file_status')) { document.storage_key = params[0]; document.file_status = 'moving'; return { affectedRows: 1 }; }
    if (statement.startsWith('UPDATE patients SET')) return { affectedRows: 1 };
    throw new Error(`Unexpected SQL: ${statement}`);
  } };
  const operation = await prepareRenameInTransaction(connection, { type: 'rename_patient', patientId: '4', oldPrefix: 'Pacientes/P-4-old', newPrefix: 'Pacientes/P-4-new', actorUserId: '9' });
  await connection.query('UPDATE patients SET full_name = ? WHERE id = ?', ['New', '4']);
  assert.ok(operation.operation_id);
  assert.equal(document.file_status, 'moving');
  assert.ok(statements.findIndex(sql => sql.startsWith('INSERT INTO document_file_operations')) < statements.findIndex(sql => sql.startsWith('UPDATE patients SET')));
});

test('label changes without a configured repository are refused when the scope has documents', async () => {
  let patientUpdated = false;
  const connection = { async query(sql) {
    if (sql.startsWith('SELECT id FROM documents')) return [{ id: '31' }];
    if (sql.startsWith('UPDATE patients')) { patientUpdated = true; return { affectedRows: 1 }; }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  await assert.rejects(assertRenameDoesNotAffectDocuments(connection, { type: 'rename_patient', scopeId: '4' }), { code: 'FILE_STORAGE_NOT_CONFIGURED_FOR_RENAME' });
  assert.equal(patientUpdated, false);
});

test('recovery completes a prepared folder move after restart without replacing conflicting files', async () => {
  await withRoot(async root => {
    const bytes = Buffer.from('preserve through interrupted patient label move');
    const oldPrefix = 'Pacientes/P-4-old'; const newPrefix = 'Pacientes/P-4-new';
    const oldKey = `${oldPrefix}/Estudios/E-8/D-31 - report.pdf`;
    const newKey = `${newPrefix}/Estudios/E-8/D-31 - report.pdf`;
    const oldPath = path.join(root, ...oldKey.split('/'));
    await fs.mkdir(path.dirname(oldPath), { recursive: true }); await fs.writeFile(oldPath, bytes);
    const operation = { operation_id: 'rename1', operation_type: 'rename_patient', operation_state: 'prepared', patient_id: '4', study_id: null, old_prefix: oldPrefix, new_prefix: newPrefix, actor_user_id: '9' };
    const document = { id: '31', patient_id: '4', study_id: '8', storage_key: newKey, file_status: 'moving', size_bytes: bytes.length, sha256: digest(bytes) };
    const pool = fakePool({ operations: [operation], documents: [document] });
    const outcomes = await recoverOperations(pool, root);
    assert.equal(outcomes[0].outcome, 'completed');
    assert.equal(document.file_status, 'active');
    assert.equal(operation.operation_state, 'completed');
    assert.deepEqual(await fs.readFile(path.join(root, ...newKey.split('/'))), bytes);
    await assert.rejects(fs.stat(oldPath), { code: 'ENOENT' });
  });
});
