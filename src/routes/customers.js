const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { parsePositiveInt, requireTrimmedString, handleDbError } = require('../util');

const router = express.Router();

function mapCustomer(row) {
  return {
    customerId: row.pelanggan_Id,
    nama_pelanggan: row.nama_pelanggan,
    telp_pelanggan: row.telp_pelanggan,
    alamat_pelanggan: row.alamat_pelanggan,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

const LIST_SQL = `SELECT
     pelanggan_Id,
     nama_pelanggan,
     telp_pelanggan,
     alamat_pelanggan,
     uuid,
     updated_at
   FROM pelanggan`;

async function nameTaken(name, excludeId) {
  const sql = excludeId == null
    ? 'SELECT 1 FROM pelanggan WHERE nama_pelanggan = ? LIMIT 1'
    : 'SELECT 1 FROM pelanggan WHERE nama_pelanggan = ? AND pelanggan_Id <> ? LIMIT 1';
  const params = excludeId == null ? [name] : [name, excludeId];
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0;
}

async function fetchById(id) {
  const [rows] = await pool.execute(
    `${LIST_SQL} WHERE pelanggan_Id = ?`,
    [id]
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
}

function parseBody(body) {
  const nama_pelanggan = requireTrimmedString(body.nama_pelanggan, { maxLength: 60 });
  if (nama_pelanggan == null) {
    return null;
  }

  const telp_pelanggan = requireTrimmedString(
    body.telp_pelanggan == null ? '' : body.telp_pelanggan,
    { maxLength: 20, allowEmpty: true },
  );
  if (telp_pelanggan == null) {
    return null;
  }

  const alamat_pelanggan = requireTrimmedString(
    body.alamat_pelanggan == null ? '' : body.alamat_pelanggan,
    { maxLength: 255, allowEmpty: true },
  );
  if (alamat_pelanggan == null) {
    return null;
  }

  return {
    nama_pelanggan,
    telp_pelanggan: telp_pelanggan === '' ? null : telp_pelanggan,
    alamat_pelanggan: alamat_pelanggan === '' ? null : alamat_pelanggan,
  };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `${LIST_SQL} ORDER BY nama_pelanggan ASC`
    );
    return res.json(rows.map(mapCustomer));
  } catch (err) {
    return handleDbError(res, 'GET /api/customers', err);
  }
});

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const parsed = parseBody(req.body || {});
  if (!parsed) {
    return res.status(400).json({
      error:
        'nama_pelanggan (max 60), telp_pelanggan (max 20), and alamat_pelanggan (max 255) are required',
    });
  }

  try {
    if (await nameTaken(parsed.nama_pelanggan)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      `INSERT INTO pelanggan (nama_pelanggan, telp_pelanggan, alamat_pelanggan, uuid)
       VALUES (?, ?, ?, ?)`,
      [
        parsed.nama_pelanggan,
        parsed.telp_pelanggan,
        parsed.alamat_pelanggan,
        randomUUID(),
      ]
    );

    return res.status(201).json(await fetchById(result.insertId));
  } catch (err) {
    return handleDbError(res, 'POST /api/customers', err);
  }
});

router.put('/:id', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id == null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const parsed = parseBody(req.body || {});
  if (!parsed) {
    return res.status(400).json({
      error:
        'nama_pelanggan (max 60), telp_pelanggan (max 20), and alamat_pelanggan (max 255) are required',
    });
  }

  try {
    if (await nameTaken(parsed.nama_pelanggan, id)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      `UPDATE pelanggan
       SET nama_pelanggan = ?, telp_pelanggan = ?, alamat_pelanggan = ?
       WHERE pelanggan_Id = ?`,
      [
        parsed.nama_pelanggan,
        parsed.telp_pelanggan,
        parsed.alamat_pelanggan,
        id,
      ]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    return res.json(await fetchById(id));
  } catch (err) {
    return handleDbError(res, 'PUT /api/customers/:id', err);
  }
});

module.exports = router;
