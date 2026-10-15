const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { app, storageReadiness } = require('../src/server');
const { requireStorageReady } = require('../src/services/storage-readiness');

test('degraded storage keeps diagnostics and storage-independent APIs available over HTTP', async () => {
  const previous = { ...storageReadiness };
  storageReadiness.status = 'blocked';
  storageReadiness.message = 'Synthetic recovery failure';
  storageReadiness.operations = [{ operationId: 'synthetic-op', errorCode: 'RECOVERY_FAILED' }];
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const diagnostic = await fetch(`${base}/api/health/storage`);
    assert.equal(diagnostic.status, 503);
    assert.equal((await diagnostic.json()).operations[0].operationId, 'synthetic-op');
    const authRequired = await fetch(`${base}/api/pacientes`);
    assert.equal(authRequired.status, 401);
    assert.notEqual((await authRequired.json()).error.code, 'STORAGE_RECOVERY_REQUIRED');
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(storageReadiness, previous);
  }
});

test('storage health reports not_configured as unavailable without mislabeling it ready', async () => {
  const previous = { ...storageReadiness };
  storageReadiness.status = 'not_configured';
  storageReadiness.message = 'Storage configuration absent';
  storageReadiness.operations = [];
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/health/storage`);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).status, 'not_configured');
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(storageReadiness, previous);
  }
});

test('storage-dependent routes return 503 while recovery is blocked and resume when ready', async () => {
  const previous = { ...storageReadiness };
  const isolated = express();
  isolated.get('/document-content', requireStorageReady, (_req, res) => res.status(200).json({ ok: true }));
  const server = await new Promise(resolve => { const listener = isolated.listen(0, '127.0.0.1', () => resolve(listener)); });
  try {
    const url = `http://127.0.0.1:${server.address().port}/document-content`;
    storageReadiness.status = 'blocked';
    const blocked = await fetch(url);
    assert.equal(blocked.status, 503);
    assert.equal((await blocked.json()).error.code, 'STORAGE_RECOVERY_REQUIRED');
    storageReadiness.status = 'ready';
    const ready = await fetch(url);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { ok: true });
  } finally {
    await new Promise(resolve => server.close(resolve));
    Object.assign(storageReadiness, previous);
  }
});
