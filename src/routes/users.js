const { randomUUID } = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { requireTrimmedString, handleDbError } = require('../util');

const router = express.Router();

const ROLES = new Set(['PEMILIK', 'KARYAWAN']);

function mapUser(row) {
  return {
    userId: row.user_Id,
    name: row.nama_user,
    address: row.alamat_user,
    phone: row.telp_user,
    username: row.username_user,
    role: row.level_user,
    status: row.status_user,
  };
}

async function fetchById(id) {
  const [rows] = await pool.execute(
    `SELECT
       user_Id,
       nama_user,
       alamat_user,
       telp_user,
       username_user,
       level_user,
       status_user
     FROM users
     WHERE user_Id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

async function usernameTaken(username) {
  const [rows] = await pool.execute(
    'SELECT 1 FROM users WHERE username_user = ? LIMIT 1',
    [username]
  );
  return rows.length > 0;
}

router.get('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         user_Id,
         nama_user,
         alamat_user,
         telp_user,
         username_user,
         level_user,
         status_user
       FROM users
       ORDER BY nama_user ASC`
    );

    return res.json(rows.map(mapUser));
  } catch (err) {
    return handleDbError(res, 'GET /api/users', err);
  }
});

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const body = req.body || {};

  const username_user = requireTrimmedString(body.username_user, { maxLength: 30 });
  if (username_user == null) {
    return res.status(400).json({ error: 'username_user is required (max 30 chars)' });
  }

  if (typeof body.password_user !== 'string' || body.password_user.length === 0) {
    return res.status(400).json({ error: 'password_user is required' });
  }
  if (body.password_user.length > 72) {
    return res.status(400).json({ error: 'password_user is too long' });
  }

  const roleRaw = body.role_user ?? body.level_user;
  const role_user = typeof roleRaw === 'string' ? roleRaw.trim().toUpperCase() : '';
  if (!ROLES.has(role_user)) {
    return res.status(400).json({ error: 'role_user must be PEMILIK or KARYAWAN' });
  }

  try {
    if (await usernameTaken(username_user)) {
      return res.status(409).json({ error: 'That username is already used' });
    }

    const passwordHash = await bcrypt.hash(body.password_user, 10);

    const [result] = await pool.execute(
      `INSERT INTO users (
         nama_user,
         alamat_user,
         telp_user,
         username_user,
         password_user,
         level_user,
         status_user,
         uuid
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username_user,
        '-',
        '-',
        username_user,
        passwordHash,
        role_user,
        'AKTIF',
        randomUUID(),
      ]
    );

    const created = await fetchById(result.insertId);
    return res.status(201).json(created);
  } catch (err) {
    return handleDbError(res, 'POST /api/users', err);
  }
});

module.exports = router;
