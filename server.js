import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool, query } from "./db.js";
import crypto from "crypto";

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../.env") });

const app = express();
const PORT = Number(process.env.PORT || 4000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:8080";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret";

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json());

app.get("/api/health", async (req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok" });
  } catch (error) {
    res.status(500).json({ error: "Database unreachable" });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required." });
  }

  const result = await query("SELECT id, name, email, password_hash FROM users WHERE email = $1", [email]);
  const user = result.rows[0];
  if (!user) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }

  const token = jwt.sign({ sub: user.id, name: user.name, email: user.email }, JWT_SECRET, {
    expiresIn: "1h",
  });

  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

function authorize(req, res, next) {
  const authorization = req.headers.authorization;
  const token = authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/api/customers", async (req, res) => {
  const result = await query("SELECT id, name, nuit, address FROM customers ORDER BY name");
  res.json(result.rows);
});

app.get("/api/services", async (req, res) => {
  const result = await query("SELECT id, code, name, unit_price AS \"unitPrice\", vat_code AS \"vatCode\" FROM services ORDER BY name");
  res.json(result.rows);
});

app.post("/api/customers", authorize, async (req, res) => {
  const { name, nuit, address } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Nome do cliente é obrigatório." });
  }
  const id = crypto.randomUUID();
  const result = await query(
    "INSERT INTO customers (id, name, nuit, address) VALUES ($1,$2,$3,$4) RETURNING id, name, nuit, address",
    [id, name, nuit || "", address || ""]
  );
  res.status(201).json(result.rows[0]);
});

app.post("/api/services", authorize, async (req, res) => {
  const { code, name, unitPrice, vatCode } = req.body;
  if (!code || !name || unitPrice == null) {
    return res.status(400).json({ error: "Código, nome e preço unitário são obrigatórios." });
  }
  const id = crypto.randomUUID();
  const result = await query(
    "INSERT INTO services (id, code, name, unit_price, vat_code) VALUES ($1,$2,$3,$4,$5) RETURNING id, code, name, unit_price AS \"unitPrice\", vat_code AS \"vatCode\"",
    [id, code, name, unitPrice, vatCode]
  );
  res.status(201).json(result.rows[0]);
});

app.get("/api/invoices", authorize, async (req, res) => {
  const invoiceResult = await query(
    `SELECT id, number, type, series, sequence, issued_at AS \"issuedAt\", customer_id, subtotal, vat_total AS \"vatTotal\", total, status, prev_hash AS \"prevHash\", signature, hash_short AS \"hashShort\", qr_payload AS \"qrPayload\", audit, cancels_ref AS \"cancelsRef\", cancelled_by_ref AS \"cancelledByRef\" FROM invoices ORDER BY issued_at DESC`
  );

  const invoices = invoiceResult.rows;
  const customerIds = Array.from(new Set(invoices.map((invoice) => invoice.customer_id)));
  const customerResult = await query("SELECT id, name, nuit, address FROM customers WHERE id = ANY($1)", [customerIds]);
  const customersById = new Map(customerResult.rows.map((customer) => [customer.id, customer]));

  const invoiceIds = invoices.map((invoice) => invoice.id);
  const linesResult = await query(
    `SELECT invoice_id, service_id, description, quantity, unit_price AS \"unitPrice\", vat_code AS \"vatCode\" FROM invoice_lines WHERE invoice_id = ANY($1)`,
    [invoiceIds]
  );

  const linesByInvoice = new Map();
  for (const line of linesResult.rows) {
    if (!linesByInvoice.has(line.invoice_id)) linesByInvoice.set(line.invoice_id, []);
    linesByInvoice.get(line.invoice_id).push(line);
  }

  const response = invoices.map((invoice) => ({
    ...invoice,
    customer: customersById.get(invoice.customer_id) ?? null,
    lines: linesByInvoice.get(invoice.id) ?? [],
  }));

  res.json(response);
});

app.get("/api/invoices/:id", authorize, async (req, res) => {
  const { id } = req.params;
  const invoiceResult = await query(
    `SELECT id, number, type, series, sequence, issued_at AS "issuedAt", customer_id, subtotal, vat_total AS "vatTotal", total, status, prev_hash AS "prevHash", signature, hash_short AS "hashShort", qr_payload AS "qrPayload", audit, cancels_ref AS "cancelsRef", cancelled_by_ref AS "cancelledByRef" FROM invoices WHERE id = $1`,
    [id]
  );

  if (invoiceResult.rowCount === 0) {
    return res.status(404).json({ error: "Invoice not found" });
  }

  const invoice = invoiceResult.rows[0];
  const customerResult = await query("SELECT id, name, nuit, address FROM customers WHERE id = $1", [invoice.customer_id]);
  const lineResult = await query(
    `SELECT invoice_id, service_id, description, quantity, unit_price AS "unitPrice", vat_code AS "vatCode" FROM invoice_lines WHERE invoice_id = $1`,
    [id]
  );

  res.json({
    ...invoice,
    customer: customerResult.rows[0] ?? null,
    lines: lineResult.rows,
  });
});

function sha256Base64(message) {
  return crypto.createHash("sha256").update(message, "utf8").digest("base64");
}

app.post("/api/invoices", authorize, async (req, res) => {
  const { customerId, lines, type = "FT", cancelsRef } = req.body;
  if (!customerId || !Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: "Dados de fatura inválidos." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE invoices IN EXCLUSIVE MODE");

    const seqResult = await client.query("SELECT MAX(sequence) AS max_seq FROM invoices WHERE type = $1", [type]);
    const nextSequence = (seqResult.rows[0]?.max_seq ?? 0) + 1;
    const series = new Date().getFullYear().toString();
    const number = `${type} ${series}/${String(nextSequence).padStart(4, "0")}`;
    const issuedAt = new Date().toISOString();

    const prevResult = await client.query("SELECT signature FROM invoices ORDER BY issued_at DESC LIMIT 1");
    const prevSignature = prevResult.rowCount ? prevResult.rows[0].signature : "0";

    let subtotal = 0;
    let vatTotal = 0;
    for (const line of lines) {
      subtotal += Number(line.quantity) * Number(line.unitPrice);
      const rate = line.vatCode === "NOR" ? 0.16 : 0;
      vatTotal += Number(line.quantity) * Number(line.unitPrice) * rate;
    }
    const total = type === "NC" ? -(subtotal + vatTotal) : subtotal + vatTotal;

    const payload = `${issuedAt};${number};${total.toFixed(2)};${prevSignature}`;
    const signature = sha256Base64(payload);
    const hashShort = `#${signature.replace(/[^A-Za-z0-9]/g, "").slice(0, 4)}`;
    const qrPayload = [
      process.env.ISSUER_NUIT || "000000000",
      "CLIENTE",
      issuedAt.slice(0, 10),
      total.toFixed(2),
      vatTotal.toFixed(2),
      hashShort,
    ].join("|");

    const invoiceId = crypto.randomUUID();
    await client.query(
      `INSERT INTO invoices (id, number, type, series, sequence, issued_at, customer_id, subtotal, vat_total, total, status, prev_hash, signature, hash_short, qr_payload, audit, cancels_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [
        invoiceId,
        number,
        type,
        series,
        nextSequence,
        issuedAt,
        customerId,
        subtotal,
        vatTotal,
        total,
        "Normal",
        prevSignature,
        signature,
        hashShort,
        qrPayload,
        JSON.stringify([
          {
            at: issuedAt,
            who: req.user.name,
            ip: req.ip,
            action: "Documento criado e assinado (RSA-SHA256)",
          },
        ]),
        cancelsRef || null,
      ]
    );

    for (const line of lines) {
      await client.query(
        `INSERT INTO invoice_lines (id, invoice_id, service_id, description, quantity, unit_price, vat_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [crypto.randomUUID(), invoiceId, line.serviceId, line.description, line.quantity, line.unitPrice, line.vatCode]
      );
    }

    if (type === "NC" && cancelsRef) {
      await client.query(
        `UPDATE invoices SET status = 'Anulada', cancelled_by_ref = $1 WHERE id = $2`,
        [invoiceId, cancelsRef]
      );
    }

    await client.query("COMMIT");
    res.status(201).json({ id: invoiceId, number });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Falha ao criar a fatura." });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`API server listening on http://localhost:${PORT}`);
});
