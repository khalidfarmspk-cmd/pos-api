const mysql = require('mysql2/promise');

function env(name, fallbackName) {
  return process.env[name] || (fallbackName ? process.env[fallbackName] : undefined);
}

function required(value, label) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${label}`);
  }
  return value;
}

const host = required(env('DB_HOST', 'MYSQLHOST'), 'DB_HOST');
const port = Number(env('DB_PORT', 'MYSQLPORT') || 3306);
const isLocalhost = host === '127.0.0.1' || host === 'localhost';
const sslRequested = String(env('DB_SSL', 'MYSQL_SSL') || '').toLowerCase() === 'true';
const sslEnabled = sslRequested && !isLocalhost;

const pool = mysql.createPool({
  host,
  port,
  user: required(env('DB_USER', 'MYSQLUSER'), 'DB_USER'),
  password: env('DB_PASSWORD', 'MYSQLPASSWORD') ?? '',
  database: required(env('DB_NAME', 'MYSQLDATABASE'), 'DB_NAME'),
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  dateStrings: true,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined,
});

console.log(`MySQL pool: ${host}:${port}${sslEnabled ? ' (ssl)' : ''}`);

async function ping() {
  const [rows] = await pool.query('SELECT 1 AS ok');
  return rows[0] && Number(rows[0].ok) === 1;
}

module.exports = { pool, ping };
