import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { Store } from '../server/store.ts';
import { backup } from '../server/backup.ts';
const root = fileURLToPath(new URL('../../', import.meta.url));
if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const store = new Store(root, resolve(root, process.env.MORY_RUNTIME_DIR || 'runtime'));
try { console.log(await backup(store, new Date(), { manual: true })); } finally { store.close(); }
