const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { parsePositiveInt, requireTrimmedString, handleDbError } = require('../util');

const router = express.Router();

function mapBrand(row) {
  return {
    brandId: row.merek_Id,
    name: row.nama_merek,
    productCount: Number(row.productCount) || 0,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

const LIST_SQL = `SELECT
     m.merek_Id,
     m.nama_merek,
     m.uuid,
     m.updated_at,
     COUNT(p.kode_produk) AS productCount
   FROM merek m
   LEFT JOIN produk p ON p.merek_Id = m.merek_Id`;

async function nameTaken(name, excludeId) {
  const sql = excludeId == null
    ? 'SELECT 1 FROM merek WHERE nama_merek = ? LIMIT 1'
    : 'SELECT 1 FROM merek WHERE nama_merek = ? AND merek_Id <> ? LIMIT 1';
  const params = excludeId == null ? [name] : [name, excludeId];
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0;
}

async function fetchById(id) {
  const [rows] = await pool.execute(
    `${LIST_SQL}
     WHERE m.merek_Id = ?
     GROUP BY m.merek_Id, m.nama_merek, m.uuid, m.updated_at`,
    [id]
  );
  return rows[0] ? mapBrand(rows[0]) : null;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `${LIST_SQL}
       GROUP BY m.merek_Id, m.nama_merek, m.uuid, m.updated_at
       ORDER BY m.nama_merek ASC`
    );
    return res.json(rows.map(mapBrand));
  } catch (err) {
    return handleDbError(res, 'GET /api/brands', err);
  }
});

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const name = requireTrimmedString((req.body || {}).name, { maxLength: 30 });
  if (name == null) {
    return res.status(400).json({ error: 'name is required (max 30 chars)' });
  }

  try {
    if (await nameTaken(name)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      'INSERT INTO merek (nama_merek, uuid) VALUES (?, ?)',
      [name, randomUUID()]
    );

    return res.status(201).json(await fetchById(result.insertId));
  } catch (err) {
    return handleDbError(res, 'POST /api/brands', err);
  }
});

router.put('/:id', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id == null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const name = requireTrimmedString((req.body || {}).name, { maxLength: 30 });
  if (name == null) {
    return res.status(400).json({ error: 'name is required (max 30 chars)' });
  }

  try {
    if (await nameTaken(name, id)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      'UPDATE merek SET nama_merek = ? WHERE merek_Id = ?',
      [name, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Brand not found' });
    }

    return res.json(await fetchById(id));
  } catch (err) {
    return handleDbError(res, 'PUT /api/brands/:id', err);
  }
});

module.exports = router;
