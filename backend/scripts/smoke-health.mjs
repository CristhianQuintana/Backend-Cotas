const base = (process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:3100').replace(/\/$/u, '');

const live = await fetch(`${base}/api/v1/health/live`);
const ready = await fetch(`${base}/api/v1/health/ready`);
const anonymous = await fetch(`${base}/api/v1/catalog/live/categories`);

const report = `live=${live.status} ready=${ready.status} anon=${anonymous.status}`;
if (live.status !== 200 || ready.status !== 200 || anonymous.status !== 401) {
  console.error(report);
  process.exit(1);
}
console.log(report);
