import { describe, expect, it } from 'vitest';
import net from 'node:net';
import { canBindPort, freePort, getPidsOnPort, killPids } from '../scripts/free-port.mjs';

describe('free-port utility', () => {
  it('detects a bindable port as free', async () => {
    // Pick an ephemeral high port unlikely to be occupied
    const testPort = 49152 + Math.floor(Math.random() * 10000);
    const isFree = await canBindPort(testPort);
    expect(isFree).toBe(true);
  });

  it('detects when a port is bound and in use', async () => {
    const testPort = 49152 + Math.floor(Math.random() * 10000);
    const server = net.createServer();

    await new Promise((resolve) => {
      server.listen(testPort, '127.0.0.1', () => resolve());
    });

    try {
      const isFree = await canBindPort(testPort);
      expect(isFree).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }

    const isFreeAfterClose = await canBindPort(testPort);
    expect(isFreeAfterClose).toBe(true);
  });

  it('reports already free ports without attempting kills', async () => {
    const testPort = 49152 + Math.floor(Math.random() * 10000);
    const result = await freePort(testPort, { verbose: false });
    expect(result.freed).toBe(false);
    expect(result.pids).toEqual([]);
  });

  it('ignores current process PID and invalid PIDs during kill', () => {
    expect(() => {
      killPids([0, process.pid, -1]);
    }).not.toThrow();
  });

  it('returns an array of PIDs for port queries', () => {
    const testPort = 49152 + Math.floor(Math.random() * 10000);
    const pids = getPidsOnPort(testPort);
    expect(Array.isArray(pids)).toBe(true);
  });
});
