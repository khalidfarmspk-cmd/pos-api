const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function toMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
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

router.get('/', authenticate, async (req, res) => {
  const { from, to } = req.query;

  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    return res.status(400).json({
      error: 'from and to are required as YYYY-MM-DD dates',
    });
  }

  if (from > to) {
    return res.status(400).json({ error: 'from must be on or before to' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         p.penjualan_Id,
         p.tanggal_penjualan,
         p.Total_pembayaran,
         p.uang_diterima,
         p.uang_kembalian,
         p.user_Id,
         u.nama_user,
         p.uuid,
         p.updated_at
       FROM penjualan p
       JOIN users u ON p.user_Id = u.user_Id
       WHERE p.tanggal_penjualan >= ?
         AND p.tanggal_penjualan <= ?
       ORDER BY p.tanggal_penjualan DESC, p.penjualan_Id DESC`,
      [from, to]
    );

    return res.json(rows.map((row) => ({
      saleId: row.penjualan_Id,
      saleDate: row.tanggal_penjualan,
      totalPayment: toMoney(row.Total_pembayaran),
      amountReceived: toMoney(row.uang_diterima),
      change: toMoney(row.uang_kembalian),
      userId: row.user_Id,
      cashierName: row.nama_user,
      uuid: row.uuid,
      updatedAt: row.updated_at,
    })));
  } catch (err) {
    console.error('GET /api/sales failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
