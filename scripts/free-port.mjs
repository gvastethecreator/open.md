import net from 'node:net';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Checks if a TCP port can be bound on the specified host.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
export function canBindPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once('error', () => {
      resolve(false);
    });

    server.listen({ port, host }, () => {
      server.close(() => {
        resolve(true);
      });
    });
  });
}

/**
 * Finds process IDs listening on a specific port across Windows, macOS, and Linux.
 * @param {number} port
 * @returns {number[]}
 */
export function getPidsOnPort(port) {
  const pids = new Set();
  const currentPid = process.pid;

  if (process.platform === 'win32') {
    try {
      const netstatOutput = execSync('netstat -ano -p tcp', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const portPattern = new RegExp(`[:.]${port}\\s+.*(?:LISTENING|ESCUCHANDO)\\s+(\\d+)`, 'i');
      for (const line of netstatOutput.split(/\r?\n/)) {
        const match = line.match(portPattern);
        if (match && match[1]) {
          const pid = Number.parseInt(match[1], 10);
          if (pid > 0 && pid !== currentPid) {
            pids.add(pid);
          }
        }
      }
    } catch {
      // Fallback to PowerShell Get-NetTCPConnection if netstat fails
      try {
        const psCmd = `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess"`;
        const psOutput = execSync(psCmd, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        for (const line of psOutput.split(/\r?\n/)) {
          const pid = Number.parseInt(line.trim(), 10);
          if (pid > 0 && pid !== currentPid) {
            pids.add(pid);
          }
        }
      } catch {
        // Ignored
      }
    }
  } else {
    // macOS and Linux
    try {
      const lsofOutput = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN || lsof -ti :${port}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      for (const line of lsofOutput.split(/\r?\n/)) {
        const pid = Number.parseInt(line.trim(), 10);
        if (pid > 0 && pid !== currentPid) {
          pids.add(pid);
        }
      }
    } catch {
      // Fallback to fuser on Linux
      try {
        const fuserOutput = execSync(`fuser ${port}/tcp 2>/dev/null`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });

        for (const part of fuserOutput.trim().split(/\s+/)) {
          const pid = Number.parseInt(part.trim(), 10);
          if (pid > 0 && pid !== currentPid) {
            pids.add(pid);
          }
        }
      } catch {
        // Ignored
      }
    }
  }

  return Array.from(pids);
}

/**
 * Terminates process IDs cleanly or forcefully.
 * @param {number[]} pids
 */
export function killPids(pids) {
  for (const pid of pids) {
    if (!pid || pid === process.pid) continue;

    if (process.platform === 'win32') {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Process may have already exited
        }
      }
    } else {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        try {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        } catch {
          // Process may have already exited
        }
      }
    }
  }
}

/**
 * Ensures the target port is free. If occupied, identifies and kills the processes holding it,
 * then waits until the port is confirmed available.
 * @param {number} [port=33223]
 * @param {object} [options={}]
 * @param {string} [options.host='127.0.0.1']
 * @param {number} [options.timeout=3000]
 * @param {boolean} [options.verbose=true]
 * @returns {Promise<{ freed: boolean, pids: number[] }>}
 */
export async function freePort(port = 33223, options = {}) {
  const { host = '127.0.0.1', timeout = 3000, verbose = true } = options;

  const alreadyFree = await canBindPort(port, host);
  if (alreadyFree) {
    return { freed: false, pids: [] };
  }

  const pids = getPidsOnPort(port);
  if (pids.length > 0) {
    killPids(pids);
  }

  // Poll until the port is actually free
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const isFree = await canBindPort(port, host);
    if (isFree) {
      if (verbose && pids.length > 0) {
        console.log(`[open.md] Liberado puerto ${port} (proceso PID ${pids.join(', ')} finalizado).`);
      }
      return { freed: true, pids };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // If still not free after timeout, try one more attempt to find and kill
  const remainingPids = getPidsOnPort(port);
  if (remainingPids.length > 0) {
    killPids(remainingPids);
  }

  return { freed: await canBindPort(port, host), pids: [...pids, ...remainingPids] };
}

// Support CLI execution: node scripts/free-port.mjs [port]
try {
  const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  if (isDirectExecution) {
    const targetPort = Number.parseInt(process.argv[2], 10) || 33223;
    const result = await freePort(targetPort);
    if (result.freed) {
      console.log(`[open.md] Puerto ${targetPort} verificado y listo.`);
    } else {
      console.log(`[open.md] Puerto ${targetPort} disponible.`);
    }
  }
} catch {
  // Ignored in module loader context
}
