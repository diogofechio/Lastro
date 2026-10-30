import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.LASTRO_DB_PATH || path.join(__dirname, 'data', 'rendimentos.db');
const DEFAULT_ANNUAL_CDI_RATE = 13.65;
const DEFAULT_CDI_RATE_DATE = '2026-10-29';
const CDI_SGS_URL = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json';
const CDI_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
let externalFetch = globalThis.fetch;
let cdiLastCheckedAt = 0;
let cdiRefreshPromise = null;

async function refreshAnnualCdiRate() {
  if (cdiRefreshPromise) return cdiRefreshPromise.catch(() => {});
  if (Date.now() - cdiLastCheckedAt < CDI_REFRESH_INTERVAL_MS) return;
  cdiLastCheckedAt = Date.now();

  cdiRefreshPromise = (async () => {
    const response = await externalFetch(CDI_SGS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error(`Banco Central respondeu ${response.status} ao consultar o CDI.`);

    const rows = await response.json();
    const latest = Array.isArray(rows) ? rows.at(-1) : null;
    const value = Number(String(latest?.valor ?? '').replace(',', '.'));
    const match = String(latest?.data ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!Number.isFinite(value) || value <= 0 || !match) throw new Error('Resposta inválida da série CDI 4389.');

    const [, day, month, year] = match;
    const referenceDate = `${year}-${month}-${day}`;
    if (!isValidIsoDate(referenceDate)) throw new Error('Data inválida na série CDI 4389.');

    setSetting('annual_cdi_rate', value.toFixed(2));
    setSetting('annual_cdi_rate_date', referenceDate);
  })();

  try {
    await cdiRefreshPromise;
  } catch {
    // Keep the last stored reference if the user is offline or the BCB API is unavailable.
  } finally {
    cdiRefreshPromise = null;
  }
}

// Initial tables
db.exec(`
  CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    institution TEXT DEFAULT '',
    category TEXT DEFAULT 'Renda Fixa',
    notes TEXT DEFAULT '',
    target_cdi_pct REAL DEFAULT 100,
    tax_exempt INTEGER DEFAULT 0,
    maturity_date TEXT DEFAULT '',
    liquidity TEXT DEFAULT 'Diária',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    gross_value REAL NOT NULL,
    net_value REAL NOT NULL,
    contribution REAL DEFAULT 0,
    withdrawal REAL DEFAULT 0,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(investment_id, date),
    FOREIGN KEY(investment_id) REFERENCES investments(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount >= 0),
    balance_includes INTEGER NOT NULL DEFAULT 1,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    investment_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('interest', 'dividend')),
    event_date TEXT NOT NULL,
    title TEXT DEFAULT '',
    estimated_amount REAL,
    status TEXT NOT NULL DEFAULT 'expected' CHECK(status IN ('expected', 'received', 'cancelled')),
    received_date TEXT,
    received_amount REAL,
    received_movement_id INTEGER,
    notes TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS deleted_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    label TEXT NOT NULL,
    payload TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    label TEXT NOT NULL,
    details TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ipca_monthly (
    reference_month TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    source TEXT NOT NULL DEFAULT 'Banco Central do Brasil · SGS 433',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_records_investment_date ON records(investment_id, date);
  CREATE INDEX IF NOT EXISTS idx_records_date ON records(date);
  CREATE INDEX IF NOT EXISTS idx_movements_investment_date ON movements(investment_id, date);
  CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(event_date, status);
  CREATE INDEX IF NOT EXISTS idx_deleted_at ON deleted_items(deleted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at DESC);
`);

// Safe migrations for newly added columns if table already existed
try {
  db.exec(`ALTER TABLE investments ADD COLUMN target_cdi_pct REAL DEFAULT 100;`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE investments ADD COLUMN maturity_date TEXT DEFAULT '';`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE investments ADD COLUMN liquidity TEXT DEFAULT 'Diária';`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE investments ADD COLUMN tax_exempt INTEGER DEFAULT 0;`);
} catch (e) {}

// Default settings
const getSetting = (key, defaultVal) => {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key);
  return row ? row.value : defaultVal;
};

const setSetting = (key, value) => {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
};

const logActivity = (entityType, entityId, action, label, details = '') => {
  db.prepare(`INSERT INTO activity_log (entity_type, entity_id, action, label, details) VALUES (?, ?, ?, ?, ?)`)
    .run(entityType, entityId || null, action, label, details);
};

const addDeletedItem = (entityType, entityId, label, payload) => {
  const result = db.prepare(`INSERT INTO deleted_items (entity_type, entity_id, label, payload) VALUES (?, ?, ?, ?)`)
    .run(entityType, entityId, label, JSON.stringify(payload));
  return Number(result.lastInsertRowid);
};

const MOVEMENT_TYPES = new Set(['application', 'contribution', 'withdrawal', 'interest', 'dividend', 'fee', 'tax']);
const isValidIsoDate = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

if (!getSetting('patrimony_goal', null)) {
  setSetting('patrimony_goal', '100000');
}
if (!getSetting('annual_cdi_rate', null)) {
  setSetting('annual_cdi_rate', DEFAULT_ANNUAL_CDI_RATE);
}
if (!getSetting('annual_cdi_rate_date', null)) {
  setSetting('annual_cdi_rate_date', DEFAULT_CDI_RATE_DATE);
}
if (!getSetting('usd_amount', null)) {
  setSetting('usd_amount', '0');
}
if (!getSetting('include_usd_in_patrimony', null)) {
  setSetting('include_usd_in_patrimony', 'false');
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
      if (body.length > 5 * 1024 * 1024) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(JSON.stringify(data));
}

// Calculate business days between two dates
function countBusinessDays(startDateStr, endDateStr) {
  const d1 = new Date(startDateStr);
  const d2 = new Date(endDateStr);
  if (isNaN(d1) || isNaN(d2) || d1 >= d2) return 0;

  let count = 0;
  const cur = new Date(d1);
  cur.setDate(cur.getDate() + 1);

  while (cur <= d2) {
    const dayOfWeek = cur.getDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      count++;
    }
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

// Calculate Analytics
function calculateAnalytics(investmentId = null) {
  const annualCDI = parseFloat(getSetting('annual_cdi_rate', String(DEFAULT_ANNUAL_CDI_RATE))) || DEFAULT_ANNUAL_CDI_RATE;
  const patrimonyGoal = parseFloat(getSetting('patrimony_goal', '100000')) || 100000;
  
  // Daily CDI rate: (1 + CDI)^(1/252) - 1
  const dailyCDIFactor = Math.pow(1 + (annualCDI / 100), 1 / 252) - 1;

  let query = `
    SELECT 
      r.id,
      r.investment_id,
      i.name as investment_name,
      i.institution,
      i.category,
      i.target_cdi_pct,
      i.tax_exempt,
      i.maturity_date,
      i.liquidity,
      r.date,
      r.gross_value,
      r.net_value,
      r.contribution,
      r.withdrawal,
      r.notes
    FROM records r
    JOIN investments i ON r.investment_id = i.id
  `;
  
  const params = [];
  if (investmentId) {
    query += ` WHERE r.investment_id = ?`;
    params.push(investmentId);
  }
  query += ` ORDER BY r.investment_id ASC, r.date ASC`;

  const rows = db.prepare(query).all(...params);
  const movementRows = db.prepare(`SELECT investment_id, date, type, amount, balance_includes FROM movements ORDER BY investment_id, date`).all();
  const movementsByInvestment = new Map();
  for (const movement of movementRows) {
    if (!movementsByInvestment.has(Number(movement.investment_id))) movementsByInvestment.set(Number(movement.investment_id), []);
    movementsByInvestment.get(Number(movement.investment_id)).push(movement);
  }

  const investmentsMap = {};
  const enrichedRecords = [];

  for (const row of rows) {
    if (!investmentsMap[row.investment_id]) {
      investmentsMap[row.investment_id] = {
        id: row.investment_id,
        name: row.investment_name,
        institution: row.institution,
        category: row.category,
        target_cdi_pct: row.target_cdi_pct || 100,
        tax_exempt: Boolean(row.tax_exempt),
        maturity_date: row.maturity_date || '',
        liquidity: row.liquidity || 'Diária',
        records: [],
        first_date: row.date,
        last_date: row.date,
        first_gross: row.gross_value,
        first_net: row.net_value,
        last_gross: row.gross_value,
        last_net: row.net_value,
        total_contributions: 0,
        total_withdrawals: 0,
        accumulated_gross_yield: 0,
        accumulated_net_yield: 0
      };
    }

    const inv = investmentsMap[row.investment_id];
    const prev = inv.records.length > 0 ? inv.records[inv.records.length - 1] : null;

    const intervalMovements = (movementsByInvestment.get(Number(row.investment_id)) || [])
      .filter(movement => (!prev || movement.date > prev.date) && movement.date <= row.date);
    const externalContribution = intervalMovements
      .filter(movement => ['application', 'contribution'].includes(movement.type))
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const externalWithdrawal = intervalMovements
      .filter(movement => movement.type === 'withdrawal')
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const paidIncome = intervalMovements
      .filter(movement => ['interest', 'dividend'].includes(movement.type) && !movement.balance_includes)
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const paidFees = intervalMovements
      .filter(movement => movement.type === 'fee' && !movement.balance_includes)
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const paidTaxes = intervalMovements
      .filter(movement => movement.type === 'tax' && !movement.balance_includes)
      .reduce((sum, movement) => sum + Number(movement.amount || 0), 0);
    const contribution = (Number(row.contribution) || 0) + externalContribution;
    const withdrawal = (Number(row.withdrawal) || 0) + externalWithdrawal;

    inv.total_contributions += contribution;
    inv.total_withdrawals += withdrawal;
    let dailyGrossYield = 0;
    let dailyNetYield = 0;
    let dailyGrossPct = 0;
    let dailyNetPct = 0;
    let daysDiff = 0;

    if (prev) {
      // RENDIMENTO REAL: Deduz o aporte para não contar depósito como lucro!
      dailyGrossYield = row.gross_value - prev.gross_value - contribution + withdrawal + paidIncome - paidFees;
      dailyNetYield = row.net_value - prev.net_value - contribution + withdrawal + paidIncome - paidFees - paidTaxes;

      const baseGross = prev.gross_value + contribution;
      const baseNet = prev.net_value + contribution;

      if (baseGross > 0) dailyGrossPct = (dailyGrossYield / baseGross) * 100;
      if (baseNet > 0) dailyNetPct = (dailyNetYield / baseNet) * 100;

      const d1 = new Date(prev.date);
      const d2 = new Date(row.date);
      daysDiff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
    }

    inv.accumulated_gross_yield += dailyGrossYield;
    inv.accumulated_net_yield += dailyNetYield;
    inv.last_date = row.date;
    inv.last_gross = row.gross_value;
    inv.last_net = row.net_value;

    const taxAmount = Math.max(0, row.gross_value - row.net_value) + paidTaxes;

    const enriched = {
      ...row,
      contribution,
      withdrawal,
      cash_income: Math.round(paidIncome * 100) / 100,
      cash_fees: Math.round(paidFees * 100) / 100,
      cash_taxes: Math.round(paidTaxes * 100) / 100,
      daily_gross_yield: Math.round(dailyGrossYield * 100) / 100,
      daily_net_yield: Math.round(dailyNetYield * 100) / 100,
      daily_gross_pct: Math.round(dailyGrossPct * 10000) / 10000,
      daily_net_pct: Math.round(dailyNetPct * 10000) / 10000,
      tax_amount: Math.round(taxAmount * 100) / 100,
      days_diff: daysDiff,
      has_prev: !!prev
    };

    inv.records.push(enriched);
    enrichedRecords.push(enriched);
  }

  // Calculate CDI delivered for each investment
  const today = new Date().toISOString().slice(0, 10);
  const maturityAlerts = [];

  for (const inv of Object.values(investmentsMap)) {
    if (inv.records.length > 1) {
      const bDays = countBusinessDays(inv.first_date, inv.last_date);
      const benchmarkCDIPct = (Math.pow(1 + dailyCDIFactor, bDays) - 1) * 100;

      // Real accumulated return percentage
      const totalInvestedBase = inv.first_gross + inv.total_contributions;
      const assetReturnPct = totalInvestedBase > 0 ? (inv.accumulated_gross_yield / totalInvestedBase) * 100 : 0;

      // % of CDI delivered = (Asset Return / Benchmark CDI) * 100
      inv.delivered_cdi_pct = benchmarkCDIPct > 0 ? Math.round((assetReturnPct / benchmarkCDIPct) * 10000) / 100 : 100;
      inv.benchmark_cdi_pct = Math.round(benchmarkCDIPct * 100) / 100;
      inv.asset_return_pct = Math.round(assetReturnPct * 100) / 100;
    } else {
      inv.delivered_cdi_pct = inv.target_cdi_pct || 100;
      inv.benchmark_cdi_pct = 0;
      inv.asset_return_pct = 0;
    }

    // Check Maturity
    if (inv.maturity_date) {
      const mDate = new Date(inv.maturity_date);
      const now = new Date(today);
      const diffDays = Math.round((mDate - now) / (1000 * 60 * 60 * 24));
      inv.days_to_maturity = diffDays;

      if (diffDays >= 0 && diffDays <= 30) {
        maturityAlerts.push({
          investment_id: inv.id,
          name: inv.name,
          institution: inv.institution,
          maturity_date: inv.maturity_date,
          days_left: diffDays,
          last_net: inv.last_net
        });
      } else if (diffDays < 0) {
        inv.is_expired = true;
      }
    }
  }

  // Group portfolio by date for timelines
  const dateMap = {};
  for (const rec of enrichedRecords) {
    if (!dateMap[rec.date]) {
      dateMap[rec.date] = {
        date: rec.date,
        total_gross: 0,
        total_net: 0,
        total_contribution: 0,
        total_withdrawal: 0,
        daily_gross_yield: 0,
        daily_net_yield: 0,
        total_tax: 0,
        items_count: 0
      };
    }
    const d = dateMap[rec.date];
    d.total_gross += rec.gross_value;
    d.total_net += rec.net_value;
    d.total_contribution += (rec.contribution || 0);
    d.total_withdrawal += (rec.withdrawal || 0);
    d.daily_gross_yield += rec.daily_gross_yield;
    d.daily_net_yield += rec.daily_net_yield;
    d.total_tax += rec.tax_amount;
    d.items_count += 1;
  }

  const timeline = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));

  // Current date benchmarks
  const now = new Date();
  const currentYearStr = String(now.getFullYear());
  const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);

  let accumulatedGrossYield = 0;
  let accumulatedNetYield = 0;
  let currentMonthGrossYield = 0;
  let currentMonthNetYield = 0;
  let currentYearGrossYield = 0;
  let currentYearNetYield = 0;
  let last12MonthsGrossYield = 0;
  let last12MonthsNetYield = 0;

  for (const t of timeline) {
    accumulatedGrossYield += t.daily_gross_yield;
    accumulatedNetYield += t.daily_net_yield;

    if (t.date.startsWith(currentMonthStr)) {
      currentMonthGrossYield += t.daily_gross_yield;
      currentMonthNetYield += t.daily_net_yield;
    }
    if (t.date.startsWith(currentYearStr)) {
      currentYearGrossYield += t.daily_gross_yield;
      currentYearNetYield += t.daily_net_yield;
    }
    if (t.date >= oneYearAgoStr) {
      last12MonthsGrossYield += t.daily_gross_yield;
      last12MonthsNetYield += t.daily_net_yield;
    }
  }

  const latestDateEntry = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const totalGrossCurrent = latestDateEntry ? latestDateEntry.total_gross : 0;
  const totalNetCurrent = latestDateEntry ? latestDateEntry.total_net : 0;
  const totalTaxCurrent = latestDateEntry ? latestDateEntry.total_tax : 0;

  // Net invested capital (Aportes - Resgates)
  const netInvestedCapital = Math.max(0, totalNetCurrent - accumulatedNetYield);

  // Asset & Category Allocation (for Pie / Donut charts)
  const categoryAllocation = {};
  const assetAllocation = [];

  for (const inv of Object.values(investmentsMap)) {
    if (inv.last_net > 0) {
      const cat = inv.category || 'Outros';
      categoryAllocation[cat] = (categoryAllocation[cat] || 0) + inv.last_net;

      assetAllocation.push({
        id: inv.id,
        name: inv.name,
        institution: inv.institution,
        category: inv.category,
        net_value: Math.round(inv.last_net * 100) / 100,
        pct_of_total: totalNetCurrent > 0 ? Math.round((inv.last_net / totalNetCurrent) * 10000) / 100 : 0,
        delivered_cdi_pct: inv.delivered_cdi_pct,
        target_cdi_pct: inv.target_cdi_pct,
        maturity_date: inv.maturity_date,
        liquidity: inv.liquidity,
        days_to_maturity: inv.days_to_maturity
      });
    }
  }

  const categorySlices = Object.entries(categoryAllocation).map(([name, value]) => ({
    name,
    value: Math.round(value * 100) / 100,
    pct_of_total: totalNetCurrent > 0 ? Math.round((value / totalNetCurrent) * 10000) / 100 : 0
  })).sort((a, b) => b.value - a.value);

  assetAllocation.sort((a, b) => b.net_value - a.net_value);

  // Goal Progress
  const goalProgressPct = patrimonyGoal > 0 ? Math.min(100, Math.round((totalNetCurrent / patrimonyGoal) * 10000) / 100) : 0;
  const goalRemaining = Math.max(0, patrimonyGoal - totalNetCurrent);

  return {
    summary: {
      total_gross: Math.round(totalGrossCurrent * 100) / 100,
      total_net: Math.round(totalNetCurrent * 100) / 100,
      total_tax: Math.round(totalTaxCurrent * 100) / 100,
      net_invested_capital: Math.round(netInvestedCapital * 100) / 100,

      // Rendimentos do Dia
      latest_daily_gross_yield: latestDateEntry ? Math.round(latestDateEntry.daily_gross_yield * 100) / 100 : 0,
      latest_daily_net_yield: latestDateEntry ? Math.round(latestDateEntry.daily_net_yield * 100) / 100 : 0,
      latest_daily_gross_pct: latestDateEntry && (latestDateEntry.total_gross - latestDateEntry.daily_gross_yield) > 0 
        ? Math.round((latestDateEntry.daily_gross_yield / (latestDateEntry.total_gross - latestDateEntry.daily_gross_yield)) * 10000) / 100 : 0,
      latest_daily_net_pct: latestDateEntry && (latestDateEntry.total_net - latestDateEntry.daily_net_yield) > 0 
        ? Math.round((latestDateEntry.daily_net_yield / (latestDateEntry.total_net - latestDateEntry.daily_net_yield)) * 10000) / 100 : 0,

      // Rendimento no Mês
      current_month_gross_yield: Math.round(currentMonthGrossYield * 100) / 100,
      current_month_net_yield: Math.round(currentMonthNetYield * 100) / 100,

      // Rendimento no Ano (Ano Atual)
      current_year_gross_yield: Math.round(currentYearGrossYield * 100) / 100,
      current_year_net_yield: Math.round(currentYearNetYield * 100) / 100,

      // Rendimento em 12 Meses
      last_12_months_gross_yield: Math.round(last12MonthsGrossYield * 100) / 100,
      last_12_months_net_yield: Math.round(last12MonthsNetYield * 100) / 100,

      // Acumulado Total
      accumulated_gross_yield: Math.round(accumulatedGrossYield * 100) / 100,
      accumulated_net_yield: Math.round(accumulatedNetYield * 100) / 100,

      // Meta de Patrimônio
      patrimony_goal: patrimonyGoal,
      goal_progress_pct: goalProgressPct,
      goal_remaining: Math.round(goalRemaining * 100) / 100,

      // Benchmark CDI
      annual_cdi_rate: annualCDI,
      annual_cdi_rate_date: getSetting('annual_cdi_rate_date', DEFAULT_CDI_RATE_DATE),

      // Dólar
      usd_amount: parseFloat(getSetting('usd_amount', '0')) || 0,
      include_usd_in_patrimony: getSetting('include_usd_in_patrimony', 'false') === 'true',

      latest_date: latestDateEntry ? latestDateEntry.date : null,
      total_investments: Object.keys(investmentsMap).length,
      total_records: rows.length
    },
    allocations: {
      categories: categorySlices,
      assets: assetAllocation
    },
    maturity_alerts: maturityAlerts,
    timeline,
    investments: Object.values(investmentsMap),
    recent_records: enrichedRecords.slice().reverse().slice(0, 50)
  };
}

// Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // API: Settings
    if (pathname === '/api/settings') {
      if (method === 'GET') {
        const rows = db.prepare(`SELECT key, value FROM settings`).all();
        const settings = {};
        rows.forEach(r => settings[r.key] = r.value);
        return sendJson(res, 200, settings);
      }

      if (method === 'POST') {
        const data = await parseJsonBody(req);
        if (data.patrimony_goal !== undefined) { setSetting('patrimony_goal', data.patrimony_goal); logActivity('settings', null, 'updated', 'Meta de patrimônio'); }
        if (data.usd_amount !== undefined) { setSetting('usd_amount', data.usd_amount); logActivity('settings', null, 'updated', 'Reserva em dólar'); }
        if (data.include_usd_in_patrimony !== undefined) { setSetting('include_usd_in_patrimony', String(data.include_usd_in_patrimony)); logActivity('settings', null, 'updated', 'Inclusão da reserva em dólar'); }
        if (data.user_name !== undefined) { setSetting('user_name', String(data.user_name).trim().slice(0, 40)); logActivity('profile', null, 'updated', 'Saudação personalizada'); }
        return sendJson(res, 200, { success: true });
      }
    }

    // API: Investments
    if (pathname === '/api/investments') {
      if (method === 'GET') {
        const stmt = db.prepare(`
          SELECT 
            i.*,
            (SELECT COUNT(*) FROM records WHERE investment_id = i.id) as records_count,
            (SELECT date FROM records WHERE investment_id = i.id ORDER BY date DESC LIMIT 1) as last_date,
            (SELECT gross_value FROM records WHERE investment_id = i.id ORDER BY date DESC LIMIT 1) as last_gross,
            (SELECT net_value FROM records WHERE investment_id = i.id ORDER BY date DESC LIMIT 1) as last_net
          FROM investments i
          ORDER BY i.name ASC
        `);
        const rows = stmt.all();
        return sendJson(res, 200, rows);
      }

      if (method === 'POST') {
        const data = await parseJsonBody(req);
        if (!data.name || !data.name.trim()) {
          return sendJson(res, 400, { error: 'O nome do ativo é obrigatório.' });
        }

        const targetCdi = parseFloat(data.target_cdi_pct) || 100;
        const taxExempt = data.tax_exempt ? 1 : 0;
        const maturityDate = data.maturity_date || '';
        const liquidity = data.liquidity || 'Diária';

        if (data.id) {
          const stmt = db.prepare(`
            UPDATE investments 
            SET name = ?, institution = ?, category = ?, notes = ?, target_cdi_pct = ?, maturity_date = ?, liquidity = ?, tax_exempt = ?
            WHERE id = ?
          `);
          stmt.run(data.name.trim(), data.institution || '', data.category || 'Renda Fixa', data.notes || '', targetCdi, maturityDate, liquidity, taxExempt, data.id);
          logActivity('investment', data.id, 'updated', data.name.trim());
          return sendJson(res, 200, { success: true, id: data.id });
        } else {
          const stmt = db.prepare(`
            INSERT INTO investments (name, institution, category, notes, target_cdi_pct, maturity_date, liquidity, tax_exempt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const result = stmt.run(data.name.trim(), data.institution || '', data.category || 'Renda Fixa', data.notes || '', targetCdi, maturityDate, liquidity, taxExempt);
          logActivity('investment', Number(result.lastInsertRowid), 'created', data.name.trim());
          return sendJson(res, 201, { success: true, id: result.lastInsertRowid });
        }
      }
    }

    if (pathname.startsWith('/api/investments/') && method === 'DELETE') {
      const id = parseInt(pathname.split('/')[3], 10);
      if (!id) return sendJson(res, 400, { error: 'ID inválido.' });
      const investment = db.prepare(`SELECT * FROM investments WHERE id = ?`).get(id);
      if (!investment) return sendJson(res, 404, { error: 'Ativo não encontrado.' });
      const payload = {
        investment,
        records: db.prepare(`SELECT * FROM records WHERE investment_id = ? ORDER BY date`).all(id),
        movements: db.prepare(`SELECT * FROM movements WHERE investment_id = ? ORDER BY date`).all(id),
        calendar_events: db.prepare(`SELECT * FROM calendar_events WHERE investment_id = ? ORDER BY event_date`).all(id)
      };
      db.exec('BEGIN IMMEDIATE');
      try {
        const deletedId = addDeletedItem('investment', id, investment.name, payload);
        db.prepare(`DELETE FROM calendar_events WHERE investment_id = ?`).run(id);
        db.prepare(`DELETE FROM movements WHERE investment_id = ?`).run(id);
        db.prepare(`DELETE FROM records WHERE investment_id = ?`).run(id);
        db.prepare(`DELETE FROM investments WHERE id = ?`).run(id);
        logActivity('investment', id, 'deleted', investment.name);
        db.exec('COMMIT');
        return sendJson(res, 200, { success: true, deleted_id: deletedId });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }

    // API: Records
    if (pathname === '/api/records') {
      if (method === 'GET') {
        const investmentId = parsedUrl.searchParams.get('investment_id');
        let query = `
          SELECT r.*, i.name as investment_name, i.institution, i.category
          FROM records r
          JOIN investments i ON r.investment_id = i.id
        `;
        const params = [];
        if (investmentId) {
          query += ` WHERE r.investment_id = ?`;
          params.push(investmentId);
        }
        query += ` ORDER BY r.date DESC, i.name ASC`;
        const rows = db.prepare(query).all(...params);
        return sendJson(res, 200, rows);
      }

      if (method === 'POST') {
        const data = await parseJsonBody(req);
        const { investment_id, date, gross_value, net_value, contribution = 0, withdrawal = 0, notes = '' } = data;
        const investment = db.prepare(`SELECT tax_exempt FROM investments WHERE id = ?`).get(investment_id);
        const effectiveGross = investment?.tax_exempt ? net_value : gross_value;

        if (!investment_id || !date || effectiveGross === undefined || net_value === undefined) {
          return sendJson(res, 400, { error: 'Preencha investimento, data, valor bruto e líquido.' });
        }

        const investmentName = db.prepare(`SELECT name FROM investments WHERE id = ?`).get(investment_id)?.name || 'Ativo';
        const existingRecord = db.prepare(`SELECT id FROM records WHERE investment_id = ? AND date = ?`).get(investment_id, date);
        const stmt = db.prepare(`
          INSERT INTO records (investment_id, date, gross_value, net_value, contribution, withdrawal, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(investment_id, date) DO UPDATE SET
            gross_value = excluded.gross_value,
            net_value = excluded.net_value,
            contribution = excluded.contribution,
            withdrawal = excluded.withdrawal,
            notes = excluded.notes
        `);
        stmt.run(investment_id, date, parseFloat(effectiveGross), parseFloat(net_value), parseFloat(contribution) || 0, parseFloat(withdrawal) || 0, notes);
        logActivity('record', existingRecord?.id || null, existingRecord ? 'updated' : 'created', `${investmentName} · ${date}`);
        return sendJson(res, 200, { success: true });
      }
    }

    // API: Batch records
    if (pathname === '/api/records/batch' && method === 'POST') {
      const data = await parseJsonBody(req);
      const { date, entries } = data;

      if (!date || !Array.isArray(entries) || entries.length === 0) {
        return sendJson(res, 400, { error: 'Data e lista de lançamentos são obrigatórios.' });
      }

      const stmt = db.prepare(`
        INSERT INTO records (investment_id, date, gross_value, net_value, contribution, withdrawal, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(investment_id, date) DO UPDATE SET
          gross_value = excluded.gross_value,
          net_value = excluded.net_value,
          contribution = excluded.contribution,
          withdrawal = excluded.withdrawal,
          notes = excluded.notes
      `);

      let count = 0;
      for (const entry of entries) {
        const investment = db.prepare(`SELECT tax_exempt FROM investments WHERE id = ?`).get(entry.investment_id);
        const grossValue = investment?.tax_exempt ? entry.net_value : entry.gross_value;
        if (entry.investment_id && grossValue !== undefined && grossValue !== '' && entry.net_value !== undefined && entry.net_value !== '') {
          const existingRecord = db.prepare(`SELECT id FROM records WHERE investment_id = ? AND date = ?`).get(entry.investment_id, date);
          stmt.run(
            entry.investment_id,
            date,
            parseFloat(grossValue),
            parseFloat(entry.net_value),
            parseFloat(entry.contribution) || 0,
            parseFloat(entry.withdrawal) || 0,
            entry.notes || ''
          );
          const investmentName = db.prepare(`SELECT name FROM investments WHERE id = ?`).get(entry.investment_id)?.name || 'Ativo';
          logActivity('record', existingRecord?.id || null, existingRecord ? 'updated' : 'created', `${investmentName} · ${date}`);
          count++;
        }
      }

      return sendJson(res, 200, { success: true, count });
    }

    if (pathname.startsWith('/api/records/') && method === 'DELETE') {
      const id = parseInt(pathname.split('/')[3], 10);
      if (!id) return sendJson(res, 400, { error: 'ID inválido.' });
      const record = db.prepare(`SELECT r.*, i.name AS investment_name FROM records r JOIN investments i ON i.id = r.investment_id WHERE r.id = ?`).get(id);
      if (!record) return sendJson(res, 404, { error: 'Record not found.' });
      const { investment_name, ...recordData } = record;
      const deletedId = addDeletedItem('record', id, `${investment_name} · ${record.date}`, { record: recordData });
      db.prepare(`DELETE FROM records WHERE id = ?`).run(id);
      logActivity('record', id, 'deleted', `${investment_name} · ${record.date}`);
      return sendJson(res, 200, { success: true, deleted_id: deletedId });
    }

    // API: Cash movements
    if (pathname === '/api/movements') {
      if (method === 'GET') {
        const investmentId = parsedUrl.searchParams.get('investment_id');
        const rows = investmentId
          ? db.prepare(`SELECT m.*, i.name AS investment_name, i.institution FROM movements m JOIN investments i ON i.id = m.investment_id WHERE m.investment_id = ? ORDER BY m.date DESC, m.id DESC LIMIT 500`).all(investmentId)
          : db.prepare(`SELECT m.*, i.name AS investment_name, i.institution FROM movements m JOIN investments i ON i.id = m.investment_id ORDER BY m.date DESC, m.id DESC LIMIT 500`).all();
        return sendJson(res, 200, rows);
      }

      if (method === 'POST') {
        const data = await parseJsonBody(req);
        const investmentId = Number(data.investment_id);
        const amount = Number(data.amount);
        if (!investmentId || !db.prepare(`SELECT id FROM investments WHERE id = ?`).get(investmentId)) return sendJson(res, 400, { error: 'Selecione um ativo existente.' });
        if (!isValidIsoDate(data.date)) return sendJson(res, 400, { error: 'Informe uma data válida.' });
        if (!MOVEMENT_TYPES.has(data.type)) return sendJson(res, 400, { error: 'Tipo de movimentação inválido.' });
        if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { error: 'O valor precisa ser maior que zero.' });

        const result = db.prepare(`INSERT INTO movements (investment_id, date, type, amount, balance_includes, notes) VALUES (?, ?, ?, ?, ?, ?)`)
          .run(investmentId, data.date, data.type, amount, data.balance_includes === false ? 0 : 1, String(data.notes || '').trim().slice(0, 500));
        const id = Number(result.lastInsertRowid);
        const name = db.prepare(`SELECT name FROM investments WHERE id = ?`).get(investmentId)?.name || 'Ativo';
        logActivity('movement', id, 'created', `${name} · ${data.date}`, data.type);
        return sendJson(res, 201, { success: true, id });
      }
    }

    if (pathname.startsWith('/api/movements/') && method === 'DELETE') {
      const id = Number(pathname.split('/')[3]);
      if (!id) return sendJson(res, 400, { error: 'ID inválido.' });
      const movement = db.prepare(`SELECT m.*, i.name AS investment_name FROM movements m JOIN investments i ON i.id = m.investment_id WHERE m.id = ?`).get(id);
      if (!movement) return sendJson(res, 404, { error: 'Movimentação não encontrada.' });
      const { investment_name, ...movementData } = movement;
      const deletedId = addDeletedItem('movement', id, `${investment_name} · ${movement.date}`, { movement: movementData });
      db.prepare(`DELETE FROM movements WHERE id = ?`).run(id);
      logActivity('movement', id, 'deleted', `${investment_name} · ${movement.date}`);
      return sendJson(res, 200, { success: true, deleted_id: deletedId });
    }

    // API: Income and maturity calendar
    if (pathname === '/api/calendar' && method === 'GET') {
      const today = new Date().toISOString().slice(0, 10);
      const events = db.prepare(`
        SELECT e.*, i.name AS investment_name, i.institution
        FROM calendar_events e JOIN investments i ON i.id = e.investment_id
        WHERE e.status != 'cancelled' AND e.event_date >= date(?, '-90 days')
        ORDER BY e.event_date ASC, e.id ASC LIMIT 250
      `).all(today);
      const maturities = db.prepare(`
        SELECT id AS investment_id, name AS investment_name, institution, maturity_date AS event_date,
          (SELECT net_value FROM records WHERE investment_id = investments.id ORDER BY date DESC LIMIT 1) AS estimated_amount
        FROM investments
        WHERE maturity_date != '' AND maturity_date >= date(?, '-90 days') AND maturity_date <= date(?, '+18 months')
      `).all(today, today).map(event => ({
        ...event,
        id: null,
        type: 'maturity',
        title: 'Vencimento do ativo',
        status: event.event_date < today ? 'past' : 'expected',
        source: 'investment'
      }));
      return sendJson(res, 200, [...events.map(event => ({ ...event, source: 'scheduled' })), ...maturities]
        .sort((a, b) => a.event_date.localeCompare(b.event_date) || Number(a.id || 0) - Number(b.id || 0)));
    }

    if (pathname === '/api/calendar' && method === 'POST') {
      const data = await parseJsonBody(req);
      const investmentId = Number(data.investment_id);
      if (!investmentId || !db.prepare(`SELECT id FROM investments WHERE id = ?`).get(investmentId)) return sendJson(res, 400, { error: 'Selecione um ativo existente.' });
      if (!isValidIsoDate(data.event_date)) return sendJson(res, 400, { error: 'Informe uma data válida.' });
      if (!['interest', 'dividend'].includes(data.type)) return sendJson(res, 400, { error: 'Agende juros ou dividendos.' });
      const amount = data.estimated_amount === '' || data.estimated_amount === undefined ? null : Number(data.estimated_amount);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return sendJson(res, 400, { error: 'O valor estimado não pode ser negativo.' });
      const title = String(data.title || '').trim().slice(0, 100);
      const result = db.prepare(`INSERT INTO calendar_events (investment_id, type, event_date, title, estimated_amount, notes) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(investmentId, data.type, data.event_date, title, amount, String(data.notes || '').trim().slice(0, 500));
      const id = Number(result.lastInsertRowid);
      const name = db.prepare(`SELECT name FROM investments WHERE id = ?`).get(investmentId)?.name || 'Ativo';
      logActivity('calendar_event', id, 'scheduled', `${name} · ${data.event_date}`, data.type);
      return sendJson(res, 201, { success: true, id });
    }

    if (pathname.startsWith('/api/calendar/') && method === 'PATCH') {
      const id = Number(pathname.split('/')[3]);
      const data = await parseJsonBody(req);
      const event = db.prepare(`SELECT e.*, i.name AS investment_name FROM calendar_events e JOIN investments i ON i.id = e.investment_id WHERE e.id = ?`).get(id);
      if (!event) return sendJson(res, 404, { error: 'Evento não encontrado.' });
      if (!['received', 'cancelled'].includes(data.status)) return sendJson(res, 400, { error: 'Status do evento inválido.' });
      if (event.status !== 'expected') return sendJson(res, 409, { error: 'Este evento já foi atualizado.' });
      const receivedDate = data.status === 'received' ? (data.received_date || new Date().toISOString().slice(0, 10)) : null;
      if (receivedDate && !isValidIsoDate(receivedDate)) return sendJson(res, 400, { error: 'Informe uma data de recebimento válida.' });
      const amount = data.status === 'received' ? Number(data.amount ?? event.estimated_amount) : null;
      if (data.status === 'received' && (!Number.isFinite(amount) || amount <= 0)) return sendJson(res, 400, { error: 'Informe o valor efetivamente recebido.' });

      db.exec('BEGIN IMMEDIATE');
      try {
        let movementId = null;
        if (data.status === 'received') {
          const result = db.prepare(`INSERT INTO movements (investment_id, date, type, amount, balance_includes, notes) VALUES (?, ?, ?, ?, 0, ?)`)
            .run(event.investment_id, receivedDate, event.type, amount, `Recebido: ${event.title || event.type}`);
          movementId = Number(result.lastInsertRowid);
        }
        db.prepare(`UPDATE calendar_events SET status = ?, received_date = ?, received_amount = ?, received_movement_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(data.status, receivedDate, amount, movementId, id);
        logActivity('calendar_event', id, data.status, `${event.investment_name} · ${event.event_date}`, data.status === 'received' ? String(amount) : '');
        db.exec('COMMIT');
        return sendJson(res, 200, { success: true, movement_id: movementId });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }

    // API: Recoverable deletions and change history
    if (pathname === '/api/deleted' && method === 'GET') {
      const rows = db.prepare(`SELECT * FROM deleted_items ORDER BY deleted_at DESC LIMIT 200`).all();
      return sendJson(res, 200, rows.map(item => {
        let details = '';
        try {
          const payload = JSON.parse(item.payload);
          if (item.entity_type === 'movement' && payload.movement) {
            details = `${payload.movement.type} · ${payload.movement.amount}${payload.movement.notes ? ` · ${payload.movement.notes}` : ''}`;
          } else if (item.entity_type === 'record' && payload.record) {
            details = `${payload.record.date} · ${payload.record.net_value}`;
          } else if (item.entity_type === 'investment') {
            details = `${(payload.records || []).length} saldos · ${(payload.movements || []).length} movimentações`;
          }
        } catch {}
        return { id: item.id, entity_type: item.entity_type, entity_id: item.entity_id, label: item.label, details, deleted_at: item.deleted_at };
      }));
    }

    if (pathname === '/api/activity' && method === 'GET') {
      return sendJson(res, 200, db.prepare(`SELECT * FROM activity_log ORDER BY created_at DESC, id DESC LIMIT 200`).all());
    }

    if (pathname.startsWith('/api/deleted/') && method === 'DELETE') {
      const id = Number(pathname.split('/')[3]);
      if (!id) return sendJson(res, 400, { error: 'ID inválido.' });
      const item = db.prepare(`SELECT * FROM deleted_items WHERE id = ?`).get(id);
      if (!item) return sendJson(res, 404, { error: 'Item excluído não encontrado.' });
      db.prepare(`DELETE FROM deleted_items WHERE id = ?`).run(id);
      logActivity(item.entity_type, item.entity_id, 'purged', item.label);
      return sendJson(res, 200, { success: true });
    }

    if (pathname.startsWith('/api/deleted/') && method === 'POST') {
      const id = Number(pathname.split('/')[3]);
      if (!id) return sendJson(res, 400, { error: 'ID inválido.' });
      const item = db.prepare(`SELECT * FROM deleted_items WHERE id = ?`).get(id);
      if (!item) return sendJson(res, 404, { error: 'Item excluído não encontrado.' });
      let payload;
      try { payload = JSON.parse(item.payload); } catch { return sendJson(res, 500, { error: 'Não foi possível ler o item salvo.' }); }

      if (item.entity_type === 'record') {
        const record = payload.record;
        if (!record || !db.prepare(`SELECT id FROM investments WHERE id = ?`).get(record.investment_id)) return sendJson(res, 409, { error: 'O ativo original não está mais na carteira.' });
        if (db.prepare(`SELECT id FROM records WHERE investment_id = ? AND date = ?`).get(record.investment_id, record.date)) return sendJson(res, 409, { error: 'Já existe um saldo para este ativo nessa data.' });
      }
      if (item.entity_type === 'movement' && !db.prepare(`SELECT id FROM investments WHERE id = ?`).get(payload.movement?.investment_id)) return sendJson(res, 409, { error: 'O ativo original não está mais na carteira.' });

      db.exec('BEGIN IMMEDIATE');
      try {
        let restoredId = null;
        if (item.entity_type === 'investment') {
          const investment = payload.investment;
          const columns = ['name', 'institution', 'category', 'notes', 'target_cdi_pct', 'tax_exempt', 'maturity_date', 'liquidity'];
          const values = columns.map(column => investment[column] ?? null);
          const insert = db.prepare(`INSERT INTO investments (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
          restoredId = Number(insert.run(...values).lastInsertRowid);
          const insertRecord = db.prepare(`INSERT INTO records (investment_id, date, gross_value, net_value, contribution, withdrawal, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
          for (const record of payload.records || []) insertRecord.run(restoredId, record.date, record.gross_value, record.net_value, record.contribution || 0, record.withdrawal || 0, record.notes || '');
          const movementIdMap = new Map();
          const insertMovement = db.prepare(`INSERT INTO movements (investment_id, date, type, amount, balance_includes, notes) VALUES (?, ?, ?, ?, ?, ?)`);
          for (const movement of payload.movements || []) {
            const newMovementId = Number(insertMovement.run(restoredId, movement.date, movement.type, movement.amount, movement.balance_includes, movement.notes || '').lastInsertRowid);
            movementIdMap.set(Number(movement.id), newMovementId);
          }
          const insertEvent = db.prepare(`INSERT INTO calendar_events (investment_id, type, event_date, title, estimated_amount, status, received_date, received_amount, received_movement_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
          for (const event of payload.calendar_events || []) insertEvent.run(restoredId, event.type, event.event_date, event.title || '', event.estimated_amount, event.status, event.received_date, event.received_amount, movementIdMap.get(Number(event.received_movement_id)) || null, event.notes || '');
        } else if (item.entity_type === 'record') {
          const record = payload.record;
          restoredId = Number(db.prepare(`INSERT INTO records (investment_id, date, gross_value, net_value, contribution, withdrawal, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(record.investment_id, record.date, record.gross_value, record.net_value, record.contribution || 0, record.withdrawal || 0, record.notes || '').lastInsertRowid);
        } else if (item.entity_type === 'movement') {
          const movement = payload.movement;
          restoredId = Number(db.prepare(`INSERT INTO movements (investment_id, date, type, amount, balance_includes, notes) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(movement.investment_id, movement.date, movement.type, movement.amount, movement.balance_includes, movement.notes || '').lastInsertRowid);
          db.prepare(`UPDATE calendar_events SET received_movement_id = ? WHERE received_movement_id = ?`).run(restoredId, movement.id);
        } else {
          throw new Error('Tipo de item recuperado não suportado.');
        }

        db.prepare(`DELETE FROM deleted_items WHERE id = ?`).run(id);
        logActivity(item.entity_type, restoredId, 'restored', item.label);
        db.exec('COMMIT');
        return sendJson(res, 200, { success: true, id: restoredId });
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }

    // API: IPCA monthly series, stored locally after manual refresh
    if (pathname === '/api/inflation' && method === 'GET') {
      return sendJson(res, 200, db.prepare(`SELECT reference_month, rate, source, updated_at FROM ipca_monthly ORDER BY reference_month`).all());
    }

    if (pathname === '/api/inflation/sync' && method === 'POST') {
      const now = new Date();
      const start = new Date(Date.UTC(Math.max(1995, now.getUTCFullYear() - 20), 0, 1));
      const formatDate = date => `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
      const url = new URL('https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados');
      url.searchParams.set('formato', 'json');
      url.searchParams.set('dataInicial', formatDate(start));
      url.searchParams.set('dataFinal', formatDate(now));
      const response = await externalFetch(url.toString(), { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return sendJson(res, 502, { error: `Banco Central respondeu ${response.status}.` });
      const values = await response.json();
      if (!Array.isArray(values)) return sendJson(res, 502, { error: 'Resposta de IPCA inválida.' });
      const upsert = db.prepare(`INSERT INTO ipca_monthly (reference_month, rate, source, updated_at) VALUES (?, ?, 'Banco Central do Brasil · SGS 433', CURRENT_TIMESTAMP) ON CONFLICT(reference_month) DO UPDATE SET rate = excluded.rate, source = excluded.source, updated_at = excluded.updated_at`);
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of values) {
          const [, day, month, year] = String(item.data || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/) || [];
          const rate = Number(String(item.valor || '').replace(',', '.'));
          if (year && month && Number.isFinite(rate)) upsert.run(`${year}-${month}`, rate);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      const latest = db.prepare(`SELECT MAX(reference_month) AS latest FROM ipca_monthly`).get()?.latest || null;
      logActivity('inflation', null, 'synced', 'IPCA mensal', latest || '');
      return sendJson(res, 200, { success: true, count: values.length, latest_month: latest });
    }

    // API: Analytics
    if (pathname === '/api/analytics' && method === 'GET') {
      await refreshAnnualCdiRate();
      const invId = parsedUrl.searchParams.get('investment_id');
      const analytics = calculateAnalytics(invId ? parseInt(invId, 10) : null);
      return sendJson(res, 200, analytics);
    }

    // API: Export backup
    if (pathname === '/api/export' && method === 'GET') {
      const investments = db.prepare(`SELECT * FROM investments`).all();
      const records = db.prepare(`SELECT * FROM records ORDER BY date ASC`).all();
      const movements = db.prepare(`SELECT * FROM movements ORDER BY date ASC`).all();
      const calendar_events = db.prepare(`SELECT * FROM calendar_events ORDER BY event_date ASC`).all();
      const ipca_monthly = db.prepare(`SELECT * FROM ipca_monthly ORDER BY reference_month`).all();
      const deleted_items = db.prepare(`SELECT * FROM deleted_items ORDER BY deleted_at DESC`).all();
      const activity_log = db.prepare(`SELECT * FROM activity_log ORDER BY created_at DESC`).all();
      const settings = db.prepare(`SELECT * FROM settings`).all();
      const backup = {
        exported_at: new Date().toISOString(),
        version: '3.0',
        settings,
        investments,
        records,
        movements,
        calendar_events,
        ipca_monthly,
        deleted_items,
        activity_log
      };
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="informes_backup_${new Date().toISOString().slice(0, 10)}.json"`
      });
      return res.end(JSON.stringify(backup, null, 2));
    }

    // API: Import backup
    if (pathname === '/api/import' && method === 'POST') {
      const data = await parseJsonBody(req);
      if (!data.investments || !Array.isArray(data.investments)) {
        return sendJson(res, 400, { error: 'Formato de backup inválido.' });
      }

      const idMap = {};
      const movementIdMap = {};
      const insertInv = db.prepare(`
        INSERT INTO investments (name, institution, category, notes, target_cdi_pct, maturity_date, liquidity, tax_exempt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateInv = db.prepare(`UPDATE investments SET tax_exempt = ? WHERE id = ?`);

      for (const inv of data.investments) {
        const existing = db.prepare(`SELECT id FROM investments WHERE name = ?`).get(inv.name);
        if (existing) {
          idMap[inv.id] = existing.id;
          updateInv.run(inv.tax_exempt ? 1 : 0, existing.id);
        } else {
          const res = insertInv.run(
            inv.name,
            inv.institution || '',
            inv.category || 'Renda Fixa',
            inv.notes || '',
            inv.target_cdi_pct || 100,
            inv.maturity_date || '',
            inv.liquidity || 'Diária',
            inv.tax_exempt ? 1 : 0
          );
          idMap[inv.id] = res.lastInsertRowid;
        }
      }

      if (Array.isArray(data.records)) {
        const insertRec = db.prepare(`
          INSERT INTO records (investment_id, date, gross_value, net_value, contribution, withdrawal, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(investment_id, date) DO UPDATE SET
            gross_value = excluded.gross_value,
            net_value = excluded.net_value,
            contribution = excluded.contribution,
            withdrawal = excluded.withdrawal,
            notes = excluded.notes
        `);

        for (const rec of data.records) {
          const mappedId = idMap[rec.investment_id];
          if (mappedId) {
            const mappedInvestment = db.prepare(`SELECT tax_exempt FROM investments WHERE id = ?`).get(mappedId);
            const importedNet = Number(rec.net_value) || 0;
            insertRec.run(
              mappedId,
              rec.date,
              mappedInvestment?.tax_exempt ? importedNet : rec.gross_value,
              importedNet,
              rec.contribution || 0,
              rec.withdrawal || 0,
              rec.notes || ''
            );
          }
        }
      }

      if (Array.isArray(data.movements)) {
        const insertMovement = db.prepare(`INSERT INTO movements (investment_id, date, type, amount, balance_includes, notes) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const movement of data.movements) {
          const mappedId = idMap[movement.investment_id];
          if (!mappedId || !MOVEMENT_TYPES.has(movement.type)) continue;
          const existing = db.prepare(`SELECT id FROM movements WHERE investment_id = ? AND date = ? AND type = ? AND amount = ? AND balance_includes = ? AND notes = ?`)
            .get(mappedId, movement.date, movement.type, Number(movement.amount), movement.balance_includes ? 1 : 0, movement.notes || '');
          movementIdMap[movement.id] = existing?.id || Number(insertMovement.run(mappedId, movement.date, movement.type, Number(movement.amount), movement.balance_includes ? 1 : 0, movement.notes || '').lastInsertRowid);
        }
      }

      if (Array.isArray(data.calendar_events)) {
        const insertEvent = db.prepare(`INSERT INTO calendar_events (investment_id, type, event_date, title, estimated_amount, status, received_date, received_amount, received_movement_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const event of data.calendar_events) {
          const mappedId = idMap[event.investment_id];
          if (!mappedId || !['interest', 'dividend'].includes(event.type)) continue;
          const existing = db.prepare(`SELECT id FROM calendar_events WHERE investment_id = ? AND type = ? AND event_date = ? AND title = ?`)
            .get(mappedId, event.type, event.event_date, event.title || '');
          if (existing) continue;
          insertEvent.run(mappedId, event.type, event.event_date, event.title || '', event.estimated_amount ?? null, event.status || 'expected', event.received_date || null, event.received_amount ?? null, movementIdMap[event.received_movement_id] || null, event.notes || '');
        }
      }

      if (Array.isArray(data.ipca_monthly)) {
        const upsertInflation = db.prepare(`INSERT INTO ipca_monthly (reference_month, rate, source) VALUES (?, ?, ?) ON CONFLICT(reference_month) DO UPDATE SET rate = excluded.rate, source = excluded.source, updated_at = CURRENT_TIMESTAMP`);
        for (const item of data.ipca_monthly) {
          if (/^\d{4}-\d{2}$/.test(item.reference_month) && Number.isFinite(Number(item.rate))) upsertInflation.run(item.reference_month, Number(item.rate), item.source || 'Backup Lastro');
        }
      }

      if (Array.isArray(data.deleted_items)) {
        for (const item of data.deleted_items) {
          let payload;
          try { payload = JSON.parse(item.payload); } catch { continue; }
          if (item.entity_type === 'record' && payload.record) {
            payload.record.investment_id = idMap[payload.record.investment_id];
            if (!payload.record.investment_id) continue;
          }
          if (item.entity_type === 'movement' && payload.movement) {
            payload.movement.investment_id = idMap[payload.movement.investment_id];
            if (!payload.movement.investment_id) continue;
          }
          const duplicate = db.prepare(`SELECT id FROM deleted_items WHERE entity_type = ? AND label = ? AND deleted_at = ?`).get(item.entity_type, item.label, item.deleted_at);
          if (!duplicate) db.prepare(`INSERT INTO deleted_items (entity_type, entity_id, label, payload, deleted_at) VALUES (?, ?, ?, ?, ?)`)
            .run(item.entity_type, item.entity_id, item.label, JSON.stringify(payload), item.deleted_at);
        }
      }

      if (Array.isArray(data.activity_log)) {
        const insertActivity = db.prepare(`INSERT INTO activity_log (entity_type, entity_id, action, label, details, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
        for (const entry of data.activity_log.slice(0, 500)) insertActivity.run(entry.entity_type || 'app', entry.entity_id || null, entry.action || 'imported', entry.label || 'Backup', entry.details || '', entry.created_at || new Date().toISOString());
      }

      if (Array.isArray(data.settings)) {
        const allowedSettings = new Set([
          'patrimony_goal',
          'usd_amount',
          'include_usd_in_patrimony',
          'user_name'
        ]);
        for (const setting of data.settings) {
          if (setting?.key && allowedSettings.has(setting.key) && setting.value !== undefined) {
            setSetting(setting.key, setting.value);
          }
        }
      }

      return sendJson(res, 200, { success: true, message: 'Backup importado com sucesso!' });
    }

    // Static files
    let safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    if (safePath === '/' || safePath === '\\') safePath = '/index.html';

    const filePath = path.join(__dirname, 'public', safePath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 - Não Encontrado');
  } catch (error) {
    console.error('Erro na requisição:', error);
    sendJson(res, 500, { error: error.message || 'Erro interno no servidor' });
  }
});

export function startServer(port = PORT, host = '0.0.0.0', options = {}) {
  return new Promise((resolve, reject) => {
    if (typeof options.fetch === 'function') externalFetch = options.fetch;
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      const address = server.address();
      resolve({ server, url: `http://${host}:${address.port}` });
    });
  });
}

const isDirectExecution = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) startServer().then(() => {
  console.log(`\n======================================================`);
  console.log(`🚀 Informes de Rendimentos Online!`);
  console.log(`👉 Acesse no seu navegador: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
