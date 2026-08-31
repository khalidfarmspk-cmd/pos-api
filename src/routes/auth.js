const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string'
      || !username.trim() || password.length === 0) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT user_Id, nama_user, username_user, password_user, level_user, status_user
       FROM users
       WHERE username_user = ?
       LIMIT 1`,
      [username.trim()]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordOk = await bcrypt.compare(password, user.password_user);
    if (!passwordOk) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (String(user.status_user).toUpperCase() !== 'AKTIF') {
      return res.status(403).json({ error: 'Account is not active' });
    }

    const token = jwt.sign(
      { user_Id: user.user_Id, level_user: user.level_user },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '365d' }
    );

    return res.json({
      token,
      user: {
        userId: user.user_Id,
        name: user.nama_user,
        username: user.username_user,
        role: user.level_user,
      },
    });
  } catch (err) {
    console.error('POST /api/auth/login failed:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
