#!/usr/bin/env node
/**
 * Carga progresiva del proxy HLS (authorize + GET media).
 * No inventa capacidad: imprime métricas medidas.
 *
 * Uso:
 *   SMOKE_BASE_URL=http://127.0.0.1:3100 XUI_USERNAME=... XUI_PASSWORD=... \
 *   VU_STEPS=5,10,15 HOLD_MS=20000 node scripts/load-playback-proxy.mjs
 */
const base = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');
const username = process.env.XUI_USERNAME ?? '';
const password = process.env.XUI_PASSWORD ?? '';
const steps = (process.env.VU_STEPS ?? '3,5,8,10')
  .split(',')
  .map((v) => Number(v.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const holdMs = Number(process.env.HOLD_MS ?? '15000');
const prefix = '/api/v1';

if (!username || !password) {
  console.error('Faltan XUI_USERNAME / XUI_PASSWORD');
  process.exit(2);
}

const login = await post(`${base}${prefix}/auth/login`, { username, password });
if (login.status !== 200) {
  console.error('login falló', login.status);
  process.exit(1);
}
const token = login.body.accessToken;
const auth = { authorization: `Bearer ${token}` };
const live = await get(`${base}${prefix}/catalog/live/streams?page=1&limit=${Math.max(...steps)}`, auth);
const ids = (live.body?.items ?? []).map((i) => i.id).filter(Boolean);
if (ids.length === 0) {
  console.error('sin streams live');
  process.exit(1);
}

const summary = [];
for (const vu of steps) {
  const streamIds = Array.from({ length: vu }, (_, i) => ids[i % ids.length]);
  const tickets = [];
  for (const streamId of streamIds) {
    const authz = await post(
      `${base}${prefix}/playback/authorizations`,
      { contentType: 'live', streamId },
      auth,
    );
    tickets.push({ status: authz.status, url: authz.body?.streamUrl });
  }
  const started = Date.now();
  const latencies = [];
  const statuses = [];
  const workers = tickets.map(async (ticket) => {
    if (!ticket.url || ticket.status !== 200) {
      statuses.push(ticket.status || 0);
      return;
    }
    const absolute = ticket.url.startsWith('http') ? ticket.url : `${base}${ticket.url}`;
    const endAt = Date.now() + holdMs;
    while (Date.now() < endAt) {
      const t0 = Date.now();
      try {
        const res = await fetch(absolute, { redirect: 'manual', signal: AbortSignal.timeout(20_000) });
        statuses.push(res.status);
        latencies.push(Date.now() - t0);
        // Consumir un poco del cuerpo sin bloquear demasiado.
        await res.arrayBuffer().catch(() => null);
      } catch {
        statuses.push(0);
        latencies.push(Date.now() - t0);
      }
      await sleep(500);
    }
  });
  await Promise.all(workers);
  const counted = statuses.length || 1;
  const s503 = statuses.filter((s) => s === 503).length;
  const s404 = statuses.filter((s) => s === 404).length;
  const s2xx = statuses.filter((s) => s >= 200 && s < 300).length;
  const sorted = [...latencies].sort((a, b) => a - b);
  const row = {
    vu,
    durationMs: Date.now() - started,
    requests: statuses.length,
    ok2xxPct: Number(((s2xx / counted) * 100).toFixed(2)),
    err503Pct: Number(((s503 / counted) * 100).toFixed(2)),
    err404Pct: Number(((s404 / counted) * 100).toFixed(2)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
  summary.push(row);
  console.log(JSON.stringify(row));
}

console.log(JSON.stringify({ ok: true, base, summary }, null, 2));

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}
async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}
