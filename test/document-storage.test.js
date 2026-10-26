const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { PassThrough } = require('node:stream');
const { createHash } = require('node:crypto');
const {
  DocumentInputError, relativeDocumentKey, resolveStoragePath,
  receiveSingleFile, unlinkKey, mergeDirectoryPrefix, openRegularFile,
} = require('../src/services/document-storage');
const { readFileStorageConfig } = require('../src/config/file-storage');
const { makeDocxFixture } = require('./helpers/docx-fixture');

async function withRoot(run) {
  const testTempParent = path.join(__dirname, '.storage-test-temp');
  await fs.mkdir(testTempParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(testTempParent, 'hcv-document-test-'));
  try { await run(root); } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rmdir(testTempParent).catch(() => {});
  }
}

function multipartRequest(content, filename, mimeType = 'application/octet-stream') {
  const boundary = 'hcv-test-boundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const req = Readable.from([body]);
  req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
  return req;
}

test('private storage config requires absolute root and positive explicit upload limit', () => {
  assert.equal(readFileStorageConfig({}).uploadsEnabled, false);
  assert.throws(() => readFileStorageConfig({ FILE_STORAGE_ROOT: 'relative/path' }), /ruta absoluta/);
  assert.throws(() => readFileStorageConfig({ FILE_STORAGE_ROOT: path.join(__dirname, '..', 'public', 'files') }), /public/);
  assert.throws(() => readFileStorageConfig({ MAX_FILE_SIZE_BYTES: '0' }), /entero positivo/);
  assert.equal(readFileStorageConfig({ FILE_STORAGE_ROOT: path.join(os.tmpdir(), 'hcv-store'), MAX_FILE_SIZE_BYTES: '123' }).uploadsEnabled, true);
});

test('storage key uses stable numeric identities and rejects traversal', () => {
  const key = relativeDocumentKey({ patientId: 21n, patientDni: '12/34', patientName: 'Ana Pérez', studyId: 8n, studyDate: '2026-10-05', studyType: 'DICOM', documentId: 44n, originalName: 'image.dcm' });
  assert.match(key, /^Pacientes\/P-21 - /);
  assert.match(key, /\/Estudios\/E-8 - /);
  assert.match(key, /D-44 - image\.dcm$/);
  assert.throws(() => resolveStoragePath(os.tmpdir(), '../outside'), DocumentInputError);
  assert.throws(() => resolveStoragePath(os.tmpdir(), 'C:/outside'), DocumentInputError);
});

test('directory label moves merge safely and keep files under the repository', async () => {
  await withRoot(async root => {
    const oldPrefix = 'Pacientes/P-21 - 12 - Ana/Estudios/E-8 - 2026-10-05 - DICOM';
    const newPrefix = 'Pacientes/P-21 - 13 - Ana Perez/Estudios/E-8 - 2026-10-05 - DICOM';
    const oldFile = path.join(root, ...oldPrefix.split('/'), 'D-44 - image.dcm');
    await fs.mkdir(path.dirname(oldFile), { recursive: true });
    await fs.writeFile(oldFile, Buffer.from('dicom payload'));
    assert.equal(await mergeDirectoryPrefix(root, oldPrefix, newPrefix), true);
    assert.equal(await fs.readFile(path.join(root, ...newPrefix.split('/'), 'D-44 - image.dcm'), 'utf8'), 'dicom payload');
    await assert.rejects(fs.stat(path.join(root, ...oldPrefix.split('/'))), error => error.code === 'ENOENT');

    const oldAgain = path.join(root, ...oldPrefix.split('/'), 'D-44 - image.dcm');
    await fs.mkdir(path.dirname(oldAgain), { recursive: true });
    await fs.writeFile(oldAgain, Buffer.from('different bytes'));
    await assert.rejects(mergeDirectoryPrefix(root, oldPrefix, newPrefix), error => error.code === 'STORAGE_RENAME_COLLISION');
    assert.equal(await fs.readFile(oldAgain, 'utf8'), 'different bytes');
  });
});

test('single PDF and DICOM uploads are byte preserving and receive SHA-256 metadata in private staging', async () => {
  await withRoot(async root => {
    const pdf = Buffer.from('%PDF-1.7\nClinical test');
    const uploadedPdf = await receiveSingleFile(multipartRequest(pdf, 'informe.pdf', 'application/pdf'), root, 4096);
    assert.equal(uploadedPdf.sizeBytes, pdf.length);
    assert.equal(uploadedPdf.sha256, createHash('sha256').update(pdf).digest('hex'));
    assert.deepEqual(await fs.readFile(path.join(root, uploadedPdf.stagingKey)), pdf);
    await unlinkKey(root, uploadedPdf.stagingKey);

    const jpg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
    const uploadedJpg = await receiveSingleFile(multipartRequest(jpg, 'image.jpg', 'image/jpeg'), root, 4096);
    assert.equal(uploadedJpg.mimeType, 'image/jpeg');
    assert.deepEqual(await fs.readFile(path.join(root, uploadedJpg.stagingKey)), jpg);
    await unlinkKey(root, uploadedJpg.stagingKey);

    for (const dicom of [
      Buffer.concat([Buffer.alloc(128), Buffer.from('DICM'), Buffer.from([0x02, 0, 0, 0])]),
      Buffer.from([0x08, 0x00, 0x16, 0x00, 0x55, 0x49, 0x44, 0x00]),
    ]) {
      const uploadedDicom = await receiveSingleFile(multipartRequest(dicom, 'slice.dcm', 'application/dicom'), root, 4096);
      assert.equal(uploadedDicom.mimeType, 'application/dicom');
      assert.equal(uploadedDicom.sha256, createHash('sha256').update(dicom).digest('hex'));
      assert.deepEqual(await fs.readFile(path.join(root, uploadedDicom.stagingKey)), dicom);
      await unlinkKey(root, uploadedDicom.stagingKey);
    }
    await assert.rejects(receiveSingleFile(multipartRequest(Buffer.alloc(0), 'empty.dcm', 'application/dicom'), root, 4096), error => error.code === 'INVALID_DICOM_FILE');
  });
});

test('synthetic DOC and DOCX uploads preserve bytes, MIME metadata, and SHA-256', async () => {
  await withRoot(async root => {
    const docBytes = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.from('Synthetic legacy Word fixture'),
    ]);
    const doc = await receiveSingleFile(multipartRequest(docBytes, 'synthetic.doc', 'application/msword'), root, 4096);
    assert.equal(doc.mimeType, 'application/msword');
    assert.equal(doc.sha256, createHash('sha256').update(docBytes).digest('hex'));
    assert.deepEqual(await fs.readFile(path.join(root, doc.stagingKey)), docBytes);
    await unlinkKey(root, doc.stagingKey);

    const docxBytes = makeDocxFixture();
    const docx = await receiveSingleFile(multipartRequest(docxBytes, 'synthetic.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), root, 4096);
    assert.equal(docx.mimeType, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(docx.sha256, createHash('sha256').update(docxBytes).digest('hex'));
    assert.deepEqual(await fs.readFile(path.join(root, docx.stagingKey)), docxBytes);
    await unlinkKey(root, docx.stagingKey);

    await assert.rejects(receiveSingleFile(multipartRequest(Buffer.from('not an OLE Word file'), 'invalid.doc', 'application/msword'), root, 4096), error => error.code === 'INVALID_FILE_CONTENT');
    const fakeDocx = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('not a Word package')]);
    await assert.rejects(receiveSingleFile(multipartRequest(fakeDocx, 'invalid.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), root, 4096), error => error.code === 'INVALID_FILE_CONTENT');
    assert.deepEqual(await fs.readdir(path.join(root, '.staging')), []);
  });
});
test('la carga DOCX reconoce el documento principal aunque otros metadatos aparezcan antes', async () => {
  await withRoot(async root => {
    const contenido = makeDocxFixture({ otrasPartesPrimero: true });
    const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const recibido = await receiveSingleFile(multipartRequest(contenido, 'informe-sintetico.docx', mime), root, 8192);
    assert.equal(recibido.sha256, createHash('sha256').update(contenido).digest('hex'), 'El hash debe corresponder al paquete original completo.');
    assert.deepEqual(await fs.readFile(path.join(root, recibido.stagingKey)), contenido, 'La validación no debe modificar el paquete DOCX.');
    await unlinkKey(root, recibido.stagingKey);

    const relacionIncorrecta = makeDocxFixture({ otrasPartesPrimero: true, destinoDocumento: 'docProps/core.xml' });
    await assert.rejects(
      receiveSingleFile(multipartRequest(relacionIncorrecta, 'relacion-incorrecta.docx', mime), root, 8192),
      error => error.code === 'INVALID_FILE_CONTENT',
      'Debe seguir rechazándose una relación officeDocument que no apunta al documento principal.',
    );
    assert.deepEqual(await fs.readdir(path.join(root, '.staging')), [], 'No deben quedar temporales de la carga rechazada.');
  });
});
test('unsupported extensions, content mismatch, and oversized files are rejected', async () => {
  await withRoot(async root => {
    await assert.rejects(receiveSingleFile(multipartRequest(Buffer.from('x'), 'test.exe'), root, 20), error => error.code === 'UNSUPPORTED_FILE_TYPE');
    await assert.rejects(receiveSingleFile(multipartRequest(Buffer.from('not a PDF'), 'test.pdf', 'application/pdf'), root, 100), error => error.code === 'INVALID_FILE_CONTENT');
    await assert.rejects(receiveSingleFile(multipartRequest(Buffer.from('%PDF-1.7-too-large'), 'large.pdf', 'application/pdf'), root, 8), error => error.code === 'FILE_TOO_LARGE');
    assert.deepEqual(await fs.readdir(path.join(root, '.staging')), []);
  });
});

test('opened storage files are regular, contained files and reject a symlink when the platform permits creating one', async t => {
  await withRoot(async root => {
    const target = path.join(root, 'payload.bin');
    await fs.writeFile(target, 'safe bytes');
    const handle = await openRegularFile(root, 'payload.bin');
    assert.equal((await handle.readFile()).toString(), 'safe bytes');
    await handle.close();
    try { await fs.symlink(target, path.join(root, 'link.bin'), 'file'); }
    catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('El sistema no permite crear enlaces simbólicos en este entorno.'); return; } throw error; }
    await assert.rejects(openRegularFile(root, 'link.bin'), error => error.code === 'SYMLINK_NOT_ALLOWED' || error.code === 'UNSAFE_STORAGE_ENTRY');
  });
});

test('interrupted multipart request rejects and removes its partial staging file', { timeout: 5000 }, async () => {
  await withRoot(async root => {
    const boundary = 'hcv-abort-boundary';
    const req = new PassThrough();
    // receiveSingleFile initializes the private root asynchronously; pre-create
    // staging so this test can observe the partial write without racing setup.
    await fs.mkdir(path.join(root, '.staging'), { recursive: true });
    req.headers = { 'content-type': `multipart/form-data; boundary=${boundary}` };
    req.complete = false;
    const pending = receiveSingleFile(req, root, 4096);
    req.write(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="partial.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-`));
    let staged = [];
    for (let attempt = 0; attempt < 100 && staged.length === 0; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 5));
      staged = await fs.readdir(path.join(root, '.staging'));
    }
    assert.equal(staged.length, 1);
    req.emit('aborted');
    req.destroy();
    await assert.rejects(pending, error => error.code === 'CLIENT_DISCONNECTED');
    assert.deepEqual(await fs.readdir(path.join(root, '.staging')), []);
  });
});
