import { validateEnv } from '../src/config/env.validation';

try {
  validateEnv(process.env);
  console.log('Configuración válida.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Configuración inválida');
  process.exit(1);
}
