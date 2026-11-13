/**
 * Sidearm hold shared by both arm styles (AnimatedArms and FirstPersonArms via ViewModel).
 *
 * The arm poses were authored on a rifle's long grip, where the palm sits well below the grip point.
 * A pistol grip is short, so the hold is raised (metres, gun space) or the hands end up under the gun.
 * Kept in its own file so ViewModel doesn't pull the animated-arms code into builds that don't use it.
 */
export const PISTOL_HOLD_UP = 0.05;
export const PISTOL_HOLD_FWD = 0;
