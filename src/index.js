require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { ping } = require('./db');
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const dashboardRoutes = require('./routes/dashboard');
const reportRoutes = require('./routes/reports');
const categoryRoutes = require('./routes/categories');
const brandRoutes = require('./routes/brands');
const supplierRoutes = require('./routes/suppliers');
const unitRoutes = require('./routes/units');
const userRoutes = require('./routes/users');

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required');
  process.exit(1);
}

const app = express();

app.use(cors());
app.use(express.json());

app.get('/api/health', async (req, res) => {
  try {
    const db = await ping();
    if (!db) {
      return res.status(503).json({ ok: false, db: false });
    }
    return res.json({ ok: true, db: true });
  } catch (err) {
    console.error('GET /api/health failed:', err);
    return res.status(503).json({ ok: false, db: false });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/brands', brandRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/users', userRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`POS API listening on port ${port}`);
});
