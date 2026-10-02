import { mkdirSync, chmodSync, existsSync, readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { get } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { serverConfig } from '../server/config.ts';

const { root, runtime, port, origin } = serverConfig();
const entry = join(root, 'cms/server/index.ts');
const lock = join(runtime, 'server.lock');
const startLock = join(runtime, 'service-start.lock');
const log = join(runtime, 'cms.log');
const launcherLog = join(runtime, 'automator.log');
const url = `http://127.0.0.1:${port}`;

function live(pid: number) {
  if (!Number.isInteger(pid) || pid < 2) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}
function running(): number | null {
  if (!existsSync(lock)) return null;
  const pid = Number(readFileSync(lock, 'utf8'));
  if (!live(pid)) return null;
  const command = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (!command.includes(entry)) throw new Error('서버 PID의 프로세스가 Mory CMS가 아닙니다. 자동 종료하지 않습니다.');
  return pid;
}
async function healthy() {
  // Use http directly: Node fetch can replace an explicit Host with the URL
  // host. The probe connects locally while exercising the configured origin.
  return new Promise<boolean>(resolve => {
    const request = get(`${url}/api/health`, { headers: { Host: new URL(origin).host }, timeout: 1000 }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('error', () => resolve(false));
      response.on('end', () => {
        try { const data = JSON.parse(body); resolve(response.statusCode === 200 && data.service === 'mory-cms' && data.ok === true); }
        catch { resolve(false); }
      });
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}
async function assertFreePort() {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new Error(`포트 ${port}가 이미 사용 중입니다.`)); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error(`포트 ${port} 상태를 확인하지 못했습니다.`)); });
    socket.once('error', error => (error as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
}
function prepare() {
  mkdirSync(runtime, { recursive: true, mode: 0o700 }); chmodSync(runtime, 0o700);
  for (const file of [log, launcherLog]) { closeSync(openSync(file, 'a', 0o600)); chmodSync(file, 0o600); }
}
async function start() {
  prepare();
  const pid = running();
  if (pid) {
    if (!await healthy()) throw new Error(`CMS 프로세스(${pid})는 있지만 응답하지 않습니다. ${log}를 확인하세요.`);
    console.log(`Already running: ${origin} (pid=${pid})`); return;
  }
  if (existsSync(startLock)) {
    if (live(Number(readFileSync(startLock, 'utf8')))) { console.log('CMS 시작 작업이 이미 진행 중입니다.'); return; }
    unlinkSync(startLock);
  }
  writeFileSync(startLock, String(process.pid), { flag: 'wx', mode: 0o600 });
  try {
    await assertFreePort();
    // Build only CMS assets, never publish or alter public content.
    const buildLog = openSync(launcherLog, 'a');
    try { execFileSync('npm', ['run', 'cms:build'], { cwd: root, stdio: ['ignore', buildLog, buildLog] }); }
    finally { closeSync(buildLog); }
    const child = spawn('/opt/homebrew/bin/python3', [join(root, '../ops/log_run.py'), '--log', log, '--cwd', root, '--', process.execPath, '--import', 'tsx', entry], { cwd: root, env: process.env, detached: true, stdio: 'ignore' });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
    for (let attempt = 0; attempt < 40; attempt++) {
      const serverPid = running();
      if (serverPid && await healthy()) { console.log(`Started: ${origin} (pid=${serverPid})`); return; }
      if (!live(child.pid!)) break;
      await delay(250);
    }
    throw new Error(`CMS 시작을 확인하지 못했습니다. 로그: ${log}`);
  } finally {
    if (existsSync(startLock) && Number(readFileSync(startLock, 'utf8')) === process.pid) unlinkSync(startLock);
  }
}
async function stop() {
  const pid = running();
  if (!pid) { console.log('Not running.'); return; }
  process.kill(pid, 'SIGTERM');
  // Let pending publication and backup finish; never force-kill SQLite/Git.
  for (let attempt = 0; attempt < 120; attempt++) {
    if (!live(pid)) { console.log('Stopped.'); return; }
    await delay(250);
  }
  throw new Error(`CMS가 종료 작업을 진행 중입니다. 강제 종료하지 않았습니다. 로그: ${log}`);
}

try {
  switch (process.argv[2] ?? 'start') {
    case 'start': await start(); break;
    case 'stop': await stop(); break;
    case 'restart': {
      await stop();
      await assertFreePort();
      execFileSync('/usr/bin/open', ['-n', join(root, '000_mory-server.app')]);
      for (let attempt = 0; attempt < 240; attempt++) {
        if (running() && await healthy()) { console.log('Restarted through Automator and healthy.'); break; }
        if (attempt === 239) throw new Error(`Automator 시작을 확인하지 못했습니다. 로그: ${launcherLog}`);
        await delay(250);
      }
      break;
    }
    case 'status': {
      const pid = running();
      if (!pid || !await healthy()) throw new Error('Not running.');
      console.log(`Running: ${origin} (pid=${pid})`); break;
    }
    case 'logs': {
      prepare(); const child = spawn('/usr/bin/tail', ['-n', '100', '-f', log], { stdio: 'inherit' });
      await new Promise<void>(resolve => child.once('exit', () => resolve())); break;
    }
    default: throw new Error('Usage: ./server.sh {start|stop|restart|status|logs}');
  }
} catch (error) { console.error((error as Error).message); process.exitCode = 1; }
