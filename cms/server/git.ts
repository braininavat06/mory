import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export async function gitOutput(args: string[], cwd: string) {
  return (await exec('git', args, { cwd, timeout: 120_000, maxBuffer: 32_000_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes -o ConnectTimeout=15' } })).stdout;
}
