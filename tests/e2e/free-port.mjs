// Frees port 4173 before the test server starts. A previous run's `vite preview` can be left behind on Windows,
// and an old one serves a stale file list (404s after any rebuild), so we never reuse it.
import { execSync } from 'node:child_process';

const PORT = 4173;
try {
  if (process.platform === 'win32') {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      if (line.includes(`:${PORT} `) && /LISTENING/.test(line)) pids.add(line.trim().split(/\s+/).pop());
    }
    for (const pid of pids) {
      if (pid && pid !== '0') execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    }
  } else {
    execSync(`lsof -ti tcp:${PORT} | xargs -r kill -9`, { stdio: 'ignore' });
  }
} catch {
  /* nothing to free */
}
