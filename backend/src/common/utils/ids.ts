import { randomUUID } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newId(): string {
  return randomUUID();
}

export function isUuid(value: string | undefined): value is string {
  return typeof value === 'string' && UUID.test(value);
}
