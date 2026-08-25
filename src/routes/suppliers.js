const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { parsePositiveInt, requireTrimmedString, handleDbError } = require('../util');

const router = express.Router();

function mapSupplier(row) {
  return {
    supplierId: row.supplier_Id,
    name: row.nama_supplier,
    address: row.alamat_supplier,
    phone: row.telp_supplier,
    productCount: Number(row.productCount) || 0,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

const LIST_SQL = `SELECT
     s.supplier_Id,
     s.nama_supplier,
     s.alamat_supplier,
     s.telp_supplier,
     s.uuid,
     s.updated_at,
     COUNT(p.kode_produk) AS productCount
   FROM supplier s
   LEFT JOIN produk p ON p.supplier_Id = s.supplier_Id`;

async function nameTaken(name, excludeId) {
  const sql = excludeId == null
    ? 'SELECT 1 FROM supplier WHERE nama_supplier = ? LIMIT 1'
    : 'SELECT 1 FROM supplier WHERE nama_supplier = ? AND supplier_Id <> ? LIMIT 1';
  const params = excludeId == null ? [name] : [name, excludeId];
  const [rows] = await pool.execute(sql, params);
  return rows.length > 0;
}

async function fetchById(id) {
  const [rows] = await pool.execute(
    `${LIST_SQL}
     WHERE s.supplier_Id = ?
     GROUP BY s.supplier_Id, s.nama_supplier, s.alamat_supplier, s.telp_supplier, s.uuid, s.updated_at`,
    [id]
  );
  return rows[0] ? mapSupplier(rows[0]) : null;
}

function parseBody(body) {
  const name = requireTrimmedString(body.name, { maxLength: 30 });
  const address = requireTrimmedString(body.address, { maxLength: 255 });
  const phone = requireTrimmedString(body.phone == null ? '' : body.phone, {
    maxLength: 13,
    allowEmpty: true,
  });
  if (name == null || address == null || phone == null) {
    return null;
  }
  return { name, address, phone };
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `${LIST_SQL}
       GROUP BY s.supplier_Id, s.nama_supplier, s.alamat_supplier, s.telp_supplier, s.uuid, s.updated_at
       ORDER BY s.nama_supplier ASC`
    );
    return res.json(rows.map(mapSupplier));
  } catch (err) {
    return handleDbError(res, 'GET /api/suppliers', err);
  }
});

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const parsed = parseBody(req.body || {});
  if (!parsed) {
    return res.status(400).json({
      error: 'name (max 30), address (max 255), and phone (max 13) are required',
    });
  }

  try {
    if (await nameTaken(parsed.name)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      `INSERT INTO supplier (nama_supplier, alamat_supplier, telp_supplier, uuid)
       VALUES (?, ?, ?, ?)`,
      [parsed.name, parsed.address, parsed.phone, randomUUID()]
    );

    return res.status(201).json(await fetchById(result.insertId));
  } catch (err) {
    return handleDbError(res, 'POST /api/suppliers', err);
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
      error: 'name (max 30), address (max 255), and phone (max 13) are required',
    });
  }

  try {
    if (await nameTaken(parsed.name, id)) {
      return res.status(409).json({ error: 'That name is already used' });
    }

    const [result] = await pool.execute(
      `UPDATE supplier
       SET nama_supplier = ?, alamat_supplier = ?, telp_supplier = ?
       WHERE supplier_Id = ?`,
      [parsed.name, parsed.address, parsed.phone, id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    return res.json(await fetchById(id));
  } catch (err) {
    return handleDbError(res, 'PUT /api/suppliers/:id', err);
  }
});

module.exports = router;
