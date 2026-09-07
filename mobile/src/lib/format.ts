/** Formatting helpers. Every one of these appears in the umpire's field of view. */

export const seconds = (s: number): string => `${s.toFixed(1)}s`;

export const clock = (s: number): string => {
  const total = Math.max(0, Math.floor(s));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

export const megabytes = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;

export const percent = (n: number): string => `${Math.round(n)}%`;

export const timeOfDay = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
