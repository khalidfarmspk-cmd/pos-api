const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  parsePositiveInt,
  requireTrimmedString,
  parseBooleanFlag,
  handleDbError,
} = require('../util');

const router = express.Router();

function mapUnit(row) {
  return {
    unitId: row.satuan_Id,
    name: row.nama_satuan,
    allowDecimal: Number(row.allow_decimal) === 1,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

async function nameTaken(name, excludeId) {
  const sql = excludeId == null
    ? 'SELECT 1 FROM satuan WHERE nama_satuan = ? LIMIT 1'
    : 'SELECT 1 FROM satuan WHERE nama_satuan = ? AND satuan_Id <> ? LIMIT 1';
  const params = excludeId == null ? [name] : [name, excludeId];
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0;
}

async function fetchById(id) {
  const [rows] = await pool.execute(
    `SELECT satuan_Id, nama_satuan, allow_decimal, uuid, updated_at
     FROM satuan
     WHERE satuan_Id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] ? mapUnit(rows[0]) : null;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT satuan_Id, nama_satuan, allow_decimal, uuid, updated_at
       FROM satuan
       ORDER BY nama_satuan ASC`
    );
    return res.json(rows.map(mapUnit));
  } catch (err) {
    return handleDbError(res, 'GET /api/units', err);
  }
});

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const body = req.body || {};
  const name = requireTrimmedString(body.name, { maxLength: 20 });
  const allowDecimal = body.allowDecimal == null ? 0 : parseBooleanFlag(body.allowDecimal);

  if (name == null || allowDecimal == null) {
    return res.status(400).json({
      error: 'name (max 20 chars) is required; allowDecimal must be boolean if provided',
    });
  }

  try {
    if (await nameTaken(name)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      'INSERT INTO satuan (nama_satuan, allow_decimal, uuid) VALUES (?, ?, ?)',
      [name, allowDecimal, randomUUID()]
    );

    return res.status(201).json(await fetchById(result.insertId));
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That name is already used' });
    }
    return handleDbError(res, 'POST /api/units', err);
  }
});

router.put('/:id', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id == null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const body = req.body || {};
  const name = requireTrimmedString(body.name, { maxLength: 20 });
  const allowDecimal = parseBooleanFlag(body.allowDecimal);

  if (name == null || allowDecimal == null) {
    return res.status(400).json({
      error: 'name (max 20 chars) and allowDecimal (boolean) are required',
    });
  }

  try {
    if (await nameTaken(name, id)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      'UPDATE satuan SET nama_satuan = ?, allow_decimal = ? WHERE satuan_Id = ?',
      [name, allowDecimal, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Unit not found' });
    }

    return res.json(await fetchById(id));
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That name is already used' });
    }
    return handleDbError(res, 'PUT /api/units/:id', err);
  }
});

module.exports = router;
