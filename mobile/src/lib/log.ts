import { defaults } from '@/config/appConfig';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
}

/**
 * Keys whose values must never reach a log line, a diagnostics screen, or a
 * screenshot an umpire sends you asking why it broke.
 */
const SECRET_KEYS = ['password', 'passphrase', 'psk', 'secret', 'token', 'authorization'];

/** Hashes are long and useless in full; the first 12 hex chars identify a clip. */
const isHashLike = (v: string) => /^[0-9a-f]{40,}$/i.test(v);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '…';
  if (typeof value === 'string') return isHashLike(value) ? `${value.slice(0, 12)}…` : value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_KEYS.includes(k.toLowerCase()) ? '«redacted»' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * An in-memory ring of log lines, surfaced on the diagnostics screen.
 * Deliberately not persisted: a log file is one more thing that outlives a
 * match, and the retention promise is that nothing does.
 */
const ring: LogEntry[] = [];
const listeners = new Set<() => void>();

function push(level: LogLevel, tag: string, message: string, detail?: unknown) {
  const text = detail === undefined ? message : `${message} ${JSON.stringify(redact(detail))}`;
  ring.push({ ts: Date.now(), level, tag, message: text });
  if (ring.length > defaults.auditLogMaxRows) ring.splice(0, ring.length - defaults.auditLogMaxRows);
  listeners.forEach((l) => l());
  if (__DEV__) console[level === 'debug' ? 'log' : level](`[${tag}] ${text}`);
}

export const log = {
  debug: (tag: string, message: string, detail?: unknown) => push('debug', tag, message, detail),
  info: (tag: string, message: string, detail?: unknown) => push('info', tag, message, detail),
  warn: (tag: string, message: string, detail?: unknown) => push('warn', tag, message, detail),
  error: (tag: string, message: string, detail?: unknown) => push('error', tag, message, detail),
  /** Newest first, for the diagnostics screen. */
  tail: (n = 200): LogEntry[] => ring.slice(-n).reverse(),
  clear: () => {
    ring.length = 0;
    listeners.forEach((l) => l());
  },
  subscribe: (fn: () => void): (() => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
