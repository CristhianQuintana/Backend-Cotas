import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<{ correlationId: string }>();

export const RequestContext = {
  run<T>(correlationId: string, callback: () => T): T {
    return storage.run({ correlationId }, callback);
  },
  get correlationId(): string | undefined {
    return storage.getStore()?.correlationId;
  },
};
