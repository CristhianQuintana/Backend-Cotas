import type { AuthenticatedUser } from '../modules/identity/domain/models/authenticated-user';

declare module 'express-serve-static-core' {
  interface Request {
    correlationId?: string;
    user?: AuthenticatedUser;
  }
}

export {};
