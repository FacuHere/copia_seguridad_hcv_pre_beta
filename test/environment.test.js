const test = require('node:test');
const assert = require('node:assert/strict');
const { readPort, readHost } = require('../src/config/environment');
const database = require('../src/config/database');

function withEnv(name, value, fn) {
  const original = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
}

test('readPort accepts a complete valid port and rejects partial or out-of-range values', () => {
  assert.equal(withEnv('PORT', '3000', () => readPort('PORT', 80)), 3000);
  assert.equal(withEnv('DB_PORT', '3306', () => readPort('DB_PORT', 3000)), 3306);
  assert.throws(() => withEnv('PORT', '3000abc', () => readPort('PORT', 80)), /número de puerto válido/);
  assert.throws(() => withEnv('DB_PORT', '3306abc', () => readPort('DB_PORT', 3000)), /número de puerto válido/);
  assert.throws(() => withEnv('PORT', '0', () => readPort('PORT', 80)), /entre 1 y 65535/);
  assert.throws(() => withEnv('PORT', '65536', () => readPort('PORT', 80)), /entre 1 y 65535/);
});

test('readHost accepts loopback and LAN bind addresses and rejects malformed values', () => {
  assert.equal(withEnv('HOST', '127.0.0.1', () => readHost()), '127.0.0.1');
  assert.equal(withEnv('HOST', '0.0.0.0', () => readHost()), '0.0.0.0');
  assert.equal(withEnv('HOST', 'hospital.example.org', () => readHost()), 'hospital.example.org');
  assert.throws(() => withEnv('HOST', 'host/path', () => readHost()), /nombre de host válido/);
  assert.throws(() => withEnv('HOST', '-bad.example', () => readHost()), /nombre de host válido/);
});

test('application database pool refuses the MariaDB root account', () => {
  withEnv('DB_PORT', '3306', () => withEnv('DB_USER', 'root', () => {
    assert.throws(() => database.getPool(), /DB_USER no puede ser root/);
  }));
});
