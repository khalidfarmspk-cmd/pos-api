const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

function toMoney(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function toQty(value) {
  if (value == null) return '0';
  return String(value);
}

function mapProduct(row) {
  return {
    productCode: row.kode_produk,
    name: row.nama_produk,
    buyPrice: toMoney(row.harga_beli),
    sellPrice: toMoney(row.harga_jual),
    stock: toQty(row.stok_produk),
    supplierId: row.supplier_Id,
    supplier: row.nama_supplier,
    categoryId: row.kategori_Id,
    category: row.nama_kategori,
    brandId: row.merek_Id,
    brand: row.nama_merek,
    unitId: row.satuan_Id,
    unit: row.nama_satuan,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

function parsePositiveInt(value) {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

router.get('/', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         p.kode_produk,
         p.nama_produk,
         p.harga_beli,
         p.harga_jual,
         p.stok_produk,
         p.supplier_Id,
         sup.nama_supplier,
         p.kategori_Id,
         k.nama_kategori,
         p.merek_Id,
         m.nama_merek,
         p.satuan_Id,
         s.nama_satuan,
         p.uuid,
         p.updated_at
       FROM produk p
       JOIN kategori k ON p.kategori_Id = k.kategori_Id
       JOIN merek m ON p.merek_Id = m.merek_Id
       JOIN supplier sup ON p.supplier_Id = sup.supplier_Id
       JOIN satuan s ON p.satuan_Id = s.satuan_Id
       ORDER BY p.nama_produk ASC`
    );

    return res.json(rows.map(mapProduct));
  } catch (err) {
    console.error('GET /api/products failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:kode_produk', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const productCode = parsePositiveInt(req.params.kode_produk);
  if (productCode == null) {
    return res.status(400).json({ error: 'kode_produk must be a positive integer' });
  }

  const body = req.body || {};
  const buyPrice = parsePositiveInt(body.buyPrice);
  const sellPrice = parsePositiveInt(body.sellPrice);

  if (buyPrice == null || sellPrice == null) {
    return res.status(400).json({
      error: 'buyPrice and sellPrice are required and must be positive integers',
    });
  }

  try {
    const [result] = await pool.execute(
      `UPDATE produk
       SET harga_beli = ?, harga_jual = ?
       WHERE kode_produk = ?`,
      [buyPrice, sellPrice, productCode]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    return res.json({
      productCode,
      buyPrice,
      sellPrice,
    });
  } catch (err) {
    console.error('PUT /api/products/:kode_produk failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
