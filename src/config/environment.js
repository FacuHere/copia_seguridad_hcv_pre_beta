const { isIP } = require('node:net');

function readPort(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${name} debe ser un número de puerto válido.`);
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} debe estar entre 1 y 65535.`);
  }
  return port;
}

function readHost(name = 'HOST', fallback = '127.0.0.1') {
  const host = (process.env[name] ?? fallback).trim();
  const validDnsName = host.length <= 253
    && host.split('.').every(label => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label));
  if (!host || /\s|[\u0000-\u001f/\\]/.test(host) || !(isIP(host) || validDnsName)) {
    throw new Error(`${name} debe ser una dirección IP o un nombre de host válido.`);
  }
  return host;
}

module.exports = { readPort, readHost };
