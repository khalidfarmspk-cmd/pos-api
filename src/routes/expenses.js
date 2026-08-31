const { randomUUID } = require('crypto');
const express = require('express');
const { pool } = require('../db');
const { authenticate } = require('../middleware/auth');
const {
  isValidIsoDate,
  parseNonNegativeInt,
  requireTrimmedString,
  handleDbError,
} = require('../util');

const router = express.Router();

router.post('/', authenticate, async (req, res) => {
  const body = req.body || {};

  if (!isValidIsoDate(body.tanggal)) {
    return res.status(400).json({ error: 'tanggal must be YYYY-MM-DD' });
  }

  const jumlah = parseNonNegativeInt(body.jumlah);
  if (jumlah == null || jumlah <= 0) {
    return res.status(400).json({ error: 'jumlah must be a positive integer' });
  }

  const keterangan = body.keterangan == null || body.keterangan === ''
    ? 'Vegetables'
    : requireTrimmedString(body.keterangan, { maxLength: 255 });
  if (keterangan == null) {
    return res.status(400).json({ error: 'keterangan must be at most 255 characters' });
  }

  const userId = req.user?.user_Id;
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO pengeluaran (tanggal, kategori, keterangan, jumlah, user_Id, uuid)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [body.tanggal, 'Vegetables', keterangan, jumlah, userId, randomUUID()]
    );

    return res.status(201).json({
      expenseId: result.insertId,
      tanggal: body.tanggal,
      jumlah,
      keterangan,
    });
  } catch (err) {
    return handleDbError(res, 'POST /api/expenses', err);
  }
});

module.exports = router;
