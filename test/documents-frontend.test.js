const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public/styles.css'), 'utf8');

test('study form uploads the selected synthetic images after saving study metadata', () => {
  assert.match(html, /name="images"[^>]*multiple/);
  assert.match(html, /JPG, PNG, GIF y WEBP/);
  assert.doesNotMatch(html, /por ahora no se guardan|disponible en una etapa posterior/i);
  const start = app.indexOf("$('#studyForm').addEventListener('submit'");
  const end = app.indexOf("document.querySelectorAll('.tab')", start);
  assert.ok(start >= 0 && end > start);
  const submit = app.slice(start, end);
  assert.match(submit, /Array\.from\(form\.elements\.images\.files/);
  assert.ok(submit.indexOf("method: editingStudy ? 'PUT' : 'POST'") < submit.indexOf('uploadStudyDocument(savedStudyId, file)'));
  assert.match(submit, /refreshDocuments\(savedStudyId\)/);
  assert.match(submit, /Se cargaron y verificaron/);
});

test('Cargar archivo and replacement accept the supported document formats and report server errors', () => {
  assert.match(app, /data-document-input=/);
  assert.match(app, /data-replace-input=/);
  assert.match(app, /\.docx/);
  assert.match(app, /application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/);
  assert.match(app, /uploadStudyDocument\(input\.dataset\.documentInput, file\)/);
  assert.match(app, /error\.messageFromApi/);
  assert.match(app, /no se pudo verificar el listado/i);
});

test('images are previewed through the authenticated document endpoint after listing', () => {
  assert.match(app, /class="document-preview"/);
  assert.match(app, /\/api\/documentos\/' \+ id \+ '\/content/);
  assert.match(styles, /\.document-preview\{/);
});
