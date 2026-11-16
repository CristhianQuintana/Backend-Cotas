/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: [
    'src/common/**/*.ts',
    'src/config/**/*.ts',
    'src/infrastructure/**/*.ts',
    'src/modules/**/application/**/*.ts',
    'src/modules/**/domain/**/*.ts',
    'src/modules/**/infrastructure/**/*.ts',
    'src/modules/health/**/*.ts',
    'src/modules/notifications/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/dto/**',
    // Adaptadores I/O: cobertura por e2e/integración.
    '!src/modules/identity/infrastructure/persistence/prisma-identity.store.ts',
    '!src/modules/audit/infrastructure/prisma-audit.repository.ts',
    '!src/modules/integrations/xui/infrastructure/http/xui-http.client.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'json-summary', 'lcov'],
};
