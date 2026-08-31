const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  toMoney,
  toQty,
  parsePositiveInt,
  isValidIsoDate,
  addDays,
  handleDbError,
} = require('../util');

const router = express.Router();

function parseRange(req, res) {
  const { from, to } = req.query;
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) {
    res.status(400).json({ error: 'from and to are required as YYYY-MM-DD dates' });
    return null;
  }
  if (from > to) {
    res.status(400).json({ error: 'from must be on or before to' });
    return null;
  }
  return { from, to };
}

router.get('/sales', authenticate, async (req, res) => {
  const range = parseRange(req, res);
  if (!range) return undefined;
  const { from, to } = range;

  try {
    const [[summary], [byDayRows], [topRows]] = await Promise.all([
      pool.execute(
        `SELECT
           COALESCE(SUM(p.Total_pembayaran), 0) AS totalRevenue,
           COUNT(*) AS transactionCount,
           COALESCE((
             SELECT SUM((pr.harga_jual - pr.harga_beli) * dp.jumlah)
             FROM detail_penjualan dp
             JOIN produk pr ON dp.kode_produk = pr.kode_produk
             JOIN penjualan s ON dp.penjualan_Id = s.penjualan_Id
             WHERE s.tanggal_penjualan >= ?
               AND s.tanggal_penjualan <= ?
           ), 0) AS totalProfit
         FROM penjualan p
         WHERE p.tanggal_penjualan >= ?
           AND p.tanggal_penjualan <= ?`,
        [from, to, from, to]
      ),
      pool.execute(
        `SELECT
           tanggal_penjualan AS saleDate,
           COALESCE(SUM(Total_pembayaran), 0) AS revenue
         FROM penjualan
         WHERE tanggal_penjualan >= ?
           AND tanggal_penjualan <= ?
         GROUP BY tanggal_penjualan
         ORDER BY tanggal_penjualan ASC`,
        [from, to]
      ),
      pool.execute(
        `SELECT
           pr.nama_produk,
           SUM(dp.jumlah) AS qty,
           COALESCE(SUM(dp.Subtotal), 0) AS revenue
         FROM detail_penjualan dp
         JOIN produk pr ON dp.kode_produk = pr.kode_produk
         JOIN penjualan p ON dp.penjualan_Id = p.penjualan_Id
         WHERE p.tanggal_penjualan >= ?
           AND p.tanggal_penjualan <= ?
         GROUP BY pr.kode_produk, pr.nama_produk
         ORDER BY SUM(dp.jumlah) DESC, revenue DESC`,
        [from, to]
      ),
    ]);

    const row = summary[0] || {};
    const totalRevenue = toMoney(row.totalRevenue);
    const transactionCount = toMoney(row.transactionCount);
    const revenueByDate = new Map(
      byDayRows.map((item) => [item.saleDate, toMoney(item.revenue)])
    );
    const byDay = [];
    for (let date = from; date <= to; date = addDays(date, 1)) {
      byDay.push({
        date,
        revenue: revenueByDate.has(date) ? revenueByDate.get(date) : 0,
      });
    }

    return res.json({
      totalRevenue,
      transactionCount,
      totalProfit: toMoney(row.totalProfit),
      avgBasket: transactionCount === 0 ? 0 : Math.trunc(totalRevenue / transactionCount),
      byDay,
      topProducts: topRows.map((item) => ({
        name: item.nama_produk,
        qty: toQty(item.qty),
        revenue: toMoney(item.revenue),
      })),
    });
  } catch (err) {
    return handleDbError(res, 'GET /api/reports/sales', err);
  }
});

router.get('/vegetable-sales', authenticate, async (req, res) => {
  const range = parseRange(req, res);
  if (!range) return undefined;
  const { from, to } = range;

  try {
    const [itemRows] = await pool.execute(
      `SELECT
         p.nama_produk,
         n.jumlah,
         n.Subtotal,
         j.tanggal_penjualan
       FROM nota_penjualan n
       JOIN penjualan j ON j.penjualan_Id = n.penjualan_Id
       JOIN produk p ON p.kode_produk = n.kode_produk
       WHERE j.tanggal_penjualan >= ?
         AND j.tanggal_penjualan <= ?
         AND j.voided = 0
         AND p.is_scale = 1
       ORDER BY j.tanggal_penjualan DESC, p.nama_produk ASC`,
      [from, to]
    );

    const [expenseRows] = await pool.execute(
      `SELECT COALESCE(SUM(jumlah), 0) AS totalExpenses
       FROM pengeluaran
       WHERE tanggal >= ?
         AND tanggal <= ?
         AND keterangan = 'Vegetables'`,
      [from, to]
    );

    const items = itemRows.map((row) => ({
      date: row.tanggal_penjualan,
      product: row.nama_produk,
      weight: toQty(row.jumlah),
      amount: toMoney(row.Subtotal),
    }));

    const revenue = items.reduce((sum, item) => sum + item.amount, 0);
    const expenses = toMoney(expenseRows[0]?.totalExpenses);

    return res.json({
      revenue,
      items,
      expenses,
    });
  } catch (err) {
    return handleDbError(res, 'GET /api/reports/vegetable-sales', err);
  }
});

router.get('/sales/:penjualanId/lines', authenticate, async (req, res) => {
  const saleId = parsePositiveInt(req.params.penjualanId);
  if (saleId == null) {
    return res.status(400).json({ error: 'penjualanId must be a positive integer' });
  }

  try {
    const [sales] = await pool.execute(
      'SELECT penjualan_Id FROM penjualan WHERE penjualan_Id = ? LIMIT 1',
      [saleId]
    );
    if (!sales[0]) {
      return res.status(404).json({ error: 'Sale not found' });
    }

    const [rows] = await pool.execute(
      `SELECT
         pr.nama_produk,
         dp.jumlah,
         s.nama_satuan,
         dp.Subtotal
       FROM detail_penjualan dp
       JOIN produk pr ON dp.kode_produk = pr.kode_produk
       JOIN satuan s ON pr.satuan_Id = s.satuan_Id
       WHERE dp.penjualan_Id = ?
       ORDER BY pr.nama_produk ASC`,
      [saleId]
    );

    return res.json(rows.map((row) => ({
      name: row.nama_produk,
      qty: toQty(row.jumlah),
      unit: row.nama_satuan,
      subtotal: toMoney(row.Subtotal),
    })));
  } catch (err) {
    return handleDbError(res, 'GET /api/reports/sales/:penjualanId/lines', err);
  }
});

module.exports = router;
