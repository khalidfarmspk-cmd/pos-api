const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  toMoney,
  parsePositiveInt,
  parseNonNegativeInt,
  isValidIsoDate,
  requireTrimmedString,
  parseBooleanFlag,
  handleDbError,
  isValidUuid,
  parseMysqlDateTime,
  parseDecimalString,
  remainingActiveOwners,
} = require('../util');

const router = express.Router();

const MAX_STOCK_ITEMS = 500;

function parseNullableInt(value) {
  if (value == null || value === '') {
    return { ok: true, value: null };
  }
  const n = parsePositiveInt(value);
  if (n == null) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

function parseSaleBody(body) {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' };
  }

  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return { error: 'uuid must be a valid UUID' };
  }

  if (!isValidIsoDate(body.tanggalPenjualan)) {
    return { error: 'tanggalPenjualan must be YYYY-MM-DD' };
  }

  const subtotalKotor = parseNonNegativeInt(body.subtotalKotor);
  const diskon = parseNonNegativeInt(body.diskon);
  const totalPembayaran = parseNonNegativeInt(body.totalPembayaran);
  const uangDiterima = parseNonNegativeInt(body.uangDiterima);
  const uangKembalian = parseNonNegativeInt(body.uangKembalian);
  if (
    subtotalKotor == null
    || diskon == null
    || totalPembayaran == null
    || uangDiterima == null
    || uangKembalian == null
  ) {
    return {
      error: 'subtotalKotor, diskon, totalPembayaran, uangDiterima, and uangKembalian must be integers >= 0',
    };
  }

  const userId = parsePositiveInt(body.userId);
  if (userId == null) {
    return { error: 'userId must be a positive integer' };
  }

  let pelangganUuid = null;
  if (body.pelangganUuid != null && body.pelangganUuid !== '') {
    if (typeof body.pelangganUuid !== 'string' || !isValidUuid(body.pelangganUuid.trim())) {
      return { error: 'pelangganUuid must be a valid UUID or null' };
    }
    pelangganUuid = body.pelangganUuid.trim();
  }

  const metode = parseNullableInt(body.metodeId);
  if (!metode.ok) {
    return { error: 'metodeId must be a positive integer or null' };
  }

  let namaKurir = null;
  if (body.namaKurir != null && body.namaKurir !== '') {
    namaKurir = requireTrimmedString(body.namaKurir, { maxLength: 60 });
    if (namaKurir == null) {
      return { error: 'namaKurir must be a string of at most 60 characters' };
    }
  }

  const voided = parseBooleanFlag(body.voided);
  if (voided == null) {
    return { error: 'voided must be 0 or 1' };
  }

  if (!Array.isArray(body.lines)) {
    return { error: 'lines must be an array' };
  }

  const lines = [];
  for (let i = 0; i < body.lines.length; i += 1) {
    const line = body.lines[i];
    if (!line || typeof line !== 'object') {
      return { error: `lines[${i}] is invalid` };
    }
    const lineUuid = typeof line.uuid === 'string' ? line.uuid.trim() : '';
    if (!isValidUuid(lineUuid)) {
      return { error: `lines[${i}].uuid must be a valid UUID` };
    }
    const kodeProduk = parsePositiveInt(line.kodeProduk);
    if (kodeProduk == null) {
      return { error: `lines[${i}].kodeProduk must be a positive integer` };
    }
    const jumlah = parseDecimalString(line.jumlah);
    if (jumlah == null) {
      return { error: `lines[${i}].jumlah must be a non-negative decimal` };
    }
    const subtotal = parseNonNegativeInt(line.subtotal);
    if (subtotal == null) {
      return { error: `lines[${i}].subtotal must be an integer >= 0` };
    }
    lines.push({ uuid: lineUuid, kodeProduk, jumlah, subtotal });
  }

  return {
    value: {
      uuid,
      tanggalPenjualan: body.tanggalPenjualan,
      subtotalKotor,
      diskon,
      totalPembayaran,
      uangDiterima,
      uangKembalian,
      userId,
      pelangganUuid,
      metodeId: metode.value,
      namaKurir,
      voided,
      lines,
    },
  };
}

router.post('/sales', authenticate, async (req, res) => {
  const parsed = parseSaleBody(req.body);
  if (parsed.error) {
    return res.status(400).json({ error: parsed.error });
  }
  const sale = parsed.value;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [existingRows] = await conn.execute(
      'SELECT penjualan_Id, voided FROM penjualan WHERE uuid = ? LIMIT 1 FOR UPDATE',
      [sale.uuid]
    );

    if (existingRows[0]) {
      const existing = existingRows[0];
      const currentVoided = Number(existing.voided) === 1 ? 1 : 0;
      if (currentVoided !== sale.voided) {
        await conn.execute(
          'UPDATE penjualan SET voided = ? WHERE penjualan_Id = ?',
          [sale.voided, existing.penjualan_Id]
        );
      }
      await conn.commit();
      return res.json({ status: 'already_synced' });
    }

    let pelangganId = null;
    if (sale.pelangganUuid) {
      const [customers] = await conn.execute(
        'SELECT pelanggan_Id FROM pelanggan WHERE uuid = ? LIMIT 1',
        [sale.pelangganUuid]
      );
      if (customers[0]) {
        pelangganId = customers[0].pelanggan_Id;
      }
    }

    const [headerResult] = await conn.execute(
      `INSERT INTO penjualan (
         tanggal_penjualan,
         Total_pembayaran,
         uang_diterima,
         uang_kembalian,
         user_Id,
         uuid,
         pelanggan_Id,
         metode_Id,
         nama_kurir,
         subtotal_kotor,
         diskon,
         voided
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sale.tanggalPenjualan,
        sale.totalPembayaran,
        sale.uangDiterima,
        sale.uangKembalian,
        sale.userId,
        sale.uuid,
        pelangganId,
        sale.metodeId,
        sale.namaKurir,
        sale.subtotalKotor,
        sale.diskon,
        sale.voided,
      ]
    );

    const penjualanId = headerResult.insertId;

    for (const line of sale.lines) {
      await conn.execute(
        `INSERT INTO detail_penjualan (penjualan_Id, kode_produk, jumlah, Subtotal, uuid)
         VALUES (?, ?, ?, ?, ?)`,
        [penjualanId, line.kodeProduk, line.jumlah, line.subtotal, line.uuid]
      );
    }

    await conn.commit();
    return res.status(201).json({ status: 'synced' });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('POST /api/sync/sales rollback failed:', rollbackErr);
    }

    if (err && err.code === 'ER_DUP_ENTRY') {
      try {
        const [rows] = await pool.execute(
          'SELECT penjualan_Id, voided FROM penjualan WHERE uuid = ? LIMIT 1',
          [sale.uuid]
        );
        if (rows[0]) {
          const currentVoided = Number(rows[0].voided) === 1 ? 1 : 0;
          if (currentVoided !== sale.voided) {
            await pool.execute(
              'UPDATE penjualan SET voided = ? WHERE penjualan_Id = ?',
              [sale.voided, rows[0].penjualan_Id]
            );
          }
          return res.json({ status: 'already_synced' });
        }
      } catch (dupErr) {
        return handleDbError(res, 'POST /api/sync/sales (dup)', dupErr);
      }
    }

    return handleDbError(res, 'POST /api/sync/sales', err);
  } finally {
    conn.release();
  }
});

router.post('/customers', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }

  const namaPelanggan = requireTrimmedString(body.namaPelanggan, { maxLength: 60 });
  if (namaPelanggan == null) {
    return res.status(400).json({ error: 'namaPelanggan is required (max 60 chars)' });
  }

  let telpPelanggan = null;
  if (body.telpPelanggan != null && body.telpPelanggan !== '') {
    telpPelanggan = requireTrimmedString(body.telpPelanggan, { maxLength: 20, allowEmpty: true });
    if (telpPelanggan == null) {
      return res.status(400).json({ error: 'telpPelanggan must be at most 20 characters' });
    }
    if (telpPelanggan === '') {
      telpPelanggan = null;
    }
  }

  let alamatPelanggan = null;
  if (body.alamatPelanggan != null && body.alamatPelanggan !== '') {
    alamatPelanggan = requireTrimmedString(body.alamatPelanggan, { maxLength: 255, allowEmpty: true });
    if (alamatPelanggan == null) {
      return res.status(400).json({ error: 'alamatPelanggan must be at most 255 characters' });
    }
    if (alamatPelanggan === '') {
      alamatPelanggan = null;
    }
  }

  const incomingUpdatedAt = body.updatedAt == null || body.updatedAt === ''
    ? null
    : parseMysqlDateTime(body.updatedAt);
  if (body.updatedAt != null && body.updatedAt !== '' && incomingUpdatedAt == null) {
    return res.status(400).json({ error: 'updatedAt must be a valid ISO timestamp' });
  }

  try {
    const [existingRows] = await pool.execute(
      'SELECT pelanggan_Id, updated_at FROM pelanggan WHERE uuid = ? LIMIT 1',
      [uuid]
    );

    if (!existingRows[0]) {
      if (incomingUpdatedAt) {
        await pool.execute(
          `INSERT INTO pelanggan (nama_pelanggan, telp_pelanggan, alamat_pelanggan, uuid, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
          [namaPelanggan, telpPelanggan, alamatPelanggan, uuid, incomingUpdatedAt]
        );
      } else {
        await pool.execute(
          `INSERT INTO pelanggan (nama_pelanggan, telp_pelanggan, alamat_pelanggan, uuid)
           VALUES (?, ?, ?, ?)`,
          [namaPelanggan, telpPelanggan, alamatPelanggan, uuid]
        );
      }
      return res.status(201).json({ status: 'synced' });
    }

    if (incomingUpdatedAt == null) {
      return res.json({ status: 'already_synced' });
    }

    const existingUpdatedAt = parseMysqlDateTime(String(existingRows[0].updated_at));
    if (existingUpdatedAt != null && incomingUpdatedAt <= existingUpdatedAt) {
      return res.json({ status: 'already_synced' });
    }

    await pool.execute(
      `UPDATE pelanggan
       SET nama_pelanggan = ?, telp_pelanggan = ?, alamat_pelanggan = ?, updated_at = ?
       WHERE pelanggan_Id = ?`,
      [namaPelanggan, telpPelanggan, alamatPelanggan, incomingUpdatedAt, existingRows[0].pelanggan_Id]
    );

    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/customers', err);
  }
});

router.post('/stock', authenticate, async (req, res) => {
  const body = req.body || {};
  if (!Array.isArray(body.items)) {
    return res.status(400).json({ error: 'items must be an array' });
  }
  if (body.items.length > MAX_STOCK_ITEMS) {
    return res.status(400).json({
      error: `items must contain at most ${MAX_STOCK_ITEMS} entries`,
    });
  }

  const items = [];
  for (let i = 0; i < body.items.length; i += 1) {
    const item = body.items[i];
    if (!item || typeof item !== 'object') {
      return res.status(400).json({ error: `items[${i}] is invalid` });
    }
    const kodeProduk = parsePositiveInt(item.kodeProduk);
    if (kodeProduk == null) {
      return res.status(400).json({
        error: `items[${i}].kodeProduk must be a positive integer`,
      });
    }
    const stokProduk = parseDecimalString(item.stokProduk);
    if (stokProduk == null) {
      return res.status(400).json({
        error: `items[${i}].stokProduk must be a non-negative decimal`,
      });
    }
    items.push({ kodeProduk, stokProduk });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let updated = 0;
    for (const item of items) {
      const [result] = await conn.execute(
        'UPDATE produk SET stok_produk = ? WHERE kode_produk = ?',
        [item.stokProduk, item.kodeProduk]
      );
      updated += result.affectedRows;
    }
    await conn.commit();
    return res.json({ status: 'synced', updated });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('POST /api/sync/stock rollback failed:', rollbackErr);
    }
    return handleDbError(res, 'POST /api/sync/stock', err);
  } finally {
    conn.release();
  }
});

router.get('/changes', authenticate, async (req, res) => {
  const sinceParam = req.query.since;
  let since = null;
  if (sinceParam != null && sinceParam !== '') {
    since = parseMysqlDateTime(String(sinceParam));
    if (since == null) {
      since = null;
    }
  }

  try {
    const [[clock]] = await pool.execute(
      'SELECT NOW() AS serverTime, DATE_SUB(NOW(), INTERVAL 30 DAY) AS defaultSince'
    );
    const serverTime = clock.serverTime;
    const sinceValue = since || clock.defaultSince;

    const [productRows] = await pool.execute(
      `SELECT p.uuid, p.kode_produk, p.nama_produk, p.harga_beli, p.harga_jual, p.stok_produk,
              p.merek_Id, p.is_scale, p.updated_at,
              k.uuid AS kategori_uuid, s.uuid AS supplier_uuid, u.uuid AS satuan_uuid
       FROM produk p
       LEFT JOIN kategori k ON p.kategori_Id = k.kategori_Id
       LEFT JOIN supplier s ON p.supplier_Id = s.supplier_Id
       LEFT JOIN satuan u ON p.satuan_Id = u.satuan_Id
       WHERE p.updated_at > ?
       ORDER BY p.updated_at ASC`,
      [sinceValue]
    );

    const [settingRows] = await pool.execute(
      `SELECT setting_key, setting_value, updated_at
       FROM pengaturan
       WHERE updated_at > ?
       ORDER BY updated_at ASC`,
      [sinceValue]
    );

    const [categoryRows] = await pool.execute(
      `SELECT uuid, nama_kategori, no_rak, updated_at
       FROM kategori WHERE updated_at > ? ORDER BY updated_at ASC`,
      [sinceValue]
    );

    const [supplierRows] = await pool.execute(
      `SELECT uuid, nama_supplier, alamat_supplier, telp_supplier, updated_at
       FROM supplier WHERE updated_at > ? ORDER BY updated_at ASC`,
      [sinceValue]
    );

    const [customerRows] = await pool.execute(
      `SELECT uuid, nama_pelanggan, telp_pelanggan, alamat_pelanggan, updated_at
       FROM pelanggan WHERE updated_at > ? ORDER BY updated_at ASC`,
      [sinceValue]
    );

    let userRows = [];
    try {
      const [rows] = await pool.execute(
        `SELECT uuid, nama_user, username_user, password_user, level_user, status_user, updated_at
         FROM users WHERE updated_at > ? ORDER BY updated_at ASC`,
        [sinceValue]
      );
      userRows = rows;
    } catch (userErr) {
      // users.uuid / updated_at may not exist until migration_010
      console.warn('GET /api/sync/changes users skipped:', userErr.message);
    }

    let deletedUserRows = [];
    try {
      const [rows] = await pool.execute(
        `SELECT uuid, deleted_at FROM deleted_users WHERE deleted_at > ? ORDER BY deleted_at ASC`,
        [sinceValue]
      );
      deletedUserRows = rows;
    } catch (delErr) {
      // deleted_users does not exist until migration_014
      console.warn('GET /api/sync/changes deleted_users skipped:', delErr.message);
    }

    return res.json({
      serverTime,
      products: productRows.map((row) => ({
        uuid: row.uuid,
        kodeProduk: row.kode_produk,
        namaProduk: row.nama_produk,
        hargaBeli: toMoney(row.harga_beli),
        hargaJual: toMoney(row.harga_jual),
        stokProduk: row.stok_produk == null ? '0.000' : String(row.stok_produk),
        merekId: row.merek_Id,
        isScale: Number(row.is_scale) === 1 ? 1 : 0,
        kategoriUuid: row.kategori_uuid,
        supplierUuid: row.supplier_uuid,
        satuanUuid: row.satuan_uuid,
        updatedAt: row.updated_at,
      })),
      settings: settingRows.map((row) => ({
        settingKey: row.setting_key,
        settingValue: row.setting_value == null ? null : String(row.setting_value),
        updatedAt: row.updated_at,
      })),
      categories: categoryRows.map((row) => ({
        uuid: row.uuid,
        namaKategori: row.nama_kategori,
        noRak: row.no_rak,
        updatedAt: row.updated_at,
      })),
      suppliers: supplierRows.map((row) => ({
        uuid: row.uuid,
        namaSupplier: row.nama_supplier,
        alamatSupplier: row.alamat_supplier,
        telpSupplier: row.telp_supplier,
        updatedAt: row.updated_at,
      })),
      customers: customerRows.map((row) => ({
        uuid: row.uuid,
        namaPelanggan: row.nama_pelanggan,
        telpPelanggan: row.telp_pelanggan,
        alamatPelanggan: row.alamat_pelanggan,
        updatedAt: row.updated_at,
      })),
      users: userRows.map((row) => ({
        uuid: row.uuid,
        namaUser: row.nama_user,
        usernameUser: row.username_user,
        passwordHash: row.password_user,
        levelUser: row.level_user,
        statusUser: row.status_user,
        updatedAt: row.updated_at,
      })),
      deletedUsers: deletedUserRows.map((row) => ({
        uuid: row.uuid,
        deletedAt: row.deleted_at,
      })),
    });
  } catch (err) {
    return handleDbError(res, 'GET /api/sync/changes', err);
  }
});

async function resolveUuidToId(conn, table, idCol, uuid) {
  if (!uuid) return null;
  const [rows] = await conn.execute(
    `SELECT ${idCol} AS id FROM ${table} WHERE uuid = ? LIMIT 1`,
    [uuid]
  );
  return rows[0] ? rows[0].id : null;
}

function parseIncomingUpdatedAt(body) {
  if (body.updatedAt == null || body.updatedAt === '') {
    return { ok: true, value: null };
  }
  const parsed = parseMysqlDateTime(body.updatedAt);
  if (parsed == null) {
    return { ok: false };
  }
  return { ok: true, value: parsed };
}

router.post('/products', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }
  const kodeProduk = parsePositiveInt(body.kodeProduk);
  if (kodeProduk == null) {
    return res.status(400).json({ error: 'kodeProduk must be a positive integer' });
  }
  const namaProduk = requireTrimmedString(body.namaProduk, { maxLength: 100 });
  if (namaProduk == null) {
    return res.status(400).json({ error: 'namaProduk is required' });
  }
  const stokProduk = parseDecimalString(body.stokProduk, { allowNegative: true });
  if (stokProduk == null) {
    return res.status(400).json({ error: 'stokProduk must be a decimal' });
  }
  const hargaBeli = parseNonNegativeInt(body.hargaBeli);
  const hargaJual = parseNonNegativeInt(body.hargaJual);
  if (hargaBeli == null || hargaJual == null) {
    return res.status(400).json({ error: 'hargaBeli and hargaJual must be integers >= 0' });
  }
  const merekId = body.merekId == null || body.merekId === ''
    ? null
    : parsePositiveInt(body.merekId);
  const isScaleRaw = body.isScale ?? body.is_scale;
  const isScale = isScaleRaw == null ? 0 : parseBooleanFlag(isScaleRaw);
  if (isScale == null) {
    return res.status(400).json({ error: 'isScale must be boolean or 0/1' });
  }
  const updatedAtParsed = parseIncomingUpdatedAt(body);
  if (!updatedAtParsed.ok) {
    return res.status(400).json({ error: 'updatedAt must be a valid ISO timestamp' });
  }
  const incomingUpdatedAt = updatedAtParsed.value;

  let kategoriUuid = null;
  if (body.kategoriUuid != null && body.kategoriUuid !== '') {
    if (typeof body.kategoriUuid !== 'string' || !isValidUuid(body.kategoriUuid.trim())) {
      return res.status(400).json({ error: 'kategoriUuid must be a valid UUID or null' });
    }
    kategoriUuid = body.kategoriUuid.trim();
  }
  let supplierUuid = null;
  if (body.supplierUuid != null && body.supplierUuid !== '') {
    if (typeof body.supplierUuid !== 'string' || !isValidUuid(body.supplierUuid.trim())) {
      return res.status(400).json({ error: 'supplierUuid must be a valid UUID or null' });
    }
    supplierUuid = body.supplierUuid.trim();
  }
  let satuanUuid = null;
  if (body.satuanUuid != null && body.satuanUuid !== '') {
    if (typeof body.satuanUuid !== 'string' || !isValidUuid(body.satuanUuid.trim())) {
      return res.status(400).json({ error: 'satuanUuid must be a valid UUID or null' });
    }
    satuanUuid = body.satuanUuid.trim();
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const kategoriId = await resolveUuidToId(conn, 'kategori', 'kategori_Id', kategoriUuid);
    const supplierId = await resolveUuidToId(conn, 'supplier', 'supplier_Id', supplierUuid);
    const satuanId = await resolveUuidToId(conn, 'satuan', 'satuan_Id', satuanUuid);

    const [existingRows] = await conn.execute(
      'SELECT kode_produk, updated_at FROM produk WHERE uuid = ? LIMIT 1 FOR UPDATE',
      [uuid]
    );

    if (!existingRows[0]) {
      await conn.execute(
        `INSERT INTO produk (
           kode_produk, nama_produk, harga_beli, harga_jual, stok_produk,
           kategori_Id, merek_Id, supplier_Id, satuan_Id, is_scale, uuid, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [
          kodeProduk,
          namaProduk,
          hargaBeli,
          hargaJual,
          stokProduk,
          kategoriId,
          merekId || 1,
          supplierId,
          satuanId || 1,
          isScale,
          uuid,
          incomingUpdatedAt,
        ]
      );
      await conn.commit();
      return res.status(201).json({ status: 'synced' });
    }

    if (incomingUpdatedAt == null) {
      await conn.commit();
      return res.json({ status: 'already_synced' });
    }
    const existingUpdatedAt = parseMysqlDateTime(String(existingRows[0].updated_at));
    if (existingUpdatedAt != null && incomingUpdatedAt <= existingUpdatedAt) {
      await conn.commit();
      return res.json({ status: 'already_synced' });
    }

    // Never overwrite harga_jual / harga_beli from shop push — admin-only via changes pull.
    await conn.execute(
      `UPDATE produk
       SET nama_produk = ?, stok_produk = ?,
           kategori_Id = COALESCE(?, kategori_Id),
           merek_Id = COALESCE(?, merek_Id),
           supplier_Id = COALESCE(?, supplier_Id),
           satuan_Id = COALESCE(?, satuan_Id),
           is_scale = ?,
           updated_at = ?
       WHERE uuid = ?`,
      [
        namaProduk,
        stokProduk,
        kategoriId,
        merekId,
        supplierId,
        satuanId,
        isScale,
        incomingUpdatedAt,
        uuid,
      ]
    );
    await conn.commit();
    return res.json({ status: 'synced' });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('POST /api/sync/products rollback failed:', rollbackErr);
    }
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.json({ status: 'already_synced' });
    }
    return handleDbError(res, 'POST /api/sync/products', err);
  } finally {
    conn.release();
  }
});

router.post('/categories', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }
  const namaKategori = requireTrimmedString(body.namaKategori, { maxLength: 60 });
  if (namaKategori == null) {
    return res.status(400).json({ error: 'namaKategori is required' });
  }
  const noRak = requireTrimmedString(body.noRak || '', { maxLength: 20, allowEmpty: true }) || '';
  const updatedAtParsed = parseIncomingUpdatedAt(body);
  if (!updatedAtParsed.ok) {
    return res.status(400).json({ error: 'updatedAt must be a valid ISO timestamp' });
  }
  const incomingUpdatedAt = updatedAtParsed.value;

  try {
    const [existingRows] = await pool.execute(
      'SELECT kategori_Id, updated_at FROM kategori WHERE uuid = ? LIMIT 1',
      [uuid]
    );
    if (!existingRows[0]) {
      await pool.execute(
        `INSERT INTO kategori (nama_kategori, no_rak, uuid, updated_at)
         VALUES (?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [namaKategori, noRak, uuid, incomingUpdatedAt]
      );
      return res.status(201).json({ status: 'synced' });
    }
    if (incomingUpdatedAt == null) {
      return res.json({ status: 'already_synced' });
    }
    const existingUpdatedAt = parseMysqlDateTime(String(existingRows[0].updated_at));
    if (existingUpdatedAt != null && incomingUpdatedAt <= existingUpdatedAt) {
      return res.json({ status: 'already_synced' });
    }
    await pool.execute(
      `UPDATE kategori SET nama_kategori = ?, no_rak = ?, updated_at = ? WHERE uuid = ?`,
      [namaKategori, noRak, incomingUpdatedAt, uuid]
    );
    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/categories', err);
  }
});

router.post('/suppliers', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }
  const namaSupplier = requireTrimmedString(body.namaSupplier, { maxLength: 60 });
  if (namaSupplier == null) {
    return res.status(400).json({ error: 'namaSupplier is required' });
  }
  const alamatSupplier = requireTrimmedString(body.alamatSupplier || '', { maxLength: 255, allowEmpty: true }) || '';
  const telpSupplier = requireTrimmedString(body.telpSupplier || '', { maxLength: 20, allowEmpty: true }) || '';
  const updatedAtParsed = parseIncomingUpdatedAt(body);
  if (!updatedAtParsed.ok) {
    return res.status(400).json({ error: 'updatedAt must be a valid ISO timestamp' });
  }
  const incomingUpdatedAt = updatedAtParsed.value;

  try {
    const [existingRows] = await pool.execute(
      'SELECT supplier_Id, updated_at FROM supplier WHERE uuid = ? LIMIT 1',
      [uuid]
    );
    if (!existingRows[0]) {
      await pool.execute(
        `INSERT INTO supplier (nama_supplier, alamat_supplier, telp_supplier, uuid, updated_at)
         VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [namaSupplier, alamatSupplier, telpSupplier, uuid, incomingUpdatedAt]
      );
      return res.status(201).json({ status: 'synced' });
    }
    if (incomingUpdatedAt == null) {
      return res.json({ status: 'already_synced' });
    }
    const existingUpdatedAt = parseMysqlDateTime(String(existingRows[0].updated_at));
    if (existingUpdatedAt != null && incomingUpdatedAt <= existingUpdatedAt) {
      return res.json({ status: 'already_synced' });
    }
    await pool.execute(
      `UPDATE supplier SET nama_supplier = ?, alamat_supplier = ?, telp_supplier = ?, updated_at = ?
       WHERE uuid = ?`,
      [namaSupplier, alamatSupplier, telpSupplier, incomingUpdatedAt, uuid]
    );
    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/suppliers', err);
  }
});

router.post('/purchases', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }
  if (!isValidIsoDate(body.tanggalPembelian)) {
    return res.status(400).json({ error: 'tanggalPembelian must be YYYY-MM-DD' });
  }
  const userId = parsePositiveInt(body.userId);
  if (userId == null) {
    return res.status(400).json({ error: 'userId must be a positive integer' });
  }
  if (!Array.isArray(body.lines)) {
    return res.status(400).json({ error: 'lines must be an array' });
  }
  const lines = [];
  for (let i = 0; i < body.lines.length; i += 1) {
    const line = body.lines[i];
    if (!line || typeof line !== 'object') {
      return res.status(400).json({ error: `lines[${i}] is invalid` });
    }
    const lineUuid = typeof line.uuid === 'string' ? line.uuid.trim() : '';
    if (!isValidUuid(lineUuid)) {
      return res.status(400).json({ error: `lines[${i}].uuid must be a valid UUID` });
    }
    const kodeProduk = parsePositiveInt(line.kodeProduk);
    if (kodeProduk == null) {
      return res.status(400).json({ error: `lines[${i}].kodeProduk must be a positive integer` });
    }
    const jumlah = parseDecimalString(line.jumlah);
    if (jumlah == null) {
      return res.status(400).json({ error: `lines[${i}].jumlah must be a non-negative decimal` });
    }
    lines.push({ uuid: lineUuid, kodeProduk, jumlah });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [existingRows] = await conn.execute(
      'SELECT pembelian_Id FROM pembelian WHERE uuid = ? LIMIT 1 FOR UPDATE',
      [uuid]
    );
    if (existingRows[0]) {
      await conn.commit();
      return res.json({ status: 'already_synced' });
    }

    const [headerResult] = await conn.execute(
      `INSERT INTO pembelian (tanggal_pembelian, user_Id, uuid) VALUES (?, ?, ?)`,
      [body.tanggalPembelian, userId, uuid]
    );
    const pembelianId = headerResult.insertId;
    for (const line of lines) {
      await conn.execute(
        `INSERT INTO detail_pembelian (pembelian_Id, kode_produk, jumlah, uuid) VALUES (?, ?, ?, ?)`,
        [pembelianId, line.kodeProduk, line.jumlah, line.uuid]
      );
    }
    await conn.commit();
    return res.status(201).json({ status: 'synced' });
  } catch (err) {
    try {
      await conn.rollback();
    } catch (rollbackErr) {
      console.error('POST /api/sync/purchases rollback failed:', rollbackErr);
    }
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.json({ status: 'already_synced' });
    }
    return handleDbError(res, 'POST /api/sync/purchases', err);
  } finally {
    conn.release();
  }
});

router.post('/expenses', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }
  if (!isValidIsoDate(body.tanggal)) {
    return res.status(400).json({ error: 'tanggal must be YYYY-MM-DD' });
  }
  const kategori = requireTrimmedString(body.kategori, { maxLength: 60 });
  if (kategori == null) {
    return res.status(400).json({ error: 'kategori is required' });
  }
  let keterangan = null;
  if (body.keterangan != null && body.keterangan !== '') {
    keterangan = requireTrimmedString(body.keterangan, { maxLength: 255, allowEmpty: true });
  }
  const jumlah = parseNonNegativeInt(body.jumlah);
  if (jumlah == null) {
    return res.status(400).json({ error: 'jumlah must be an integer >= 0' });
  }
  const userId = parsePositiveInt(body.userId);
  if (userId == null) {
    return res.status(400).json({ error: 'userId must be a positive integer' });
  }
  const updatedAtParsed = parseIncomingUpdatedAt(body);
  if (!updatedAtParsed.ok) {
    return res.status(400).json({ error: 'updatedAt must be a valid ISO timestamp' });
  }
  const incomingUpdatedAt = updatedAtParsed.value;

  try {
    const [existingRows] = await pool.execute(
      'SELECT pengeluaran_Id, updated_at FROM pengeluaran WHERE uuid = ? LIMIT 1',
      [uuid]
    );
    if (!existingRows[0]) {
      await pool.execute(
        `INSERT INTO pengeluaran (tanggal, kategori, keterangan, jumlah, user_Id, uuid, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [body.tanggal, kategori, keterangan, jumlah, userId, uuid, incomingUpdatedAt]
      );
      return res.status(201).json({ status: 'synced' });
    }
    if (incomingUpdatedAt == null) {
      return res.json({ status: 'already_synced' });
    }
    const existingUpdatedAt = parseMysqlDateTime(String(existingRows[0].updated_at));
    if (existingUpdatedAt != null && incomingUpdatedAt <= existingUpdatedAt) {
      return res.json({ status: 'already_synced' });
    }
    await pool.execute(
      `UPDATE pengeluaran
       SET tanggal = ?, kategori = ?, keterangan = ?, jumlah = ?, user_Id = ?, updated_at = ?
       WHERE uuid = ?`,
      [body.tanggal, kategori, keterangan, jumlah, userId, incomingUpdatedAt, uuid]
    );
    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/expenses', err);
  }
});

// Till -> cloud user push. Accepts both roles: single-shop deployment where the
// same operator owns the till and the dashboard, so owners created at the till
// are expected to reach the web too.
router.post('/users', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }

  const namaUser = requireTrimmedString(body.namaUser, { maxLength: 30 });
  if (namaUser == null) {
    return res.status(400).json({ error: 'namaUser is required (max 30 chars)' });
  }

  const usernameUser = requireTrimmedString(body.usernameUser, { maxLength: 30 });
  if (usernameUser == null) {
    return res.status(400).json({ error: 'usernameUser is required (max 30 chars)' });
  }

  const passwordHash = requireTrimmedString(body.passwordHash, { maxLength: 255 });
  if (passwordHash == null || !/^\$2[aby]\$/.test(passwordHash)) {
    return res.status(400).json({ error: 'passwordHash must be a bcrypt hash' });
  }

  const levelUser = typeof body.levelUser === 'string' ? body.levelUser.trim().toUpperCase() : '';
  if (levelUser !== 'KARYAWAN' && levelUser !== 'PEMILIK') {
    return res.status(400).json({ error: 'levelUser must be PEMILIK or KARYAWAN' });
  }

  const statusUser = typeof body.statusUser === 'string' ? body.statusUser.trim().toUpperCase() : '';
  if (statusUser !== 'AKTIF' && statusUser !== 'NONAKTIF') {
    return res.status(400).json({ error: 'statusUser must be AKTIF or NONAKTIF' });
  }

  const alamatUser = body.alamatUser == null ? '' : String(body.alamatUser).trim().slice(0, 30);
  const telpUser = body.telpUser == null ? '' : String(body.telpUser).trim().slice(0, 13);

  const parsedUpdatedAt = parseIncomingUpdatedAt(body);
  if (!parsedUpdatedAt.ok) {
    return res.status(400).json({ error: 'updatedAt must be a valid ISO timestamp' });
  }
  const incomingUpdatedAt = parsedUpdatedAt.value;

  try {
    // Reject a username already held by a different account before we touch anything.
    const [clash] = await pool.execute(
      'SELECT user_Id FROM users WHERE username_user = ? AND uuid <> ? LIMIT 1',
      [usernameUser, uuid]
    );
    if (clash[0]) {
      return res.status(409).json({ error: `username ${usernameUser} is already taken` });
    }

    const [existingRows] = await pool.execute(
      'SELECT user_Id, level_user, updated_at FROM users WHERE uuid = ? LIMIT 1',
      [uuid]
    );

    if (!existingRows[0]) {
      await pool.execute(
        `INSERT INTO users (nama_user, alamat_user, telp_user, username_user,
                            password_user, level_user, status_user, uuid, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${incomingUpdatedAt ? '?' : 'CURRENT_TIMESTAMP'})`,
        incomingUpdatedAt
          ? [namaUser, alamatUser, telpUser, usernameUser, passwordHash, levelUser, statusUser, uuid, incomingUpdatedAt]
          : [namaUser, alamatUser, telpUser, usernameUser, passwordHash, levelUser, statusUser, uuid]
      );
      return res.status(201).json({ status: 'synced' });
    }

    if (incomingUpdatedAt == null) {
      return res.json({ status: 'already_synced' });
    }

    const existingUpdatedAt = parseMysqlDateTime(String(existingRows[0].updated_at));
    if (existingUpdatedAt != null && incomingUpdatedAt <= existingUpdatedAt) {
      return res.json({ status: 'already_synced' });
    }

    await pool.execute(
      `UPDATE users
       SET nama_user = ?, alamat_user = ?, telp_user = ?, username_user = ?,
           password_user = ?, level_user = ?, status_user = ?, updated_at = ?
       WHERE user_Id = ?`,
      [namaUser, alamatUser, telpUser, usernameUser, passwordHash, levelUser,
       statusUser, incomingUpdatedAt, existingRows[0].user_Id]
    );

    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/users', err);
  }
});

// Till -> cloud user deletion. Writes a tombstone even when the row is already
// gone, so the delete still reaches any other client via /sync/changes.
router.post('/users/delete', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT user_Id, level_user, status_user FROM users WHERE uuid = ? LIMIT 1',
      [uuid]
    );

    if (rows[0] && rows[0].level_user === 'PEMILIK' && rows[0].status_user === 'AKTIF') {
      const survivors = await remainingActiveOwners(pool, { excludeUuid: uuid });
      if (survivors === 0) {
        return res.status(409).json({ error: 'refusing to delete the last active owner account' });
      }
    }

    if (rows[0]) {
      await pool.execute('DELETE FROM users WHERE uuid = ?', [uuid]);
    }
    await pool.execute(
      `INSERT INTO deleted_users (uuid) VALUES (?)
       ON DUPLICATE KEY UPDATE deleted_at = CURRENT_TIMESTAMP`,
      [uuid]
    );

    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/users/delete', err);
  }
});

// Till -> cloud customer removal. The cloud row has to go as well, otherwise
// the till's next pull would re-insert the customer it just deleted.
router.post('/customers/delete', authenticate, async (req, res) => {
  const body = req.body || {};
  const uuid = typeof body.uuid === 'string' ? body.uuid.trim() : '';
  if (!isValidUuid(uuid)) {
    return res.status(400).json({ error: 'uuid must be a valid UUID' });
  }

  try {
    const [rows] = await pool.execute(
      'SELECT pelanggan_Id FROM pelanggan WHERE uuid = ? LIMIT 1',
      [uuid]
    );
    if (!rows[0]) {
      return res.json({ status: 'already_synced' });
    }

    // penjualan.pelanggan_Id restricts deletes; report it rather than 500ing.
    const [sales] = await pool.execute(
      'SELECT COUNT(*) AS n FROM penjualan WHERE pelanggan_Id = ?',
      [rows[0].pelanggan_Id]
    );
    if (Number(sales[0].n) > 0) {
      return res.status(409).json({
        error: `customer is referenced by ${sales[0].n} sale(s) and cannot be deleted`,
      });
    }

    await pool.execute('DELETE FROM pelanggan WHERE uuid = ?', [uuid]);
    return res.json({ status: 'synced' });
  } catch (err) {
    return handleDbError(res, 'POST /api/sync/customers/delete', err);
  }
});

module.exports = router;
