/**
 * Keyboard + mouse input with Pointer Lock.
 *
 * Mouse deltas are accumulated from raw `movementX/Y` events and consumed once per frame,
 * so look speed is independent of frame rate (no smoothing, no acceleration).
 */

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'walk'
  | 'crouch'
  | 'jump'
  | 'reload'
  | 'primary'
  | 'secondary'
  | 'fire'
  | 'alt';

const KEYMAP: Record<string, Action> = {
  KeyW: 'forward',
  KeyS: 'back',
  KeyA: 'left',
  KeyD: 'right',
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ShiftLeft: 'walk',
  ShiftRight: 'walk',
  ControlLeft: 'crouch',
  ControlRight: 'crouch',
  KeyC: 'crouch',
  Space: 'jump',
  KeyR: 'reload',
  Digit1: 'primary',
  Digit2: 'secondary',
};

export class Input {
  private held = new Set<Action>();
  private pressed = new Set<Action>();
  private mouseDX = 0;
  private mouseDY = 0;
  private lastAbsDX = 0;
  locked = false;
  /** When pointer lock is unavailable (e.g. sandboxed iframe), look with plain mouse movement. */
  unlockedLook = false;
  enabled = false;
  rawRequested = true;
  onLockChange: ((locked: boolean) => void) | null = null;
  onLockError: ((err: unknown) => void) | null = null;
  onEscape: (() => void) | null = null;
  /** performance.now() of the last pointer-lock release (browsers refuse re-lock for ~1 s). */
  lastUnlock = -1e9;
  /** Timestamps of mouse events for input-latency diagnostics. */
  mouseEvents = 0;

  private readonly listeners: [EventTarget, string, EventListener, AddEventListenerOptions?][] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.on(document, 'keydown', (e) => this.onKey(e as KeyboardEvent, true));
    this.on(document, 'keyup', (e) => this.onKey(e as KeyboardEvent, false));
    this.on(document, 'mousemove', (e) => this.onMouseMove(e as MouseEvent));
    this.on(document, 'mousedown', (e) => this.onMouseButton(e as MouseEvent, true));
    this.on(document, 'mouseup', (e) => this.onMouseButton(e as MouseEvent, false));
    this.on(document, 'contextmenu', (e) => {
      if (this.enabled) e.preventDefault();
    });
    this.on(document, 'pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (this.locked && !locked) this.lastUnlock = performance.now();
      this.locked = locked;
      if (!locked) this.releaseAll();
      this.onLockChange?.(locked);
    });
    this.on(document, 'pointerlockerror', (e) => this.onLockError?.(e));
    this.on(window, 'blur', () => this.releaseAll());
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.listeners.push([target, type, fn, opts]);
  }

  /** Must be called from a user gesture. Resolves true when the pointer is captured. */
  async requestLock(): Promise<boolean> {
    if (!this.canvas.requestPointerLock) return false;
    try {
      const opts = this.rawRequested ? ({ unadjustedMovement: true } as PointerLockOptions) : undefined;
      // Some browsers return a promise, some return undefined.
      const r = (this.canvas.requestPointerLock as (o?: PointerLockOptions) => Promise<void> | void)(opts);
      if (r && typeof (r as Promise<void>).then === 'function') await r;
      return true;
    } catch (err) {
      // unadjustedMovement unsupported → retry without it.
      if (this.rawRequested) {
        try {
          const r = (this.canvas.requestPointerLock as () => Promise<void> | void)();
          if (r && typeof (r as Promise<void>).then === 'function') await r;
          return true;
        } catch (err2) {
          this.onLockError?.(err2);
          return false;
        }
      }
      this.onLockError?.(err);
      return false;
    }
  }

  exitLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.enabled) return;
    if (e.code === 'Escape' && down) {
      if (this.unlockedLook) this.onEscape?.();
      return;
    }
    const a = KEYMAP[e.code];
    if (!a) return;
    e.preventDefault();
    if (down) {
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
    } else {
      this.held.delete(a);
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (!this.enabled || (!this.locked && !this.unlockedLook)) return;
    let dx = e.movementX;
    let dy = e.movementY;
    // Guard against the occasional pointer-lock spike seen with accelerated (non-raw) input.
    if (!this.rawRequested && Math.abs(dx) > 400 && this.lastAbsDX < 60) {
      dx = 0;
      dy = 0;
    }
    this.lastAbsDX = Math.abs(dx);
    this.mouseDX += dx;
    this.mouseDY += dy;
    this.mouseEvents++;
  }

  private onMouseButton(e: MouseEvent, down: boolean) {
    if (!this.enabled || (!this.locked && !this.unlockedLook)) return;
    const a: Action | null = e.button === 0 ? 'fire' : e.button === 2 ? 'alt' : null;
    if (!a) return;
    if (down) {
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
    } else this.held.delete(a);
  }

  isDown(a: Action) {
    return this.held.has(a);
  }

  /** True once per key press. */
  consume(a: Action) {
    const v = this.pressed.has(a);
    this.pressed.delete(a);
    return v;
  }

  takeMouse(): [number, number] {
    const r: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return r;
  }

  releaseAll() {
    this.held.clear();
    this.pressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }

  /** Test/automation hooks. */
  inject(a: Action, down: boolean) {
    if (down) {
      if (!this.held.has(a)) this.pressed.add(a);
      this.held.add(a);
    } else this.held.delete(a);
  }
  injectMouse(dx: number, dy: number) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  dispose() {
    for (const [t, type, fn, opts] of this.listeners) t.removeEventListener(type, fn, opts);
    this.listeners.length = 0;
    this.exitLock();
  }
}
