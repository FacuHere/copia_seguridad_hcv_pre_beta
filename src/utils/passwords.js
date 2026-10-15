const { promisify } = require('node:util');
const { scrypt: scryptCallback, randomBytes, timingSafeEqual } = require('node:crypto');

const scrypt = promisify(scryptCallback);
const COST = 32768;
const BLOCK_SIZE = 8;
const PARALLEL = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = Buffer.from('aGVhbHRoY2FyZS1sb2dpbi1kdW1teS1zYWx0', 'base64');
const DUMMY_HASH = Buffer.alloc(KEY_LENGTH);

async function derive(password, salt, options = {}) {
  return scrypt(password, salt, KEY_LENGTH, {
    N: options.cost || COST,
    r: options.blockSize || BLOCK_SIZE,
    p: options.parallel || PARALLEL,
    maxmem: MAX_MEMORY,
  });
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLEL}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function verifyPassword(password, encoded) {
  const parts = typeof encoded === 'string' ? encoded.split('$') : [];
  const validFormat = parts.length === 6 && parts[0] === 'scrypt'
    && parts[1] === String(COST) && parts[2] === String(BLOCK_SIZE)
    && parts[3] === String(PARALLEL);

  let salt = DUMMY_SALT;
  let expected = DUMMY_HASH;
  if (validFormat) {
    try {
      const decodedSalt = Buffer.from(parts[4], 'base64url');
      const decodedHash = Buffer.from(parts[5], 'base64url');
      if (decodedSalt.length === 16 && decodedHash.length === KEY_LENGTH) {
        salt = decodedSalt;
        expected = decodedHash;
      }
    } catch {
      // Use the fixed dummy inputs for malformed hashes.
    }
  }

  const actual = await derive(password, salt);
  return validFormat && timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
