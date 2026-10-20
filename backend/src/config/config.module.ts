import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_CONFIG, type AppConfig } from './app-config';
import { validateEnv } from './env.validation';

let loadedConfig: AppConfig | undefined;

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate: (env) => {
        for (const [key, value] of Object.entries(env)) {
          if (typeof value !== 'string' || value.trim().length === 0) {
            continue;
          }
          const current = process.env[key];
          if (current === undefined || current.trim().length === 0) {
            process.env[key] = value;
          }
        }
        loadedConfig = validateEnv(env);
        return loadedConfig;
      },
    }),
  ],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => {
        if (!loadedConfig) {
          throw new Error('Configuración inválida: NODE_ENV');
        }
        return loadedConfig;
      },
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
