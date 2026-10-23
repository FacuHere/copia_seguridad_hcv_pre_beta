const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8');
const patientRoute = fs.readFileSync(path.join(__dirname, '../src/routes/patients.js'), 'utf8');

test('patient and study forms keep required fields and separate submit from cancellation', () => {
  const dialogMatches = [...html.matchAll(/<dialog\b[\s\S]*?<\/dialog>/g)];
  assert.equal(dialogMatches.length, 2);

  for (const match of dialogMatches) {
    const dialog = match[0];
    const cancelButtons = [...dialog.matchAll(/<button\b[^>]*data-dialog-cancel[^>]*>/g)];
    assert.equal(cancelButtons.length, 2);
    assert.ok(cancelButtons.every(([tag]) => /\btype="button"/.test(tag)));
    const submitButtons = [...dialog.matchAll(/<button\b[^>]*type="submit"[^>]*>/g)];
    assert.equal(submitButtons.length, 1);
  }

  for (const field of ['fullName', 'date']) {
    const input = new RegExp(`<input\\b(?=[^>]*\\bname="${field}")(?=[^>]*\\brequired)[^>]*>`);
    assert.match(html, input);
  }

  const cancelHandler = app.match(/document\.querySelectorAll\('\[data-dialog-cancel\]'\)([\s\S]*?)\$\('#patientForm'\)/)?.[0];
  assert.ok(cancelHandler);
  assert.match(cancelHandler, /\.reset\(\)/);
  assert.match(cancelHandler, /\.close\(\)/);
  assert.doesNotMatch(cancelHandler, /apiRequest|FormData|save\(|requestSubmit|dispatchEvent|\.submit\(/);
  assert.doesNotMatch(html, /tablesPanel|tableDialog|tableForm|tableList|newTable|data-tab="tables"/);
  assert.doesNotMatch(app, /PATIENT_MODULES_KEY|patientModules|\.tables|addRow\(|localStorage|showDirectoryPicker|createLocalBackup|saveToFolder/);
});

test('future backup, user management, and report buttons remain inert controls', () => {
  for (const [id, label] of [['chooseFolder', 'BACKUP'], ['importData', 'Gestión de usuarios'], ['exportData', 'Reportes']]) {
    const button = new RegExp(`<button\\b(?=[^>]*\\bid="${id}")(?=[^>]*\\btype="button")[^>]*>${label}<\\/button>`);
    assert.match(html, button);
  }
  assert.doesNotMatch(html, /id="importData"[^>]*type="file"|id="exportData"[^>]*type="submit"|id="chooseFolder"[^>]*type="submit"/);
  assert.doesNotMatch(app, /\$\('#(?:chooseFolder|importData|exportData)'\)/);
  assert.match(html, /reservado para futuras funciones de copia de seguridad/i);
  assert.match(html, /reservado para futuras funciones de administración de usuarios/i);
  assert.match(html, /reservado para futuras funciones de generación y consulta de informes/i);
});

test('patient records are loaded and saved through the existing REST routes, not localStorage', () => {
  assert.match(app, /apiRequest\(`\/api\/pacientes\?\$\{params\}`\)/);
  assert.match(app, /apiRequest\(`\/api\/pacientes\/\$\{encodeURIComponent\(requestedId\)\}`\)/);
  assert.match(app, /method: editingId \? 'PUT' : 'POST'/);
  assert.doesNotMatch(app, /db\.patients/);
  const patientSubmitStart = app.indexOf("$('#patientForm').addEventListener('submit'");
  const patientSubmitEnd = app.indexOf("$('#newStudy').onclick", patientSubmitStart);
  assert.notEqual(patientSubmitStart, -1);
  assert.notEqual(patientSubmitEnd, -1);
  const patientSubmitHandler = app.slice(patientSubmitStart, patientSubmitEnd);
  assert.doesNotMatch(patientSubmitHandler, /localStorage|PATIENT_MODULES_KEY|save\(/);
  assert.match(app, /credentials: 'same-origin'/);
  assert.match(patientRoute, /id: String\(row\.id\)/);
  assert.match(patientRoute, /id: String\(rows\[0\]\.id\)/);
});
