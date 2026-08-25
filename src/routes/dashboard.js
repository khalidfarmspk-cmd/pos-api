const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  toMoney,
  toQty,
  parseBoundedInt,
  isValidIsoDate,
  todayIsoDate,
  addDays,
  handleDbError,
} = require('../util');

const router = express.Router();

router.get('/summary', authenticate, async (req, res) => {
  const dateParam = req.query.date;
  const date = (dateParam == null || dateParam === '')
    ? todayIsoDate()
    : dateParam;

  if (!isValidIsoDate(date)) {
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }

  try {
    const [[sales], [profitRows], [productRows], [lowStockRows]] = await Promise.all([
      pool.execute(
        `SELECT
           COALESCE(SUM(Total_pembayaran), 0) AS revenue,
           COUNT(*) AS transactionCount
         FROM penjualan
         WHERE tanggal_penjualan = ?`,
        [date]
      ),
      pool.execute(
        `SELECT COALESCE(SUM((pr.harga_jual - pr.harga_beli) * dp.jumlah), 0) AS profit
         FROM detail_penjualan dp
         JOIN produk pr ON dp.kode_produk = pr.kode_produk
         JOIN penjualan p ON dp.penjualan_Id = p.penjualan_Id
         WHERE p.tanggal_penjualan = ?`,
        [date]
      ),
      pool.execute('SELECT COUNT(*) AS productCount FROM produk'),
      pool.execute(
        'SELECT COUNT(*) AS lowStockCount FROM produk WHERE stok_produk < 5'
      ),
    ]);

    const salesRow = sales[0] || {};
    return res.json({
      revenue: toMoney(salesRow.revenue),
      transactionCount: toMoney(salesRow.transactionCount),
      profit: toMoney(profitRows[0] && profitRows[0].profit),
      productCount: toMoney(productRows[0] && productRows[0].productCount),
      lowStockCount: toMoney(lowStockRows[0] && lowStockRows[0].lowStockCount),
    });
  } catch (err) {
    return handleDbError(res, 'GET /api/dashboard/summary', err);
  }
});

router.get('/recent-sales', authenticate, async (req, res) => {
  const limit = parseBoundedInt(req.query.limit, 10, 50);
  if (limit == null) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT
         p.penjualan_Id,
         p.tanggal_penjualan,
         p.Total_pembayaran,
         u.nama_user
       FROM penjualan p
       JOIN users u ON p.user_Id = u.user_Id
       ORDER BY p.tanggal_penjualan DESC, p.penjualan_Id DESC
       LIMIT ${limit}`
    );

    return res.json(rows.map((row) => ({
      saleId: row.penjualan_Id,
      saleDate: row.tanggal_penjualan,
      total: toMoney(row.Total_pembayaran),
      cashierName: row.nama_user,
    })));
  } catch (err) {
    return handleDbError(res, 'GET /api/dashboard/recent-sales', err);
  }
});

router.get('/top-products', authenticate, async (req, res) => {
  const limit = parseBoundedInt(req.query.limit, 5, 50);
  const days = parseBoundedInt(req.query.days, 7, 365);
  if (limit == null) {
    return res.status(400).json({ error: 'limit must be a positive integer' });
  }
  if (days == null) {
    return res.status(400).json({ error: 'days must be a positive integer' });
  }

  const to = todayIsoDate();
  const from = addDays(to, 1 - days);

  try {
    const [rows] = await pool.execute(
      `SELECT
         pr.kode_produk,
         pr.nama_produk,
         SUM(dp.jumlah) AS qty,
         COALESCE(SUM(dp.Subtotal), 0) AS revenue
       FROM detail_penjualan dp
       JOIN produk pr ON dp.kode_produk = pr.kode_produk
       JOIN penjualan p ON dp.penjualan_Id = p.penjualan_Id
       WHERE p.tanggal_penjualan >= ?
         AND p.tanggal_penjualan <= ?
       GROUP BY pr.kode_produk, pr.nama_produk
       ORDER BY SUM(dp.jumlah) DESC, revenue DESC
       LIMIT ${limit}`,
      [from, to]
    );

    return res.json(rows.map((row) => ({
      productCode: row.kode_produk,
      name: row.nama_produk,
      qty: toQty(row.qty),
      revenue: toMoney(row.revenue),
    })));
  } catch (err) {
    return handleDbError(res, 'GET /api/dashboard/top-products', err);
  }
});

module.exports = router;
