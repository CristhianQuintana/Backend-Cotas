#!/usr/bin/env node
/**
 * Valida tickets compartidos entre dos bases API (multi-instancia + Redis).
 *
 * Uso:
 *   API_A=http://127.0.0.1:3100 API_B=http://127.0.0.1:3101 \
 *   XUI_USERNAME=... XUI_PASSWORD=... node scripts/validate-multi-instance-tickets.mjs
 */
const apiA = (process.env.API_A ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');
const apiB = (process.env.API_B ?? process.env.API_A ?? 'http://127.0.0.1:3100').replace(
  /\/$/u,
  '',
);
const username = process.env.XUI_USERNAME ?? '';
const password = process.env.XUI_PASSWORD ?? '';
const prefix = '/api/v1';

if (!username || !password) {
  console.error('Faltan XUI_USERNAME / XUI_PASSWORD');
  process.exit(2);
}

const report = { login: null, authorize: null, getOnA: null, getOnB: null, afterRevoke: null };

try {
  const login = await post(`${apiA}${prefix}/auth/login`, { username, password });
  expect(login.status === 200, `login ${login.status}`);
  report.login = login.status;
  const token = login.body.accessToken;
  const auth = { authorization: `Bearer ${token}` };

  const live = await get(`${apiA}${prefix}/catalog/live/streams?page=1&limit=1`, auth);
  expect(live.status === 200 && live.body?.items?.[0]?.id, 'sin canal live');
  const streamId = live.body.items[0].id;

  const authz = await post(
    `${apiA}${prefix}/playback/authorizations`,
    { contentType: 'live', streamId },
    auth,
  );
  expect(authz.status === 200 && typeof authz.body?.streamUrl === 'string', 'authorize falló');
  report.authorize = authz.status;
  const ticketUrl = authz.body.streamUrl;
  const ticketPath = ticketUrl.includes('/playback/media/')
    ? ticketUrl.slice(ticketUrl.indexOf('/playback/media/'))
    : null;
  expect(ticketPath, 'streamUrl sin ticket');

  const onA = await fetch(`${apiA}${prefix}${ticketPath}`, { redirect: 'manual' });
  report.getOnA = onA.status;
  expect(onA.status !== 404, `ticket 404 en API_A (${onA.status})`);

  const onB = await fetch(`${apiB}${prefix}${ticketPath}`, { redirect: 'manual' });
  report.getOnB = onB.status;
  expect(onB.status !== 404, `ticket 404 en API_B (${onB.status}) — Redis no compartido`);

  await post(`${apiA}${prefix}/auth/logout`, {}, auth);
  const after = await fetch(`${apiB}${prefix}${ticketPath}`, { redirect: 'manual' });
  report.afterRevoke = after.status;
  expect(after.status === 404, `logout no revocó ticket (status ${after.status})`);

  console.log(JSON.stringify({ ok: true, report }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, report, error: String(error?.message ?? error) }, null, 2));
  process.exit(1);
}

async function get(url, headers = {}) {
  const res = await fetch(url, { headers });
  return { status: res.status, body: await safeJson(res) };
}

async function post(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await safeJson(res) };
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function expect(cond, message) {
  if (!cond) {
    throw new Error(message);
  }
}
