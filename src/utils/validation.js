function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value)) return null;
  return BigInt(value) <= 18446744073709551615n ? value : null;
}

function optionalText(value, maxLength, field) {
  if (value === undefined || value === null || value === '') return { value: null };
  if (typeof value !== 'string') return { error: `${field} debe ser texto.` };
  const normalized = value.trim();
  if (normalized.length > maxLength) return { error: `${field} supera el máximo permitido.` };
  return { value: normalized || null };
}

function requiredText(value, maxLength, field) {
  if (typeof value !== 'string' || !value.trim()) return { error: `${field} es obligatorio.` };
  const normalized = value.trim();
  if (normalized.length > maxLength) return { error: `${field} supera el máximo permitido.` };
  return { value: normalized };
}

function optionalDate(value, field, required = false) {
  if ((value === undefined || value === null || value === '') && !required) return { value: null };
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { error: `${field} debe tener formato AAAA-MM-DD.` };
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return { error: `${field} no es una fecha válida.` };
  }
  return { value };
}

function positiveInteger(value) {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

module.exports = { parseId, optionalText, requiredText, optionalDate, positiveInteger };
