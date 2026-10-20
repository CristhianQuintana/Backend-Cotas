import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { jwtVerify } from 'jose';
import type { AppConfig } from './config/app-config';

type PreviewSession = {
  id: string;
  directory: string;
  process: ChildProcess;
  abort: AbortController;
  lastAccess: number;
  proxy: Server | null;
};

const sessions = new Map<string, PreviewSession>();
let idleTimer: NodeJS.Timeout | null = null;

type PreviewServer = {
  post: (path: string, handler: (req: Request, res: Response) => void) => void;
  get: (path: string, handler: (req: Request, res: Response) => void) => void;
  delete: (path: string, handler: (req: Request, res: Response) => void) => void;
};

export function attachDevPreview(server: PreviewServer, config: AppConfig): void {
  const ffmpeg = findFfmpeg();
  server.post('/dev/preview', (req, res) => {
    void createPreview(req, res, config, ffmpeg);
  });
  server.get('/dev/preview/:id/:file', (req, res) => {
    void servePreview(req, res);
  });
  server.delete('/dev/preview/:id', (req, res) => {
    stopSession(String(req.params.id));
    res.status(204).end();
  });
}

async function createPreview(
  req: Request,
  res: Response,
  config: AppConfig,
  ffmpeg: string | null,
): Promise<void> {
  if (!(await authorized(req, config))) {
    res.status(401).json({ message: 'Sesión no válida.' });
    return;
  }
  const streamUrl = req.body?.streamUrl;
  if (!allowedStreamUrl(streamUrl, config)) {
    res.status(400).json({ message: 'El canal no se puede previsualizar.' });
    return;
  }
  if (!ffmpeg) {
    res
      .status(503)
      .json({ message: 'No hay un conversor local capaz de abrir el audio de este canal.' });
    return;
  }
  try {
    const session = await startSession(ffmpeg, streamUrl);
    res.json({ id: session.id, url: `/dev/preview/${session.id}/index.m3u8` });
  } catch {
    if (!res.headersSent) {
      res.status(503).json({ message: 'No se pudo preparar el canal.' });
    }
  }
}

async function servePreview(req: Request, res: Response): Promise<void> {
  const session = sessions.get(String(req.params.id));
  const file = String(req.params.file);
  if (!session || !/^(index\.m3u8|seg-\d+\.ts)$/.test(file)) {
    res.status(404).end();
    return;
  }
  session.lastAccess = Date.now();
  const full = path.join(session.directory, file);
  if (!(await waitForFile(full, file.endsWith('.m3u8') ? 25000 : 8000))) {
    res.status(404).end();
    return;
  }
  res.type(file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
  createReadStream(full).pipe(res);
}

async function startSession(ffmpeg: string, streamUrl: string): Promise<PreviewSession> {
  return progressiveUrl(streamUrl)
    ? startFileSession(ffmpeg, streamUrl)
    : startLiveSession(ffmpeg, streamUrl);
}

async function startLiveSession(ffmpeg: string, streamUrl: string): Promise<PreviewSession> {
  const id = randomUUID();
  const directory = path.join(tmpdir(), `cotas-preview-${id}`);
  await mkdir(directory, { recursive: true });
  const abort = new AbortController();
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-fflags',
      '+genpts+discardcorrupt',
      '-f',
      'mpegts',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '30',
      '-keyint_min',
      '30',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-af',
      'aresample=async=1',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_list_size',
      '6',
      '-hls_flags',
      'delete_segments+omit_endlist+independent_segments',
      '-hls_segment_filename',
      'seg-%d.ts',
      'index.m3u8',
    ],
    { cwd: directory, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true },
  );
  const session: PreviewSession = {
    id,
    directory,
    process: child,
    abort,
    lastAccess: Date.now(),
    proxy: null,
  };
  sessions.set(id, session);
  child.on('error', () => stopSession(id));
  child.stdin?.on('error', () => undefined);
  child.on('exit', () => {
    if (sessions.get(id) === session) {
      sessions.delete(id);
    }
  });
  void feed(streamUrl, child, abort.signal).catch(() => stopSession(id));
  watchIdle();
  return session;
}

async function startFileSession(ffmpeg: string, streamUrl: string): Promise<PreviewSession> {
  const id = randomUUID();
  const directory = path.join(tmpdir(), `cotas-preview-${id}`);
  await mkdir(directory, { recursive: true });
  const proxy = await openLocalProxy(streamUrl);
  const abort = new AbortController();
  const child = spawn(
    ffmpeg,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      proxy.url,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '48',
      '-keyint_min',
      '48',
      '-sc_threshold',
      '0',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-ac',
      '2',
      '-ar',
      '48000',
      '-f',
      'hls',
      '-hls_time',
      '4',
      '-hls_list_size',
      '8',
      '-hls_flags',
      'delete_segments+omit_endlist+independent_segments',
      '-hls_segment_filename',
      'seg-%d.ts',
      'index.m3u8',
    ],
    { cwd: directory, stdio: 'ignore', windowsHide: true },
  );
  const session: PreviewSession = {
    id,
    directory,
    process: child,
    abort,
    lastAccess: Date.now(),
    proxy: proxy.server,
  };
  sessions.set(id, session);
  child.on('error', () => stopSession(id));
  child.on('exit', () => {
    if (sessions.get(id) === session) {
      stopSession(id);
    }
  });
  watchIdle();
  return session;
}

function progressiveUrl(value: string): boolean {
  try {
    return !new URL(value).pathname.toLowerCase().endsWith('.m3u8');
  } catch {
    return false;
  }
}

function openLocalProxy(streamUrl: string): Promise<{ server: Server; url: string }> {
  const server = createServer((request, response) => {
    void forwardStream(streamUrl, request, response);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('proxy'));
        return;
      }
      resolve({ server, url: `http://127.0.0.1:${address.port}/media` });
    });
  });
}

async function forwardStream(
  streamUrl: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const headers = new Headers();
    if (typeof request.headers.range === 'string') {
      headers.set('range', request.headers.range);
    }
    const upstream = await fetch(streamUrl, { headers });
    response.statusCode = upstream.status;
    for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const value = upstream.headers.get(name);
      if (value) {
        response.setHeader(name, value);
      }
    }
    if (!upstream.body) {
      response.end();
      return;
    }
    const reader = upstream.body.getReader();
    request.on('close', () => {
      void reader.cancel().catch(() => undefined);
    });
    while (true) {
      const chunk = await reader.read();
      if (chunk.done || response.destroyed) {
        break;
      }
      if (!response.write(Buffer.from(chunk.value))) {
        await new Promise((resolve) => response.once('drain', resolve));
      }
    }
    response.end();
  } catch {
    if (!response.headersSent) {
      response.statusCode = 502;
    }
    response.end();
  }
}

function stopSession(id: string): void {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  sessions.delete(id);
  session.abort.abort();
  session.proxy?.close();
  session.process.stdin?.end();
  session.process.kill();
  void rm(session.directory, { recursive: true, force: true }).catch(() => undefined);
}

async function feed(streamUrl: string, child: ChildProcess, signal: AbortSignal): Promise<void> {
  const stdin = child.stdin;
  if (!stdin) {
    return;
  }
  const seen = new Set<string>();
  while (!signal.aborted && !stdin.destroyed) {
    try {
      const segments = await mediaSegments(streamUrl, signal);
      const fresh = segments.filter((item) => !seen.has(item));
      const pending = fresh.slice(Math.max(0, fresh.length - 2));
      for (const segment of pending) {
        if (signal.aborted || stdin.destroyed) {
          return;
        }
        seen.add(segment);
        const response = await fetch(segment, { signal });
        if (!response.ok) {
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!stdin.write(bytes)) {
          await new Promise((resolve) => stdin.once('drain', resolve));
        }
      }
    } catch {
      if (signal.aborted) {
        return;
      }
    }
    await delay(700, signal);
  }
}

async function mediaSegments(startUrl: string, signal: AbortSignal): Promise<string[]> {
  let current = startUrl;
  for (let hop = 0; hop < 3; hop += 1) {
    const response = await fetch(current, { signal });
    if (!response.ok) {
      return [];
    }
    const lines = (await response.text()).split(/\r?\n/).map((line) => line.trim());
    const addresses = lines.filter((line) => line && !line.startsWith('#'));
    if (lines.some((line) => line.startsWith('#EXTINF'))) {
      return addresses.map((line) => new URL(line, response.url).toString());
    }
    const variant = addresses[0];
    if (!variant) {
      return [];
    }
    current = new URL(variant, response.url).toString();
  }
  return [];
}

async function authorized(req: Request, config: AppConfig): Promise<boolean> {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return false;
  }
  try {
    await jwtVerify(token, new TextEncoder().encode(config.jwtAccessSecret), {
      issuer: config.jwtIssuer,
      audience: config.jwtAudience,
    });
    return true;
  } catch {
    return false;
  }
}

function allowedStreamUrl(value: unknown, config: AppConfig): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      config.xuiAllowedStreamHosts.includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function findFfmpeg(): string | null {
  const candidates = [
    process.env.FFMPEG_PATH,
    'C:\\Program Files\\Universidad Continental\\Contiverso CIE\\Contiverso CIE_Data\\StreamingAssets\\ffmpeg.exe',
    'C:\\Program Files\\BlueStacks_nxt\\ffmpeg.exe',
  ].filter(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.length > 0 && existsSync(candidate),
  );
  return candidates.find((candidate) => decodesMpegAudio(candidate)) ?? null;
}

function decodesMpegAudio(ffmpeg: string): boolean {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-decoders'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 8000,
  });
  return /\bmp2\b/u.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

function watchIdle(): void {
  if (idleTimer) {
    return;
  }
  idleTimer = setInterval(() => {
    const cutoff = Date.now() - 30_000;
    for (const [id, session] of sessions) {
      if (session.lastAccess < cutoff) {
        stopSession(id);
      }
    }
    if (sessions.size === 0 && idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
  }, 10_000);
  idleTimer.unref?.();
}

async function waitForFile(file: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (existsSync(file)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return existsSync(file);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}
