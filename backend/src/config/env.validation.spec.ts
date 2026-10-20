import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'test',
    PORT: '3000',
    API_PREFIX: 'api/v1',
    DATABASE_URL: 'postgresql://cotas_test:test_only_password@127.0.0.1:5432/cotas_test',
    JWT_ACCESS_SECRET: 'test-only-jwt-access-secret-32chars-min',
    JWT_ISSUER: 'cotas-backend-test',
    JWT_AUDIENCE: 'cotas-clients-test',
    ACCESS_TOKEN_TTL_SECONDS: '120',
    REFRESH_TOKEN_TTL_SECONDS: '3600',
    MFA_ENCRYPTION_KEY: 'test-only-mfa-encryption-key-32chars',
    XUI_BASE_URL: 'http://xui.test.local',
    XUI_USERNAME: 'xui_test_user',
    XUI_PASSWORD: 'xui_test_password_not_real',
    XUI_TIMEOUT_MS: '1000',
    XUI_MAX_RESPONSE_BYTES: '200000',
    XUI_ALLOWED_STREAM_HOSTS: 'stream.test.local',
    LOG_LEVEL: 'error',
    CORS_ORIGINS: 'http://localhost:3000',
    TRUST_PROXY: 'false',
    SWAGGER_ENABLED: 'false',
    BODY_LIMIT: '16kb',
    SENSITIVE_RATE_LIMIT: '10',
    SENSITIVE_RATE_TTL_MS: '60000',
    GLOBAL_RATE_LIMIT: '300',
    ARGON2_MEMORY_COST: '4096',
    ARGON2_TIME_COST: '1',
    ARGON2_PARALLELISM: '1',
  });

  it('acepta una configuración de prueba completa', () => {
    const config = validateEnv(valid());
    expect(config.port).toBe(3000);
    expect(config.xuiAllowedStreamHosts).toEqual(['stream.test.local']);
    expect(config.databaseUrl).not.toContain('CHANGE_ME');
  });

  it('falla si falta una variable crítica y no revela el valor', () => {
    const env = valid();
    delete env.JWT_ACCESS_SECRET;
    expect(() => validateEnv(env)).toThrow('Configuración inválida: JWT_ACCESS_SECRET');
  });

  it('rechaza secretos de ejemplo y HTTP de XUI en producción', () => {
    const env = valid();
    env.NODE_ENV = 'production';
    env.JWT_ACCESS_SECRET = 'CHANGE_ME_BUT_LONG_ENOUGH_FOR_LENGTH_32';
    expect(() => validateEnv(env)).toThrow('JWT_ACCESS_SECRET');

    const http = valid();
    http.NODE_ENV = 'production';
    http.XUI_BASE_URL = 'http://xui.local';
    http.CORS_ORIGINS = 'https://tv.example.com';
    http.ARGON2_MEMORY_COST = '19456';
    http.ARGON2_TIME_COST = '2';
    http.ACCESS_TOKEN_TTL_SECONDS = '900';
    expect(() => validateEnv(http)).toThrow('XUI_BASE_URL');
  });

  it('rechaza un origen CORS comodín', () => {
    const env = valid();
    env.CORS_ORIGINS = '*';
    expect(() => validateEnv(env)).toThrow('CORS_ORIGINS');
  });
});
