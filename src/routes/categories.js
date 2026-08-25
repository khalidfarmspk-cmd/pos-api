const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const {
  parsePositiveInt,
  parseNonNegativeInt,
  requireTrimmedString,
  handleDbError,
} = require('../util');

const router = express.Router();

function mapCategory(row) {
  return {
    categoryId: row.kategori_Id,
    name: row.nama_kategori,
    shelfNumber: row.no_rak,
    productCount: Number(row.productCount) || 0,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

const LIST_SQL = `SELECT
     k.kategori_Id,
     k.nama_kategori,
     k.no_rak,
     k.uuid,
     k.updated_at,
     COUNT(p.kode_produk) AS productCount
   FROM kategori k
   LEFT JOIN produk p ON p.kategori_Id = k.kategori_Id`;

async function nameTaken(name, excludeId) {
  const sql = excludeId == null
    ? 'SELECT 1 FROM kategori WHERE nama_kategori = ? LIMIT 1'
    : 'SELECT 1 FROM kategori WHERE nama_kategori = ? AND kategori_Id <> ? LIMIT 1';
  const params = excludeId == null ? [name] : [name, excludeId];
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0;
}

async function fetchById(id) {
  const [rows] = await pool.execute(
    `${LIST_SQL}
     WHERE k.kategori_Id = ?
     GROUP BY k.kategori_Id, k.nama_kategori, k.no_rak, k.uuid, k.updated_at`,
    [id]
  );
  return rows[0] ? mapCategory(rows[0]) : null;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `${LIST_SQL}
       GROUP BY k.kategori_Id, k.nama_kategori, k.no_rak, k.uuid, k.updated_at
       ORDER BY k.nama_kategori ASC`
    );
    return res.json(rows.map(mapCategory));
  } catch (err) {
    return handleDbError(res, 'GET /api/categories', err);
  }
});

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const body = req.body || {};
  const name = requireTrimmedString(body.name, { maxLength: 30 });
  const shelfNumber = parseNonNegativeInt(body.shelfNumber);

  if (name == null || shelfNumber == null) {
    return res.status(400).json({
      error: 'name (max 30 chars) and shelfNumber (integer >= 0) are required',
    });
  }

  try {
    if (await nameTaken(name)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      'INSERT INTO kategori (nama_kategori, no_rak, uuid) VALUES (?, ?, ?)',
      [name, shelfNumber, randomUUID()]
    );

    return res.status(201).json(await fetchById(result.insertId));
  } catch (err) {
    return handleDbError(res, 'POST /api/categories', err);
  }
});

router.put('/:id', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  if (id == null) {
    return res.status(400).json({ error: 'id must be a positive integer' });
  }

  const body = req.body || {};
  const name = requireTrimmedString(body.name, { maxLength: 30 });
  const shelfNumber = parseNonNegativeInt(body.shelfNumber);

  if (name == null || shelfNumber == null) {
    return res.status(400).json({
      error: 'name (max 30 chars) and shelfNumber (integer >= 0) are required',
    });
  }

  try {
    if (await nameTaken(name, id)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      'UPDATE kategori SET nama_kategori = ?, no_rak = ? WHERE kategori_Id = ?',
      [name, shelfNumber, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }

    return res.json(await fetchById(id));
  } catch (err) {
    return handleDbError(res, 'PUT /api/categories/:id', err);
  }
});

module.exports = router;
