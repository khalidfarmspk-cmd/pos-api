const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const { handleDbError } = require('../util');

const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT satuan_Id, nama_satuan, allow_decimal, uuid, updated_at
       FROM satuan
       ORDER BY nama_satuan ASC`
    );
    return res.json(
      rows.map((row) => ({
        satuan_Id: row.satuan_Id,
        nama_satuan: row.nama_satuan,
        allow_decimal: row.allow_decimal,
        unitId: row.satuan_Id,
        name: row.nama_satuan,
        allowDecimal: Number(row.allow_decimal) === 1,
        uuid: row.uuid,
        updatedAt: row.updated_at,
      }))
    );
  } catch (err) {
    return handleDbError(res, 'GET /api/satuan', err);
  }
});

module.exports = router;
