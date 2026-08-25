function toMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toQty(value) {
  if (value == null) return '0';
  return String(value);
}

function parsePositiveInt(value) {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function parseNonNegativeInt(value) {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function parseBoundedInt(value, fallback, max) {
  if (value == null || value === '') {
    return fallback;
  }
  const n = parsePositiveInt(value);
  if (n == null) {
    return null;
  }
  return Math.min(n, max);
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(isoDate, delta) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function requireTrimmedString(value, { maxLength, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!allowEmpty && trimmed.length === 0) {
    return null;
  }
  if (maxLength != null && trimmed.length > maxLength) {
    return null;
  }
  return trimmed;
}

function parseBooleanFlag(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return 1;
  }
  if (value === false || value === 0 || value === '0' || value === 'false') {
    return 0;
  }
  return null;
}

function handleDbError(res, context, err) {
  console.error(`${context} failed:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = {
  toMoney,
  toQty,
  parsePositiveInt,
  parseNonNegativeInt,
  parseBoundedInt,
  isValidIsoDate,
  todayIsoDate,
  addDays,
  requireTrimmedString,
  parseBooleanFlag,
  handleDbError,
};
