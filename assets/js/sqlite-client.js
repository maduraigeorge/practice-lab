/* Main-thread wrapper around sqlite-worker.js.
 * - call(type, payload, {timeout}) returns a promise for the worker's result. Calls run one after another, and a call's timer
 *   starts only when IT starts running (waiting in the queue never counts against it).
 * - If a running call exceeds its timeout the worker is terminated and restarted from the last snapshot, so a runaway query
 *   (for example an endless recursive CTE) can never freeze the page or lose the database. */
export class SqliteTimeout extends Error {}

export class SqliteClient {
  constructor() { this.snapshot = null; this.nextId = 1; this.pending = new Map(); this.restoring = null; this.chain = Promise.resolve(); this._start(); }

  _start() {
    this.worker = new Worker(new URL('./sqlite-worker.js', import.meta.url));
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id); if (!p) return;
      this.pending.delete(data.id); clearTimeout(p.timer);
      if (!data.ok) return p.reject(new Error(data.error));
      if (data.result && data.result.bytes) { this.snapshot = data.result.bytes; data.result.bytes = undefined; }
      p.resolve(data.result);
    };
    this.worker.onerror = e => this._rejectAll(new Error('The SQL engine failed to start: ' + (e.message || 'unknown error') + ' (open this page through http(s), not file://)'));
  }

  _rejectAll(err) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(err); } this.pending.clear(); }

  _send(type, payload, timeout, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => this._kill(), timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, type, ...payload }, transfer);
    });
  }

  _kill() {
    this.worker.terminate();
    this._rejectAll(new SqliteTimeout('The query ran for too long and was stopped.'));
    this._start();
    if (this.snapshot) {
      this.restoring = this._send('open', { bytes: this.snapshot.slice() }, 30000).catch(() => {}).finally(() => { this.restoring = null; });
    }
  }

  call(type, payload = {}, { timeout = 15000 } = {}) {
    const run = async () => {
      if (this.restoring) await this.restoring;
      const transfer = [];
      if (type === 'open' && payload.bytes) { this.snapshot = payload.bytes.slice(); transfer.push(payload.bytes.buffer); }
      return this._send(type, payload, timeout, transfer);
    };
    const result = this.chain.then(run);
    this.chain = result.catch(() => {});          // a failed call must not block the ones behind it
    return result;
  }
}
