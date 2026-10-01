import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative, sep } from 'node:path';

export const root = fileURLToPath(new URL('../../', import.meta.url));

export function assertRuntimeLocation(repository: string, runtime: string) {
  const location = relative(resolve(repository), resolve(runtime));
  if (!location || (!location.startsWith(`..${sep}`) && location !== 'runtime' && !location.startsWith(`runtime${sep}`))) throw new Error('Runtime within the repository must stay inside runtime/');
}

export function serverConfig() {
  if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
  const runtime = resolve(root, process.env.MORY_RUNTIME_DIR || 'runtime');
  assertRuntimeLocation(root, runtime);
  const port = Number(process.env.MORY_CMS_PORT ?? 40009);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid CMS port');
  const origin = process.env.MORY_CMS_ORIGIN ?? `http://127.0.0.1:${port}`;
  if (!/^https?:\/\//.test(origin) || new URL(origin).origin !== origin) throw new Error('MORY_CMS_ORIGIN must be an exact origin without a trailing slash');
  return { root, runtime, port, origin };
}
