const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { parseBooleanFlag } = require('../util');

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
    isScale: Number(row.is_scale) === 1 ? 1 : 0,
    uuid: row.uuid,
    updatedAt: row.updated_at,
  };
}

function parseIsScale(body) {
  const raw = body.is_scale ?? body.isScale;
  if (raw == null || raw === '') return 0;
  return parseBooleanFlag(raw);
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

/** Integer money amount: 0 or greater (negatives rejected). */
function parseNonNegativeInt(value) {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    value = Number(value.trim());
  }
  if (!Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function parseStock(value) {
  if (value == null || value === '') return '0';
  const raw = String(value).trim();
  if (!/^-?\d+(\.\d{1,3})?$/.test(raw)) return null;
  return raw;
}

async function fetchMappedProduct(productCode) {
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
       p.is_scale,
       p.uuid,
       p.updated_at
     FROM produk p
     JOIN kategori k ON p.kategori_Id = k.kategori_Id
     JOIN merek m ON p.merek_Id = m.merek_Id
     JOIN supplier sup ON p.supplier_Id = sup.supplier_Id
     JOIN satuan s ON p.satuan_Id = s.satuan_Id
     WHERE p.kode_produk = ?
     LIMIT 1`,
    [productCode]
  );
  return rows[0] ? mapProduct(rows[0]) : null;
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
         p.is_scale,
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

router.post('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const body = req.body || {};
  const name = typeof body.nama_produk === 'string' ? body.nama_produk.trim() : '';
  const productCode = parsePositiveInt(body.kode_produk);
  const buyPrice = parseNonNegativeInt(body.harga_beli ?? body.buyPrice);
  const sellPrice = parseNonNegativeInt(body.harga_jual ?? body.sellPrice);
  const categoryId = parsePositiveInt(body.kategori_Id);
  const unitId = parsePositiveInt(body.satuan_Id);
  const stock = parseStock(body.stok_produk);
  const isScale = parseIsScale(body);

  if (!name || name.length > 30) {
    return res.status(400).json({ error: 'nama_produk is required (max 30 chars)' });
  }
  if (productCode == null || categoryId == null || unitId == null) {
    return res.status(400).json({
      error: 'kode_produk, kategori_Id, and satuan_Id must be positive integers',
    });
  }
  if (buyPrice == null || sellPrice == null) {
    return res.status(400).json({
      error: 'harga_beli and harga_jual must be integers >= 0',
    });
  }
  if (stock == null) {
    return res.status(400).json({ error: 'stok_produk must be a decimal number' });
  }
  if (isScale == null) {
    return res.status(400).json({ error: 'is_scale must be boolean or 0/1' });
  }

  try {
    const [[category], [unit], [brand], [supplier]] = await Promise.all([
      pool.execute('SELECT kategori_Id FROM kategori WHERE kategori_Id = ? LIMIT 1', [categoryId]),
      pool.execute('SELECT satuan_Id FROM satuan WHERE satuan_Id = ? LIMIT 1', [unitId]),
      pool.execute('SELECT merek_Id FROM merek ORDER BY merek_Id ASC LIMIT 1'),
      pool.execute('SELECT supplier_Id FROM supplier ORDER BY supplier_Id ASC LIMIT 1'),
    ]);

    if (!category[0]) {
      return res.status(400).json({ error: 'kategori_Id was not found' });
    }
    if (!unit[0]) {
      return res.status(400).json({ error: 'satuan_Id was not found' });
    }
    if (!brand[0] || !supplier[0]) {
      return res.status(400).json({ error: 'Add a brand and supplier before creating products' });
    }

    await pool.execute(
      `INSERT INTO produk (
         kode_produk, nama_produk, harga_beli, harga_jual, stok_produk,
         kategori_Id, merek_Id, supplier_Id, satuan_Id, is_scale, uuid
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productCode,
        name,
        buyPrice,
        sellPrice,
        stock,
        categoryId,
        brand[0].merek_Id,
        supplier[0].supplier_Id,
        unitId,
        isScale,
        randomUUID(),
      ]
    );

    return res.status(201).json(await fetchMappedProduct(productCode));
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'That barcode is already used' });
    }
    console.error('POST /api/products failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:kode_produk', authenticate, requireRole('PEMILIK'), async (req, res) => {
  const productCode = parsePositiveInt(req.params.kode_produk);
  if (productCode == null) {
    return res.status(400).json({ error: 'kode_produk must be a positive integer' });
  }

  const body = req.body || {};
  const buyPrice = parseNonNegativeInt(body.buyPrice ?? body.harga_beli);
  const sellPrice = parseNonNegativeInt(body.sellPrice ?? body.harga_jual);
  const hasIsScale = body.is_scale != null || body.isScale != null;
  const isScale = hasIsScale ? parseBooleanFlag(body.is_scale ?? body.isScale) : null;

  if (buyPrice == null || sellPrice == null) {
    return res.status(400).json({
      error: 'buyPrice and sellPrice are required and must be integers >= 0',
    });
  }
  if (hasIsScale && isScale == null) {
    return res.status(400).json({ error: 'is_scale must be boolean or 0/1' });
  }

  try {
    const [result] = hasIsScale
      ? await pool.execute(
          `UPDATE produk
           SET harga_beli = ?, harga_jual = ?, is_scale = ?
           WHERE kode_produk = ?`,
          [buyPrice, sellPrice, isScale, productCode]
        )
      : await pool.execute(
          `UPDATE produk
           SET harga_beli = ?, harga_jual = ?
           WHERE kode_produk = ?`,
          [buyPrice, sellPrice, productCode]
        );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const response = {
      productCode,
      buyPrice,
      sellPrice,
    };
    if (hasIsScale) {
      response.isScale = isScale;
    }
    return res.json(response);
  } catch (err) {
    console.error('PUT /api/products/:kode_produk failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
