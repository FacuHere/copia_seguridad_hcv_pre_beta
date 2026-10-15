const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_ROOT = path.join(PROJECT_ROOT, 'public');

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function readFileStorageConfig(env = process.env) {
  const configuredRoot = env.FILE_STORAGE_ROOT?.trim();
  let root = null;
  if (configuredRoot) {
    if (!path.isAbsolute(configuredRoot)) throw new Error('FILE_STORAGE_ROOT debe ser una ruta absoluta.');
    root = path.resolve(configuredRoot);
    if (isWithin(PUBLIC_ROOT, root) || isWithin(root, PUBLIC_ROOT)) {
      throw new Error('FILE_STORAGE_ROOT no puede estar dentro de public ni contener public.');
    }
    if (isWithin(PROJECT_ROOT, root)) {
      throw new Error('FILE_STORAGE_ROOT debe estar fuera del directorio del proyecto.');
    }
  }

  const rawLimit = env.MAX_FILE_SIZE_BYTES?.trim();
  let maxFileSizeBytes = null;
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit)) throw new Error('MAX_FILE_SIZE_BYTES debe ser un entero positivo.');
    maxFileSizeBytes = Number(rawLimit);
    if (!Number.isSafeInteger(maxFileSizeBytes) || maxFileSizeBytes < 1) {
      throw new Error('MAX_FILE_SIZE_BYTES debe ser un entero positivo seguro.');
    }
  }

  return { root, maxFileSizeBytes, uploadsEnabled: Boolean(root && maxFileSizeBytes) };
}

module.exports = { PROJECT_ROOT, PUBLIC_ROOT, isWithin, readFileStorageConfig };
