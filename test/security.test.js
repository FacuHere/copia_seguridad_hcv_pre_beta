const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../src/utils/passwords');
const database = require('../src/config/database');
const requirePermission = require('../src/middleware/require-permission');

test('scrypt hashes verify the correct password and reject an incorrect password', async () => {
  const encoded = await hashPassword('correct horse battery staple');
  assert.match(encoded, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyPassword('incorrect password', encoded), false);
});

test('role permissions authorize explicitly granted operations without service scope', async () => {
  const originalGetPool = database.getPool;
  const grants = new Set([
    'viewer:patients.read',
    'administrator:patients.read',
    'administrator:patients.create',
    'administrator:patients.update',
  ]);
  let lastQuery;

  database.getPool = () => ({
    query: async (sql, parameters) => {
      lastQuery = { sql, parameters };
      assert.doesNotMatch(sql, /user_services|role_service_permissions|\bservices\b/i);
      return grants.has(`${parameters[0]}:${parameters[1]}`) ? [{}] : [];
    },
  });

  async function authorize(userId, permissionCode) {
    let nextCalled = false;
    const response = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const request = userId === null ? {} : { auth: { user: { id: userId } } };
    await requirePermission(permissionCode)(request, response, () => { nextCalled = true; });
    return { response, nextCalled };
  }

  try {
    const unauthenticated = await authorize(null, 'patients.read');
    assert.equal(unauthenticated.response.statusCode, 401);
    assert.equal(unauthenticated.response.body.error.code, 'UNAUTHENTICATED');
    assert.equal(unauthenticated.nextCalled, false);
    assert.equal(lastQuery, undefined);

    const viewerRead = await authorize('viewer', 'patients.read');
    assert.equal(viewerRead.response.statusCode, 200);
    assert.equal(viewerRead.nextCalled, true);
    assert.deepEqual(lastQuery.parameters, ['viewer', 'patients.read']);

    for (const permission of ['patients.create', 'patients.update']) {
      const viewerWrite = await authorize('viewer', permission);
      assert.equal(viewerWrite.response.statusCode, 403);
      assert.equal(viewerWrite.response.body.error.code, 'FORBIDDEN');
      assert.equal(viewerWrite.nextCalled, false);
    }

    for (const permission of ['patients.read', 'patients.create', 'patients.update']) {
      const adminAccess = await authorize('administrator', permission);
      assert.equal(adminAccess.response.statusCode, 200);
      assert.equal(adminAccess.nextCalled, true);
    }

    const userWithoutPermission = await authorize('no-role-or-grant', 'patients.read');
    assert.equal(userWithoutPermission.response.statusCode, 403);
    assert.equal(userWithoutPermission.response.body.error.code, 'FORBIDDEN');
    assert.equal(userWithoutPermission.nextCalled, false);

    const deniedClinicalPermission = await authorize('viewer', 'studies.create');
    assert.equal(deniedClinicalPermission.response.statusCode, 403);
    assert.notEqual(deniedClinicalPermission.response.body.error.code, 'SERVICE_SCOPE_PENDING');
  } finally {
    database.getPool = originalGetPool;
  }
});
