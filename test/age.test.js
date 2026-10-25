const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Las fechas recibidas por la interfaz son YYYY-MM-DD; UTC evita que sus
// getters locales varíen según la zona horaria de la máquina que ejecuta tests.
process.env.TZ = 'UTC';

const appSource = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const ageSource = appSource.match(/^function age\(birthDate\) \{[^\r\n]*\}$/m)?.[0];

assert.ok(ageSource, 'Debe encontrarse la declaración local de age() en app.js');

function ageAt(birthDate, today) {
  class ControlledDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [today]));
    }
  }

  const context = vm.createContext({ Date: ControlledDate });
  return vm.runInContext(`${ageSource}\nage`, context)(birthDate);
}

test('age calcula la edad cuando el cumpleaños ya ocurrió este año', () => {
  assert.equal(ageAt('1990-05-10', '2026-05-11T12:00:00Z'), '36 años');
});

test('age resta un año cuando el cumpleaños todavía no ocurrió', () => {
  assert.equal(ageAt('1990-11-10', '2026-11-09T12:00:00Z'), '35 años');
});

test('age considera cumplidos los años en el día del cumpleaños', () => {
  assert.equal(ageAt('2000-04-15', '2026-04-15T12:00:00Z'), '26 años');
});

test('age refleja el cambio de año alrededor del cumpleaños', () => {
  assert.equal(ageAt('2000-01-01', '2025-12-31T12:00:00Z'), '25 años');
  assert.equal(ageAt('2000-01-01', '2026-01-01T12:00:00Z'), '26 años');
});

test('age trata el cumpleaños del 29 de febrero según la normalización de Date', () => {
  assert.equal(ageAt('2000-02-29', '2025-02-28T12:00:00Z'), '24 años');
  assert.equal(ageAt('2000-02-29', '2025-03-01T12:00:00Z'), '25 años');
});

test('age devuelve una cadena vacía para fechas vacías o ausentes', () => {
  assert.equal(ageAt('', '2026-01-01T12:00:00Z'), '');
  assert.equal(ageAt(undefined, '2026-01-01T12:00:00Z'), '');
  assert.equal(ageAt(null, '2026-01-01T12:00:00Z'), '');
});
