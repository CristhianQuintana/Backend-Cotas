#!/usr/bin/env node
/**
 * Resiliencia controlada contra stack Docker Compose local.
 * Mide health/ready ante caídas de postgres/redis y recuperación.
 *
 * Uso (desde backend/):
 *   node scripts/validate-resilience.mjs
 */
import { spawnSync } from 'node:child_process';

const base = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');
const prefix = '/api/v1';
const report = { steps: [] };

function compose(...args) {
  const r = spawnSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    shell: true,
  });
  if (r.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} -> ${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

async function probe(path) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}${prefix}${path}`, { signal: AbortSignal.timeout(5_000) });
    return { status: res.status, ms: Date.now() - t0, body: await res.text() };
  } catch (error) {
    return { status: 0, ms: Date.now() - t0, error: String(error?.message ?? error) };
  }
}

function record(name, data) {
  report.steps.push({ name, ...data, at: new Date().toISOString() });
  console.log(JSON.stringify(report.steps.at(-1)));
}

try {
  record('baseline_live', await probe('/health/live'));
  record('baseline_ready', await probe('/health/ready'));

  compose('stop', 'postgres');
  await sleep(2_000);
  const readyDown = await probe('/health/ready');
  record('ready_postgres_down', readyDown);
  if (readyDown.status !== 503 && readyDown.status !== 0) {
    throw new Error(`ready debió ser 503/0 con PG down, fue ${readyDown.status}`);
  }
  if (readyDown.ms > 3_000) {
    throw new Error(`ready tardó ${readyDown.ms}ms con PG down (objetivo <3000ms)`);
  }

  compose('start', 'postgres');
  let recovered = false;
  for (let i = 0; i < 30; i += 1) {
    await sleep(2_000);
    const ready = await probe('/health/ready');
    if (ready.status === 200) {
      record('ready_postgres_recovered', ready);
      recovered = true;
      break;
    }
  }
  if (!recovered) {
    throw new Error('PostgreSQL no recuperó ready=200 a tiempo');
  }

  compose('stop', 'redis');
  await sleep(2_000);
  const deps = await probe('/health/dependencies').catch(() => null);
  // dependencies puede no existir como public; intentar ready sigue OK (PG up).
  record('after_redis_stop_ready', await probe('/health/ready'));
  if (deps) {
    record('after_redis_stop_dependencies', deps);
  }
  compose('start', 'redis');
  await sleep(3_000);
  record('final_ready', await probe('/health/ready'));

  report.ok = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.ok = false;
  report.error = String(error?.message ?? error);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
