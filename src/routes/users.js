const { randomUUID } = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { parsePositiveInt, requireTrimmedString, handleDbError } = require('../util');

const router = express.Router();

const ROLES = new Set(['PEMILIK', 'KARYAWAN']);
const STATUSES = new Set(['AKTIF', 'NONAKTIF']);

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

async function usernameTaken(username, excludeId) {
  const sql = excludeId == null
    ? 'SELECT 1 FROM users WHERE username_user = ? LIMIT 1'
    : 'SELECT 1 FROM users WHERE username_user = ? AND user_Id <> ? LIMIT 1';
  const params = excludeId == null ? [username] : [username, excludeId];
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0;
}

function parseRole(body) {
  const roleRaw = body.role_user ?? body.level_user;
  const role_user = typeof roleRaw === 'string' ? roleRaw.trim().toUpperCase() : '';
  return ROLES.has(role_user) ? role_user : null;
}

function parseStatus(body) {
  const statusRaw = body.status_user ?? body.status;
  const status_user = typeof statusRaw === 'string' ? statusRaw.trim().toUpperCase() : '';
  return STATUSES.has(status_user) ? status_user : null;
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

router.put('/:id', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id == null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const body = req.body || {};

  const username_user = requireTrimmedString(body.username_user, { maxLength: 30 });
  if (username_user == null) {
    return res.status(400).json({ error: 'username_user is required (max 30 chars)' });
  }

  const role_user = parseRole(body);
  if (role_user == null) {
    return res.status(400).json({ error: 'role_user must be PEMILIK or KARYAWAN' });
  }

  const status_user = parseStatus(body);
  if (status_user == null) {
    return res.status(400).json({ error: 'status_user must be AKTIF or NONAKTIF' });
  }

  const hasPassword =
    body.password_user != null
    && typeof body.password_user === 'string'
    && body.password_user.length > 0;

  if (hasPassword && body.password_user.length > 72) {
    return res.status(400).json({ error: 'password_user is too long' });
  }

  try {
    if (await usernameTaken(username_user, id)) {
      return res.status(409).json({ error: 'That username is already used' });
    }

    if (hasPassword) {
      const passwordHash = await bcrypt.hash(body.password_user, 10);
      const [result] = await pool.execute(
        `UPDATE users
         SET nama_user = ?,
             username_user = ?,
             password_user = ?,
             level_user = ?,
             status_user = ?
         WHERE user_Id = ?`,
        [username_user, username_user, passwordHash, role_user, status_user, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
    } else {
      const [result] = await pool.execute(
        `UPDATE users
         SET nama_user = ?,
             username_user = ?,
             level_user = ?,
             status_user = ?
         WHERE user_Id = ?`,
        [username_user, username_user, role_user, status_user, id]
      );
      if (result.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
    }

    return res.json(await fetchById(id));
  } catch (err) {
    return handleDbError(res, 'PUT /api/users/:id', err);
  }
});

module.exports = router;
