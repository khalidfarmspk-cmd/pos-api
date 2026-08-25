const express = require('express');
const { pool } = require('../db');
const { authenticate, requireRole } = require('../middleware/auth');
const { handleDbError } = require('../util');

const router = express.Router();

router.get('/', authenticate, requireRole('PEMILIK'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
         user_Id,
         nama_user,
         alamat_user,
         telp_user,
         username_user,
         level_user,
         status_user
       FROM users
       ORDER BY nama_user ASC`
    );

    return res.json(rows.map((row) => ({
      userId: row.user_Id,
      name: row.nama_user,
      address: row.alamat_user,
      phone: row.telp_user,
      username: row.username_user,
      role: row.level_user,
      status: row.status_user,
    })));
  } catch (err) {
    return handleDbError(res, 'GET /api/users', err);
  }
});

module.exports = router;
