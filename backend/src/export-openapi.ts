import 'reflect-metadata';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureHttp, createSwaggerDocument } from './configure-http';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    abortOnError: false,
    bodyParser: false,
    logger: false,
  });
  try {
    configureHttp(app);
    const serialized = `${JSON.stringify(createSwaggerDocument(app), null, 2)}\n`;
    for (const secret of [
      process.env.JWT_ACCESS_SECRET,
      process.env.MFA_ENCRYPTION_KEY,
      process.env.XUI_PASSWORD,
      process.env.DATABASE_URL,
    ]) {
      if (secret && serialized.includes(secret)) {
        throw new Error('El contrato OpenAPI incluye un valor secreto');
      }
    }
    const target = path.resolve(process.cwd(), 'openapi/openapi.json');
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, serialized, 'utf8');
    console.log('Contrato escrito en openapi/openapi.json');
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : 'No se pudo exportar OpenAPI',
  );
  process.exit(1);
});
