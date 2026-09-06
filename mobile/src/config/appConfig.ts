/**
 * Every tunable in one place, with the reason it has the value it has.
 *
 * Nothing in the app hardcodes 12 or 3 or 40. The vest announces its own ring
 * size in the `hello` message and the phone mirrors it; these are only the
 * values used before a vest has ever been heard from. A second vest, a longer
 * ring, a different pre-roll: all config, none of it a code change.
 */
export const defaults = {
  /**
   * Clips held on the phone. Older ones are purged unless pinned or reviewed.
   * The purge is the privacy promise, so it is enforced locally and does not
   * depend on the vest telling us to do it.
   */
  ringSize: 12,

  /** Seconds of run-up pulled from the vest ring buffer before the START press. */
  prerollSeconds: 3,

  /**
   * Auto-close a clip after this long with no END press. Spec 7.6 argues 40
   * over 25: a legitimate live ball with three runs and a throw is ~29s, and
   * truncating those loses exactly the deliveries people argue about.
   */
  timeoutSeconds: 40,

  /**
   * How long a pinned clip survives on the phone before it is purged anyway.
   * A pin is an exception to the retention promise, not an escape from it.
   */
  pinRetentionDays: 7,

  /** Control-channel heartbeat. Three missed pongs means the link is down. */
  heartbeatSeconds: 5,
  missedPongsBeforeDown: 3,

  /** Reconnect backoff, capped so a long outage still recovers promptly. */
  reconnectBackoffMs: [500, 1000, 2000, 4000, 8000, 10000],

  /** Audit log ceiling. Bounded so it cannot grow without limit on a phone. */
  auditLogMaxRows: 2000,
} as const;

/** Frame duration used for single-frame stepping when a clip omits its fps. */
export const FALLBACK_FPS = 60;

/**
 * The only network peer the app is permitted to talk to during a match is the
 * paired vest on the local AP. There is no analytics SDK, no crash reporter,
 * and no remote config. See docs/PRIVACY.md.
 */
export const ALLOWED_HOSTS_NOTE =
  'The paired vest only. No analytics, no crash reporting, no third-party network calls.';

export type AppDefaults = typeof defaults;
