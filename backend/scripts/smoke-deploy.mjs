import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const base = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');
const username = process.env.XUI_USERNAME ?? '';
const password = process.env.XUI_PASSWORD ?? '';

if (username.length === 0 || password.length === 0) {
  console.error('Faltan XUI_USERNAME y XUI_PASSWORD en el entorno.');
  process.exit(1);
}

const report = {
  anonymous: null,
  rejectedLogin: null,
  liveCategories: null,
  live: null,
  vodCategories: null,
  vod: null,
  seriesCategories: null,
  series: null,
  epgItems: null,
  playback: [],
};

try {
  const anonymous = await api('/api/v1/catalog/live/categories');
  expect(anonymous.status === 401, `anonimo ${anonymous.status}`);
  report.anonymous = anonymous.status;

  const rejected = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'linea-inexistente', password: 'clave-incorrecta' }),
  });
  expect(rejected.status === 401, `login rechazado ${rejected.status}`);
  report.rejectedLogin = rejected.status;

  const login = await api('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  expect(login.status === 200 || login.status === 201, `login ${login.status}`);
  const token = login.body?.accessToken;
  expect(typeof token === 'string' && token.length > 20, 'la sesión no entregó access token');
  const auth = { authorization: `Bearer ${token}` };

  const liveCategories = await page('/api/v1/catalog/live/categories?page=1&limit=1', auth);
  const live = await page('/api/v1/catalog/live/streams?page=1&limit=5', auth);
  const vodCategories = await page('/api/v1/catalog/vod/categories?page=1&limit=1', auth);
  const vod = await page('/api/v1/catalog/vod/streams?page=1&limit=5', auth);
  const seriesCategories = await page('/api/v1/catalog/series/categories?page=1&limit=1', auth);
  const series = await page('/api/v1/catalog/series?page=1&limit=5', auth);
  report.liveCategories = liveCategories.total;
  report.live = live.total;
  report.vodCategories = vodCategories.total;
  report.vod = vod.total;
  report.seriesCategories = seriesCategories.total;
  report.series = series.total;

  const liveId = live.items?.[0]?.id;
  const vodId = vod.items?.[0]?.id;
  expect(typeof liveId === 'string' && typeof vodId === 'string', 'faltan canal o película');

  const vodDetail = await api(`/api/v1/catalog/vod/streams/${vodId}`, { headers: auth });
  expect(vodDetail.status === 200 && vodDetail.body?.id === vodId, 'la ficha de la película no coincide');

  const epg = await api(`/api/v1/catalog/live/streams/${liveId}/epg`, { headers: auth });
  expect(epg.status === 200, `epg ${epg.status}`);
  report.epgItems = Array.isArray(epg.body?.items) ? epg.body.items.length : null;

  const episode = await firstEpisode(series.items ?? [], auth);
  expect(episode, 'ninguna de las primeras series tiene un episodio');

  const missing = await api('/api/v1/playback/authorizations', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ contentType: 'live', streamId: '999999999999' }),
  });
  expect(missing.status === 404, `contenido inexistente ${missing.status}`);

  const wrongSeason = await api('/api/v1/playback/authorizations', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      contentType: 'series',
      streamId: episode.id,
      seriesId: episode.seriesId,
      seasonNumber: episode.seasonNumber === 999 ? 0 : 999,
    }),
  });
  expect(wrongSeason.status === 404, `episodio fuera de temporada ${wrongSeason.status}`);

  report.playback.push(await play(auth, { contentType: 'live', streamId: liveId }));
  report.playback.push(await play(auth, { contentType: 'vod', streamId: vodId }));
  report.playback.push(
    await play(auth, {
      contentType: 'series',
      streamId: episode.id,
      seriesId: episode.seriesId,
      seasonNumber: episode.seasonNumber,
    }),
  );

  emit(report);
} catch (error) {
  const message = error instanceof Error ? error.message : 'fallo de humo';
  console.error(redact(message));
  process.exit(1);
}

async function play(auth, body) {
  const result = await api('/api/v1/playback/authorizations', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify(body),
  });
  expect(result.status === 200 || result.status === 201, `autorizar ${body.contentType} ${result.status}`);
  const reference = result.body ?? {};
  expect(reference.delivery === 'direct', 'la entrega no es directa');
  expect(reference.accessMaterialEmbedded === true, 'falta la marca de material de acceso');
  expect(typeof reference.streamUrl === 'string', 'falta la referencia');
  const opened = await openReference(reference.streamUrl);
  const decoded = await decodeReference(reference.streamUrl);
  return {
    contentType: reference.contentType,
    streamId: reference.streamId,
    protocolHint: reference.protocolHint,
    opened,
    decoded,
  };
}

async function page(path, auth) {
  const result = await api(path, { headers: auth });
  expect(result.status === 200, `${path} ${result.status}`);
  return result.body;
}

async function firstEpisode(items, auth) {
  for (const item of items) {
    const detail = await api(`/api/v1/catalog/series/${item.id}`, { headers: auth });
    if (detail.status !== 200) {
      continue;
    }
    const episode = (detail.body?.episodes ?? []).find((candidate) => candidate.extension);
    if (episode) {
      return { ...episode, seriesId: item.id };
    }
  }
  return null;
}

async function openReference(url) {
  const response = await fetch(url, {
    headers: { Range: 'bytes=0-8191' },
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const head = bytes.subarray(0, 16).toString('utf8');
  const playlist = head.startsWith('#EXTM3U');
  let segmentStatus = null;
  let segmentBytes = 0;
  if (playlist) {
    const line = bytes
      .toString('utf8')
      .split(/\r?\n/u)
      .find((item) => item.length > 0 && !item.startsWith('#'));
    if (line) {
      const segment = await fetch(new URL(line, url), {
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      const segmentBody = Buffer.from(await segment.arrayBuffer());
      segmentStatus = segment.status;
      segmentBytes = segmentBody.length;
    }
  }
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    bytes: bytes.length,
    playlist,
    segmentStatus,
    segmentBytes,
    looksLikeMedia: playlist || head.includes('ftyp') || (response.status === 200 && bytes.length > 0),
  };
}

async function decodeReference(url) {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    return { tool: 'absent' };
  }
  const args = [
    '-hide_banner',
    '-loglevel',
    'info',
    '-allowed_extensions',
    'ALL',
    '-extension_picky',
    '0',
    '-t',
    '12',
    '-i',
    url,
    '-f',
    'null',
    '-',
  ];
  const output = await new Promise((resolve) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const chunks = [];
    child.stderr.on('data', (chunk) => chunks.push(chunk));
    child.on('exit', (code) => {
      resolve({ code: code ?? 1, text: Buffer.concat(chunks).toString('utf8') });
    });
  });
  const safe = redact(output.text);
  const time = safe.match(/time=(\d\d:\d\d:\d\d(?:\.\d+)?)/gu);
  const audio = /Audio:/.test(safe);
  const video = /Video:/.test(safe);
  return {
    tool: 'ffmpeg',
    code: output.code,
    video,
    audio,
    lastTime: time ? time[time.length - 1].slice(5) : null,
  };
}

function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG_PATH,
    'C:\\Program Files\\Universidad Continental\\Contiverso CIE\\Contiverso CIE_Data\\StreamingAssets\\ffmpeg.exe',
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
}

async function api(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers ?? {}),
    },
    body: options.body,
    signal: AbortSignal.timeout(40000),
  });
  const text = await response.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { status: response.status, body };
}

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function redact(value) {
  return value
    .replace(/https?:\/\/\S+/gu, '[url]')
    .replaceAll(password, '[secret]')
    .replaceAll(username, '[user]');
}

function emit(value) {
  const text = JSON.stringify(value);
  if (/https?:\/\//u.test(text) || text.includes(password) || text.includes(username)) {
    console.error('La salida contenía material sensible y no se imprime.');
    process.exit(1);
  }
  console.log(text);
}
