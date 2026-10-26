const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Transform } = require('node:stream');
const { inflateRawSync } = require('node:zlib');
const { pipeline } = require('node:stream/promises');
const Busboy = require('busboy');
const { isWithin } = require('../config/file-storage');

const ACCEPTED = new Map([
  ['.pdf', { mime: 'application/pdf', signature: bytes => bytes.subarray(0, 5).toString('ascii') === '%PDF-' }],
  ['.doc', { mime: 'application/msword', signature: bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1])) }],
  ['.docx', { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: bytes => bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x50,0x4b,0x03,0x04])) }],
  ['.jpg', { mime: 'image/jpeg', signature: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['.jpeg', { mime: 'image/jpeg', signature: bytes => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ['.png', { mime: 'image/png', signature: bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) }],
  ['.gif', { mime: 'image/gif', signature: bytes => ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii')) }],
  ['.webp', { mime: 'image/webp', signature: bytes => bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' }],
  // DICM at byte 128 identifies Part 10, but raw DICOM data sets may not carry that preamble.
  // This layer preserves DICOM bytes and checks only that the file is non-empty; it does not parse DICOM.
  ['.dcm', { mime: 'application/dicom', signature: bytes => bytes.length > 0 }],
]);

class DocumentInputError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function sanitizeSegment(value, maxLength = 36) {
  let result = String(value ?? '').normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\.\.+/g, '_')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+/g, '')
    .trim();
  if (!result) result = 'Sin nombre';
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result.slice(0, maxLength).replace(/[. ]+$/g, '') || 'Sin nombre';
}

function safeOriginalName(value) {
  const base = String(value ?? '').replace(/\\/g, '/').split('/').pop().normalize('NFC');
  if (!base || base === '.' || base === '..' || /[\u0000-\u001f]/.test(base)) {
    throw new DocumentInputError('INVALID_FILENAME', 'El nombre del archivo no es válido.');
  }
  if ([...base].length > 255) throw new DocumentInputError('INVALID_FILENAME', 'El nombre del archivo supera el máximo admitido.');
  return base;
}

function patientFolderKey({ patientId, patientDni, patientName }) {
  const patientLabel = sanitizeSegment([patientDni, patientName].filter(Boolean).join(' - '), 34);
  return `Pacientes/P-${patientId} - ${patientLabel}`;
}

function studyFolderKey({ patientId, patientDni, patientName, studyId, studyDate, studyType }) {
  const patientKey = patientFolderKey({ patientId, patientDni, patientName });
  const studyLabel = sanitizeSegment(`${String(studyDate).slice(0, 10)} - ${studyType}`, 34);
  return `${patientKey}/Estudios/E-${studyId} - ${studyLabel}`;
}

function relativeDocumentKey({ patientId, patientDni, patientName, studyId, studyDate, studyType, documentId, originalName }) {
  const studyKey = studyFolderKey({ patientId, patientDni, patientName, studyId, studyDate, studyType });
  const extension = path.posix.extname(originalName).toLowerCase();
  const stem = path.posix.basename(originalName, path.posix.extname(originalName));
  const filename = `D-${documentId} - ${sanitizeSegment(stem, 62)}${extension}`;
  const key = `${studyKey}/${filename}`;
  if (Buffer.byteLength(key, 'utf8') > 255) throw new DocumentInputError('STORAGE_KEY_TOO_LONG', 'La ruta interna del archivo es demasiado larga.');
  return key;
}

function resolveStoragePath(root, key) {
  if (typeof key !== 'string' || !key || key.includes('\\') || key.startsWith('/') || /^[A-Za-z]:/.test(key)) {
    throw new DocumentInputError('INVALID_STORAGE_KEY', 'La referencia interna del archivo no es válida.');
  }
  const parts = key.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) {
    throw new DocumentInputError('INVALID_STORAGE_KEY', 'La referencia interna del archivo no es válida.');
  }
  const absolute = path.resolve(root, ...parts);
  if (!isWithin(path.resolve(root), absolute) || absolute === path.resolve(root)) {
    throw new DocumentInputError('INVALID_STORAGE_KEY', 'La ruta del archivo sale del repositorio.');
  }
  return absolute;
}

async function ensurePrivateRoot(root) {
  const absoluteRoot = path.resolve(root);
  const parsedRoot = path.parse(absoluteRoot).root;
  // Inspect existing ancestors before recursive mkdir so an existing junction
  // cannot redirect directory creation outside the configured repository.
  let current = parsedRoot;
  for (const segment of path.relative(parsedRoot, absoluteRoot).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) throw new DocumentInputError('INVALID_STORAGE_ROOT', 'FILE_STORAGE_ROOT no puede contener enlaces simbólicos o junctions.');
      if (!stat.isDirectory()) throw new DocumentInputError('INVALID_STORAGE_ROOT', 'La ruta de almacenamiento debe contener únicamente directorios.');
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }
  await fs.promises.mkdir(absoluteRoot, { recursive: true });
  current = parsedRoot;
  for (const segment of path.relative(parsedRoot, absoluteRoot).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw new DocumentInputError('INVALID_STORAGE_ROOT', 'FILE_STORAGE_ROOT no puede contener enlaces simbólicos o junctions.');
    if (!stat.isDirectory()) throw new DocumentInputError('INVALID_STORAGE_ROOT', 'La raíz de almacenamiento debe ser un directorio privado real.');
  }
  root = absoluteRoot;
  const staging = path.join(root, '.staging');
  await fs.promises.mkdir(staging, { recursive: true });
  const stagingStat = await fs.promises.lstat(staging);
  if (stagingStat.isSymbolicLink() || !stagingStat.isDirectory()) throw new DocumentInputError('INVALID_STORAGE_ROOT', 'El área temporal debe ser un directorio privado real.');
  return root;
}

async function assertNoLinks(root, target, includeFinal = true) {
  await ensurePrivateRoot(root);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new DocumentInputError('INVALID_STORAGE_KEY', 'La ruta del archivo sale del repositorio.');
  const parts = relative.split(path.sep);
  let current = root;
  const count = includeFinal ? parts.length : Math.max(0, parts.length - 1);
  for (let i = 0; i < count; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await fs.promises.lstat(current);
      if (stat.isSymbolicLink()) throw new DocumentInputError('SYMLINK_NOT_ALLOWED', 'No se permiten enlaces dentro del repositorio de archivos.');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
  }
}

async function openRegularFile(root, key) {
  await ensurePrivateRoot(root);
  const target = resolveStoragePath(root, key);
  await assertNoLinks(root, target, true);
  const handle = await fs.promises.open(target, 'r');
  try {
    const opened = await handle.stat();
    const current = await fs.promises.lstat(target);
    if (!opened.isFile() || !current.isFile() || current.isSymbolicLink()
        || (opened.dev !== current.dev) || (opened.ino && current.ino && opened.ino !== current.ino)) {
      throw new DocumentInputError('UNSAFE_STORAGE_ENTRY', 'El archivo cambió durante la comprobación de seguridad.');
    }
    await assertNoLinks(root, target, true);
    return handle;
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}

async function unlinkKey(root, key) {
  const target = resolveStoragePath(root, key);
  await assertNoLinks(root, target, true);
  await fs.promises.unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
}

async function moveKey(root, fromKey, toKey) {
  const source = resolveStoragePath(root, fromKey);
  const destination = resolveStoragePath(root, toKey);
  await assertNoLinks(root, source, true);
  await assertNoLinks(root, destination, false);
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await assertNoLinks(root, destination, false);
  await fs.promises.rename(source, destination);
}

async function mergeDirectoryPrefix(root, fromPrefix, toPrefix) {
  const source = resolveStoragePath(root, fromPrefix);
  const target = resolveStoragePath(root, toPrefix);
  await assertNoLinks(root, source, true);
  await assertNoLinks(root, target, false);
  let sourceStat;
  try { sourceStat = await fs.promises.lstat(source); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw new DocumentInputError('INVALID_STORAGE_DIRECTORY', 'La carpeta de origen no es válida.');
  await fs.promises.mkdir(target, { recursive: true });
  await assertNoLinks(root, target, true);

  async function merge(sourceDirectory, targetDirectory) {
    const entries = await fs.promises.readdir(sourceDirectory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new DocumentInputError('SYMLINK_NOT_ALLOWED', 'No se permiten enlaces dentro del repositorio de archivos.');
      const sourceEntry = path.join(sourceDirectory, entry.name);
      const targetEntry = path.join(targetDirectory, entry.name);
      if (entry.isDirectory()) {
        await fs.promises.mkdir(targetEntry, { recursive: true });
        await assertNoLinks(root, targetEntry, true);
        await merge(sourceEntry, targetEntry);
        await fs.promises.rmdir(sourceEntry);
      } else if (entry.isFile()) {
        try {
          const targetStat = await fs.promises.lstat(targetEntry);
          const sourceStat = await fs.promises.lstat(sourceEntry);
          if (targetStat.isSymbolicLink() || !targetStat.isFile() || sourceStat.size !== targetStat.size) {
            throw new DocumentInputError('STORAGE_RENAME_COLLISION', 'La carpeta destino ya contiene un archivo diferente con el mismo nombre.');
          }
          const digest = filePath => new Promise((resolve, reject) => {
            const hash = createHash('sha256');
            const stream = fs.createReadStream(filePath);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(hash.digest('hex')));
          });
          if (await digest(sourceEntry) !== await digest(targetEntry)) {
            throw new DocumentInputError('STORAGE_RENAME_COLLISION', 'La carpeta destino ya contiene un archivo diferente con el mismo nombre.');
          }
          await fs.promises.unlink(sourceEntry);
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await fs.promises.rename(sourceEntry, targetEntry);
        }
      } else {
        throw new DocumentInputError('INVALID_STORAGE_ENTRY', 'La carpeta contiene una entrada de archivo no permitida.');
      }
    }
  }

  await merge(source, target);
  await fs.promises.rmdir(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return true;
}

function validateDeclaredMime(extension, mimeType) {
  const expected = ACCEPTED.get(extension);
  const declared = String(mimeType || '').toLowerCase();
  const allowedDeclared = new Set([expected.mime, 'application/octet-stream', '']);
  if (!allowedDeclared.has(declared)) throw new DocumentInputError('MIME_MISMATCH', 'El tipo declarado no coincide con el formato permitido.');
  return expected;
}

const MAX_DOCX_XML_BYTES = 16 * 1024 * 1024;
const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
async function hasDocxPackage(filePath, fileSize) {
  if (fileSize < 22) return false;
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const tailLength = Math.min(fileSize, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    const tailRead = await handle.read(tail, 0, tailLength, fileSize - tailLength);
    if (tailRead.bytesRead !== tailLength) return false;
    let endOffset = tail.length - 22;
    const earliestEnd = Math.max(0, tail.length - 22 - 0xffff);
    while (endOffset >= earliestEnd && tail.readUInt32LE(endOffset) !== 0x06054b50) endOffset -= 1;
    if (endOffset < earliestEnd || endOffset + 22 > tail.length) return false;
    const commentLength = tail.readUInt16LE(endOffset + 20);
    if (endOffset + 22 + commentLength !== tail.length) return false;
    const diskNumber = tail.readUInt16LE(endOffset + 4);
    const centralDisk = tail.readUInt16LE(endOffset + 6);
    const entriesOnDisk = tail.readUInt16LE(endOffset + 8);
    const entryCount = tail.readUInt16LE(endOffset + 10);
    const centralSize = tail.readUInt32LE(endOffset + 12);
    const centralOffset = tail.readUInt32LE(endOffset + 16);
    const absoluteEndOffset = fileSize - tailLength + endOffset;
    if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount || entryCount === 0xffff
      || centralSize === 0xffffffff || centralOffset === 0xffffffff || centralOffset + centralSize !== absoluteEndOffset) return false;

    const requiredNames = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'];
    const entries = new Map();
    let position = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (position + 46 > centralSize) return false;
      const centralHeader = Buffer.alloc(46);
      const centralRead = await handle.read(centralHeader, 0, centralHeader.length, centralOffset + position);
      if (centralRead.bytesRead !== centralHeader.length || centralHeader.readUInt32LE(0) !== 0x02014b50) return false;
      const flags = centralHeader.readUInt16LE(8);
      const method = centralHeader.readUInt16LE(10);
      const checksum = centralHeader.readUInt32LE(16);
      const compressedSize = centralHeader.readUInt32LE(20);
      const uncompressedSize = centralHeader.readUInt32LE(24);
      const nameLength = centralHeader.readUInt16LE(28);
      const extraLength = centralHeader.readUInt16LE(30);
      const entryCommentLength = centralHeader.readUInt16LE(32);
      const localOffset = centralHeader.readUInt32LE(42);
      const recordLength = 46 + nameLength + extraLength + entryCommentLength;
      if ((flags & 0x0001) !== 0 || ![0, 8].includes(method) || nameLength === 0
        || uncompressedSize > MAX_DOCX_XML_BYTES || position + recordLength > centralSize
        || localOffset + 30 > centralOffset || compressedSize === 0xffffffff
        || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) return false;
      const nameBuffer = Buffer.alloc(nameLength);
      const nameRead = await handle.read(nameBuffer, 0, nameLength, centralOffset + position + 46);
      if (nameRead.bytesRead !== nameLength) return false;
      const name = nameBuffer.toString('utf8');
      if (requiredNames.includes(name)) {
        if (entries.has(name)) return false;
        entries.set(name, { name, flags, method, checksum, compressedSize, uncompressedSize, localOffset });
      }
      position += recordLength;
    }
    if (position !== centralSize || requiredNames.some(name => !entries.has(name))) return false;

    const readPackagePart = async entry => {
      const localHeader = Buffer.alloc(30);
      const localRead = await handle.read(localHeader, 0, localHeader.length, entry.localOffset);
      if (localRead.bytesRead !== localHeader.length || localHeader.readUInt32LE(0) !== 0x04034b50
        || localHeader.readUInt16LE(6) !== entry.flags || localHeader.readUInt16LE(8) !== entry.method) return null;
      const localNameLength = localHeader.readUInt16LE(26);
      const localExtraLength = localHeader.readUInt16LE(28);
      const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
      if (localNameLength === 0 || dataOffset + entry.compressedSize > centralOffset) return null;
      const localName = Buffer.alloc(localNameLength);
      const localNameRead = await handle.read(localName, 0, localNameLength, entry.localOffset + 30);
      if (localNameRead.bytesRead !== localNameLength || localName.toString('utf8') !== entry.name) return null;
      const compressed = Buffer.alloc(entry.compressedSize);
      const dataRead = await handle.read(compressed, 0, compressed.length, dataOffset);
      if (dataRead.bytesRead !== compressed.length) return null;
      try {
        const uncompressed = entry.method === 0
          ? compressed
          : inflateRawSync(compressed, { maxOutputLength: MAX_DOCX_XML_BYTES });
        if (uncompressed.length !== entry.uncompressedSize || crc32(uncompressed) !== entry.checksum) return null;
        return uncompressed.toString('utf8');
      } catch {
        return null;
      }
    };

    const contentTypes = await readPackagePart(entries.get('[Content_Types].xml'));
    const relationships = await readPackagePart(entries.get('_rels/.rels'));
    const documentXml = await readPackagePart(entries.get('word/document.xml'));
    if (!contentTypes || !relationships || !documentXml) return false;
    // El orden de las declaraciones no identifica el documento principal del paquete.
    const declaracionDocumento = (contentTypes.match(/<Override\b[^>]*>/gi) || []).find(declaracion =>
      /PartName=["']\/word\/document\.xml["']/i.test(declaracion)
      && /ContentType=["']application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document\.main\+xml["']/i.test(declaracion));
    const relacionDocumento = (relationships.match(/<Relationship\b[^>]*>/gi) || []).find(relacion =>
      /Type=["'][^"']*\/officeDocument["']/i.test(relacion)
      && /Target=["']\/?word\/document\.xml["']/i.test(relacion));
    return /<Types\b/i.test(contentTypes)
      && Boolean(declaracionDocumento)
      && Boolean(relacionDocumento)
      && /<(?:[A-Za-z_][\w.-]*:)?document\b/i.test(documentXml)
      && /<(?:[A-Za-z_][\w.-]*:)?body\b/i.test(documentXml);
  } finally {
    await handle.close();
  }
}async function receiveSingleFile(req, root, maxBytes) {
  await ensurePrivateRoot(root);
  const operationId = randomUUID();
  const stagingKey = `.staging/${operationId}.part`;
  const stagingPath = resolveStoragePath(root, stagingKey);
  let foundFile = null;
  let fileTask = Promise.resolve();
  let inputError = null;
  let limitExceeded = false;

  return new Promise((resolve, reject) => {
    let parser;
    let fileStream;
    let stagingWriter;
    let settled = false;
    try {
      parser = Busboy({ headers: req.headers, limits: { files: 1, fields: 0, fileSize: maxBytes, fieldNameSize: 64, fieldSize: 256 } });
    } catch {
      reject(new DocumentInputError('INVALID_MULTIPART', 'La solicitud multipart no es válida.'));
      return;
    }

    const detachRequestListeners = () => {
      req.off('aborted', onAbort);
      req.off('error', onRequestError);
      req.off('close', onRequestClose);
    };
    const failRequest = async error => {
      if (settled) return;
      settled = true;
      inputError ||= error;
      if (fileStream && !fileStream.destroyed) fileStream.destroy();
      if (stagingWriter && !stagingWriter.destroyed) stagingWriter.destroy();
      if (!parser.destroyed) parser.destroy();
      fileTask.catch(() => {});
      if (stagingWriter && !stagingWriter.closed) {
        await new Promise(resolve => {
          stagingWriter.once('close', resolve);
          const timeout = setTimeout(resolve, 1000);
          timeout.unref();
        });
      }
      await fs.promises.unlink(stagingPath).catch(() => {});
      detachRequestListeners();
      reject(inputError);
    };
    const onAbort = () => { void failRequest(new DocumentInputError('CLIENT_DISCONNECTED', 'La conexión se interrumpió durante la carga.')); };
    const onRequestError = () => { void failRequest(new DocumentInputError('CLIENT_DISCONNECTED', 'No se pudo completar la solicitud de carga.')); };
    const onRequestClose = () => { if (req.complete === false) onAbort(); };
    req.on('aborted', onAbort);
    req.on('error', onRequestError);
    req.on('close', onRequestClose);

    parser.on('field', () => { inputError ||= new DocumentInputError('UNEXPECTED_FIELD', 'La carga acepta únicamente un archivo.'); });
    parser.on('fieldsLimit', () => { inputError ||= new DocumentInputError('UNEXPECTED_FIELD', 'La carga acepta únicamente un archivo.'); });
    parser.on('filesLimit', () => { inputError ||= new DocumentInputError('TOO_MANY_FILES', 'La carga acepta un solo archivo por operación.'); });
    parser.on('file', (field, stream, info) => {
      if (foundFile) {
        inputError ||= new DocumentInputError('TOO_MANY_FILES', 'La carga acepta un solo archivo por operación.');
        stream.resume();
        return;
      }
      foundFile = true;
      fileStream = stream;
      if (field !== 'file') inputError ||= new DocumentInputError('INVALID_FILE_FIELD', 'El campo multipart debe llamarse file.');
      let originalName;
      let extension;
      let expected;
      try {
        originalName = safeOriginalName(info.filename);
        extension = path.posix.extname(originalName).toLowerCase();
        if (!ACCEPTED.has(extension)) throw new DocumentInputError('UNSUPPORTED_FILE_TYPE', 'El formato debe ser PDF, DOC, DOCX, JPG, JPEG, PNG, GIF, WEBP o DICOM .dcm.');
        expected = validateDeclaredMime(extension, info.mimeType);
      } catch (error) {
        inputError ||= error;
        stream.resume();
        return;
      }

      const hash = createHash('sha256');
      const prefixChunks = [];
      let prefixLength = 0;
      let sizeBytes = 0;
      const inspector = new Transform({
        transform(chunk, _encoding, callback) {
          sizeBytes += chunk.length;
          hash.update(chunk);
          if (prefixLength < 132) {
            const piece = chunk.subarray(0, 132 - prefixLength);
            prefixChunks.push(piece);
            prefixLength += piece.length;
          }
          callback(null, chunk);
        },
      });
      stream.on('limit', () => { limitExceeded = true; });
      stagingWriter = fs.createWriteStream(stagingPath, { flags: 'wx', mode: 0o600 });
      fileTask = pipeline(stream, inspector, stagingWriter)
        .then(async () => {
          if (stream.truncated || limitExceeded) throw new DocumentInputError('FILE_TOO_LARGE', 'El archivo supera MAX_FILE_SIZE_BYTES.');
          const prefix = Buffer.concat(prefixChunks, prefixLength);
          if (!expected.signature(prefix)) throw new DocumentInputError(extension === '.dcm' ? 'INVALID_DICOM_FILE' : 'INVALID_FILE_CONTENT', 'El contenido no coincide con el formato declarado.');
          if (extension === '.dcm' && sizeBytes === 0) throw new DocumentInputError('INVALID_DICOM_FILE', 'El archivo DICOM está vacío.');
          if (extension === '.docx' && !await hasDocxPackage(stagingPath, sizeBytes)) throw new DocumentInputError('INVALID_FILE_CONTENT', 'El archivo no contiene una estructura DOCX válida.');
          return { stagingKey, originalName, extension, mimeType: expected.mime, sizeBytes, sha256: hash.digest('hex') };
        });
      fileTask.catch(error => { inputError ||= error; });
    });
    parser.on('error', () => { inputError ||= new DocumentInputError('INVALID_MULTIPART', 'No se pudo leer la solicitud multipart.'); });
    parser.on('close', async () => {
      try {
        await fileTask;
        if (inputError) throw inputError;
        if (!foundFile) throw new DocumentInputError('FILE_REQUIRED', 'Debe seleccionar un archivo.');
        if (!settled) { settled = true; detachRequestListeners(); resolve(await fileTask); }
      } catch (error) {
        if (settled) return;
        settled = true;
        await fs.promises.unlink(stagingPath).catch(() => {});
        detachRequestListeners();
        reject(error);
      }
    });
    if (req.aborted || req.destroyed) { onAbort(); return; }
    req.pipe(parser);
  });
}

module.exports = {
  ACCEPTED, DocumentInputError, sanitizeSegment, safeOriginalName, patientFolderKey, studyFolderKey, relativeDocumentKey,
  resolveStoragePath, ensurePrivateRoot, assertNoLinks, unlinkKey, moveKey, mergeDirectoryPrefix,
  openRegularFile, receiveSingleFile,
};
