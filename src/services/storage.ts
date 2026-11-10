/**
 * LocalStorage persistence with schema versioning. Every read/write is guarded:
 * private windows and blocked storage simply fall back to in-memory defaults.
 */

const PREFIX = 'tal:v1:';

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

/** Deep-merge stored objects onto defaults so new settings fields get defaults. */
export function mergeDefaults<T>(defaults: T, stored: unknown): T {
  if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) return (stored as T) ?? defaults;
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    const d = (defaults as Record<string, unknown>)[k];
    if (d && typeof d === 'object' && !Array.isArray(d) && v && typeof v === 'object' && !Array.isArray(v)) out[k] = mergeDefaults(d, v);
    else if (v !== undefined && (d === undefined || typeof v === typeof d)) out[k] = v;
  }
  return out as T;
}
