CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  nuit TEXT,
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  vat_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY,
  number TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,
  series TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  customer_id UUID NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL,
  vat_total NUMERIC(12,2) NOT NULL,
  total NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  prev_hash TEXT,
  signature TEXT,
  hash_short TEXT,
  qr_payload TEXT,
  audit JSONB,
  cancels_ref TEXT,
  cancelled_by_ref TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY,
  invoice_id UUID NOT NULL,
  service_id UUID,
  description TEXT,
  quantity NUMERIC(12,2) NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  vat_code TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
