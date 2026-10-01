import { serve } from '@hono/node-server';
import { join } from 'node:path';
import { existsSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Store } from './store.ts';
import { Publisher, githubDeployment, githubRetry } from './publish.ts';
import { createApp } from './app.ts';
import { backup } from './backup.ts';
import { serverConfig } from './config.ts';
const { root, runtime, port, origin } = serverConfig();
const store = new Store(root, runtime);
chmodSync(join(runtime, 'cms.sqlite'), 0o600);
const lock = join(runtime, 'server.lock');
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, 'utf8'));
  try { process.kill(pid, 0); throw new Error('CMS is already running'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; unlinkSync(lock); }
}
writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 });
const configuredRemote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
const remote = process.env.MORY_PUBLISH_REMOTE ?? configuredRemote.replace(/^https:\/\/github.com\//, 'git@github.com:');
const publisher = new Publisher(store, { remote, deploymentIntervalMs: process.env.MORY_GITHUB_TOKEN ? 15_000 : 60_000, branch: process.env.MORY_PUBLISH_BRANCH, author: process.env.MORY_GIT_NAME, email: process.env.MORY_GIT_EMAIL, deployment: githubDeployment(remote, process.env.MORY_GITHUB_TOKEN, 'deploy.yml', process.env.MORY_PUBLISH_BRANCH ?? 'main'), retryDeployment: githubRetry(process.env.MORY_GITHUB_TOKEN) });
publisher.resume();
const server = serve({ fetch: createApp(store, publisher, origin).fetch, hostname: '127.0.0.1', port }, () => console.log(`Mory CMS: ${origin}`));
let backingUp = false;
const takeBackup = async () => { if (backingUp) return; backingUp = true; try { await backup(store); } catch (error) { console.error('Backup failed:', error); } finally { backingUp = false; } };
void takeBackup(); const timer = setInterval(takeBackup, 3600_000); timer.unref();
let stopping = false;
async function stop() { if (stopping) return; stopping = true; clearInterval(timer); server.close(); await publisher.idle(); while (backingUp) await new Promise(r => setTimeout(r, 50)); store.close(); unlinkSync(lock); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
