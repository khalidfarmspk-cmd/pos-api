# POS API

Node.js + Express REST API for the Point of Sale system. It talks to the existing MySQL database (shared with the Java desktop app) and does **not** change the schema.

## Setup

1. Install [Node.js](https://nodejs.org/) 18 or later.
2. Copy the environment template and fill in values:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set database and auth values in `.env`:

   | Variable | Purpose |
   | --- | --- |
   | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | MySQL connection. On Railway these match `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`. |
   | `DB_SSL` | Set to `true` when using Railway’s public host. |
   | `JWT_SECRET` | Required signing secret for login tokens. Use a long random string. |
   | `JWT_EXPIRES_IN` | Optional token lifetime (default `12h`). |
   | `PORT` | HTTP port (default `3000`). Railway sets this automatically. |

   Railway’s `MYSQL*` names are also accepted as fallbacks if the `DB_*` variables are unset.

   **From your laptop, do not use `mysql.railway.internal`.** That host only works inside Railway. For local development, leave a tunnel running in a second terminal, then point `.env` at it (`DB_SSL=false`):

   ```powershell
   railway connect MySQL --tunnel-only -P 56359
   ```

   ```
   DB_HOST=127.0.0.1
   DB_PORT=56359
   DB_SSL=false
   ```

   Keep that tunnel process open while the API is running. `ECONNREFUSED 127.0.0.1:56359` means the tunnel is not running.

4. Install dependencies and start the server:

   ```bash
   npm install
   npm run dev
   ```

   Use `npm start` without file watching.

## Endpoints

All JSON field names are camelCase English. Money is returned as integers. Quantities (`stock`, line `jumlah`) are strings so `DECIMAL(12,3)` values are not rounded.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/api/health` | none | `{ ok: true, db: true }` after a database ping. `503` if MySQL is unreachable. |
| `POST` | `/api/auth/login` | none | Body: `{ "username", "password" }`. Inactive users (`status_user` ≠ `AKTIF`) get `403`. |
| `GET` | `/api/products` | JWT | Products joined to category, brand, supplier, and unit names. |
| `POST` | `/api/products` | JWT + `PEMILIK` | Body: `{ "nama_produk", "kode_produk", "harga_beli", "harga_jual", "kategori_Id", "stok_produk", "satuan_Id" }`. |
| `PUT` | `/api/products/:kode_produk` | JWT + `PEMILIK` | Body: `{ "buyPrice", "sellPrice" }` — positive integers only. |
| `GET` | `/api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD` | JWT | Sales in the date range, including cashier name. |
| `GET` | `/api/dashboard/summary?date=YYYY-MM-DD` | JWT | Defaults to today. `{ revenue, transactionCount, profit, productCount, lowStockCount }`. |
| `GET` | `/api/dashboard/recent-sales?limit=10` | JWT | Latest sales with `saleId`, `saleDate`, `total`, `cashierName`. |
| `GET` | `/api/dashboard/top-products?limit=5&days=7` | JWT | Ranked by quantity sold in the period; `qty` is a string. |
| `GET` | `/api/reports/sales?from=&to=` | JWT | Totals, `avgBasket`, `byDay`, and `topProducts`. |
| `GET` | `/api/reports/sales/:penjualanId/lines` | JWT | Line items: `name`, `qty`, `unit`, `subtotal`. |
| `GET` | `/api/categories` | JWT | Includes `productCount`. |
| `POST` | `/api/categories` | JWT + `PEMILIK` | Body: `{ "name", "shelfNumber" }`. Generates `uuid`. |
| `PUT` | `/api/categories/:id` | JWT + `PEMILIK` | Body: `{ "name", "shelfNumber" }`. |
| `GET` | `/api/brands` | JWT | Includes `productCount`. |
| `POST` | `/api/brands` | JWT + `PEMILIK` | Body: `{ "name" }`. Generates `uuid`. |
| `PUT` | `/api/brands/:id` | JWT + `PEMILIK` | Body: `{ "name" }`. |
| `GET` | `/api/suppliers` | JWT | Includes `productCount`. |
| `POST` | `/api/suppliers` | JWT + `PEMILIK` | Body: `{ "name", "address", "phone" }`. Generates `uuid`. |
| `PUT` | `/api/suppliers/:id` | JWT + `PEMILIK` | Body: `{ "name", "address", "phone" }`. |
| `GET` | `/api/units` | JWT | `{ unitId, name, allowDecimal, uuid, updatedAt }`. |
| `GET` | `/api/satuan` | JWT | Same rows as units, with both raw (`satuan_Id`, `nama_satuan`) and mapped (`unitId`, `name`) fields. |
| `POST` | `/api/units` | JWT + `PEMILIK` | Body: `{ "name", "allowDecimal" }`. Generates `uuid`. |
| `PUT` | `/api/units/:id` | JWT + `PEMILIK` | Body: `{ "name", "allowDecimal" }`. |
| `GET` | `/api/users` | JWT + `PEMILIK` | Never returns passwords. |
| `POST` | `/api/sync/sales` | JWT | Push a sale from the till (idempotent on `uuid`). |
| `POST` | `/api/sync/customers` | JWT | Push a customer from the till (idempotent on `uuid`). |
| `POST` | `/api/sync/stock` | JWT | Overwrite cloud stock from the shop (up to 500 items). |
| `GET` | `/api/sync/changes?since=` | JWT | Pull product price/name changes and settings since a timestamp. |

There are no DELETE routes for master data, and no sell / restock / stock-adjustment endpoints. Those stay on the desktop app. Duplicate master-data names return `409`.

Send the token as:

```
Authorization: Bearer <token>
```

## Sync (desktop ↔ cloud)

The shop’s local MySQL is authoritative for **sales**, **customers**, and **stock**. The cloud is authoritative for **prices** and **settings**. The till must not block on the network — these endpoints are for background sync and retries.

Cloud `detail_penjualan` inserts do **not** adjust stock (no `kurangiStok` / `restock` triggers). Stock is mirrored separately via `POST /api/sync/stock`.

### `POST /api/sync/sales`

Body:

```json
{
  "uuid": "sale-uuid",
  "tanggalPenjualan": "YYYY-MM-DD",
  "subtotalKotor": 0,
  "diskon": 0,
  "totalPembayaran": 0,
  "uangDiterima": 0,
  "uangKembalian": 0,
  "userId": 1,
  "pelangganUuid": null,
  "metodeId": null,
  "namaKurir": null,
  "voided": 0,
  "lines": [
    { "uuid": "line-uuid", "kodeProduk": 1, "jumlah": "1.000", "subtotal": 1000 }
  ]
}
```

- Idempotent on sale `uuid`. If the sale already exists, updates `voided` when it changed and returns `{ "status": "already_synced" }` without inserting duplicate lines.
- New sales return `201` with `{ "status": "synced" }`. Header and lines are one transaction.
- `penjualan_Id` is cloud `AUTO_INCREMENT` and will differ from the local id; `uuid` is the link.
- `pelangganUuid` is resolved to `pelanggan_Id`. Missing customers become `NULL` (customers sync separately).

### `POST /api/sync/customers`

Body: `{ "uuid", "namaPelanggan", "telpPelanggan", "alamatPelanggan", "updatedAt"? }`

- Insert if new; update only when incoming `updatedAt` is newer than the cloud row.

### `POST /api/sync/stock`

Body: `{ "items": [ { "kodeProduk", "stokProduk" } ] }` — max 500 items. Overwrites `produk.stok_produk` with the shop value.

### `GET /api/sync/changes?since=<ISO timestamp>`

Returns rows with `updated_at` after `since`:

```json
{
  "serverTime": "...",
  "products": [
    {
      "uuid": "...",
      "kodeProduk": 1,
      "namaProduk": "...",
      "hargaBeli": 0,
      "hargaJual": 0,
      "satuanId": 1,
      "updatedAt": "..."
    }
  ],
  "settings": [
    { "settingKey": "...", "settingValue": "...", "updatedAt": "..." }
  ]
}
```

`serverTime` comes from `SELECT NOW()` (not the Node clock). If `since` is missing or invalid, changes from the last 30 days are returned.

## Example

```bash
curl -s http://localhost:3000/api/health

curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"admin\",\"password\":\"your-password\"}"
```
