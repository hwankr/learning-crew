import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const windowsChrome =
  process.env.LEARNING_CREW_CHROME ??
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe';

export async function dumpDom(url, purpose) {
  const profile = `C:\\Windows\\Temp\\learningcrew-${purpose}-${process.pid}-${Date.now()}`;
  try {
    const { stdout } = await execFileAsync(windowsChrome, [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profile}`,
      '--virtual-time-budget=10000',
      '--dump-dom',
      url,
    ], { maxBuffer: 8 * 1024 * 1024 });
    return stdout;
  } finally {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Remove-Item -LiteralPath '${profile.replaceAll("'", "''")}' -Recurse -Force -ErrorAction SilentlyContinue`,
    ]).catch(() => undefined);
  }
}

async function asWindowsPath(path) {
  if (/^[a-z]:[\\/]/i.test(path)) return path;
  const { stdout } = await execFileAsync('wslpath', ['-w', path]);
  return stdout.trim();
}

/** PowerShell owns Chrome and CDP so the debug socket stays on Windows loopback. */
export async function runHarness(url) {
  const runner = await asWindowsPath(new URL('./run-chrome.ps1', import.meta.url).pathname);
  const chrome = await asWindowsPath(windowsChrome);
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    runner,
    '-Url',
    url,
    '-ChromePath',
    chrome,
  ], { maxBuffer: 8 * 1024 * 1024 });
  const line = stdout.trim().split(/\r?\n/).at(-1);
  if (!line) throw new Error('Windows Chrome runner returned no result');
  return JSON.parse(line);
}

export function resultJson(dom) {
  const match = dom.match(/<pre id="result">([^<]+)<\/pre>/);
  if (!match?.[1]) throw new Error('Chrome DOM did not contain #result JSON');
  return JSON.parse(match[1]);
}
