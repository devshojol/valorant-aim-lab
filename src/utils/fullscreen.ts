/**
 * Fullscreen + Keyboard Lock for play sessions.
 *
 * Fullscreen uses up a click's transient user activation, and pointer lock needs that activation.
 * So fullscreen is requested on the click that *launches* a session (Start / Quick practice / …),
 * and pointer lock on the separate "Click to start" click. When fullscreen is re-entered on resume,
 * it is requested only after the pointer is already locked.
 */

/** Keys captured while fullscreen so Ctrl-based crouching can't trigger browser shortcuts (Ctrl+W, Ctrl+D…). */
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyC', 'Space', 'ControlLeft', 'ControlRight', 'Digit1', 'Digit2'];

type KeyboardLock = { lock?: (keys?: string[]) => Promise<void>; unlock?: () => void };

/** Request fullscreen if the current gesture still allows it. Never throws; resolves true on success. */
export function enterGameFullscreen(): Promise<boolean> {
  const root = document.documentElement;
  if (document.fullscreenElement) return Promise.resolve(true);
  if (!root.requestFullscreen) return Promise.resolve(false);
  // Skip when there's no live user activation: the request would only fail with a console error.
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  if (activation && !activation.isActive) return Promise.resolve(false);
  try {
    return Promise.resolve(root.requestFullscreen({ navigationUI: 'hide' }))
      .then(() => {
        const kb = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
        void kb?.lock?.(GAME_KEYS)?.catch(() => undefined);
        return true;
      })
      .catch(() => false); // not allowed here (e.g. embedded frame) — play windowed
  } catch {
    return Promise.resolve(false);
  }
}

export function exitGameFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}
