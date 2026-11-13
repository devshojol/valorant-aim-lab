import type { ReactNode } from 'react';
import type { WeaponId } from '../types';

/** Side-profile silhouettes (muzzle to the right), drawn here from simple shapes. */
const SHAPES: Record<WeaponId, ReactNode> = {
  vandal: (
    <>
      <path d="M4 15 26 12v10L11 27l-7-2z" />
      <rect x="26" y="11" width="40" height="10" />
      <rect x="66" y="12" width="22" height="8" />
      <rect x="88" y="14.5" width="22" height="3" />
      <rect x="108" y="13" width="8" height="6" />
      <rect x="99" y="9" width="2.5" height="6" />
      <rect x="36" y="8" width="5" height="3" />
      <path d="M33 21h9l-3 13h-8z" />
      <path d="M50 21h10l7 15-9 2z" />
    </>
  ),
  phantom: (
    <>
      <path d="M4 13h22v10H8l-4-3z" />
      <rect x="26" y="11" width="44" height="10" />
      <rect x="70" y="12.5" width="12" height="7" />
      <rect x="82" y="11.5" width="34" height="9" rx="1.5" />
      <rect x="42" y="5" width="14" height="6" />
      <path d="M33 21h9l-3 13h-8z" />
      <path d="M52 21h9l2 16h-9z" />
    </>
  ),
  spectre: (
    <>
      <rect x="6" y="13" width="26" height="3" />
      <rect x="4" y="10" width="4" height="13" />
      <rect x="30" y="10" width="38" height="11" />
      <rect x="68" y="12" width="8" height="7" />
      <rect x="76" y="11" width="30" height="8" rx="1.5" />
      <rect x="40" y="6" width="6" height="4" />
      <path d="M34 21h9l-3 12h-8z" />
      <rect x="52" y="21" width="7" height="17" />
    </>
  ),
  guardian: (
    <>
      <path d="M4 14 26 12v10L10 26l-6-2z" />
      <rect x="26" y="11" width="42" height="10" />
      <rect x="68" y="12" width="28" height="8" />
      <rect x="96" y="14.5" width="16" height="3" />
      <rect x="110" y="13" width="7" height="6" />
      <rect x="92" y="8" width="2.5" height="5" />
      <rect x="34" y="7.5" width="6" height="3.5" />
      <path d="M33 21h9l-3 13h-8z" />
      <rect x="51" y="21" width="11" height="9" />
    </>
  ),
  operator: (
    <>
      <path d="M2 13h24v11H8l-6-4z" />
      <rect x="26" y="13" width="40" height="10" />
      <rect x="66" y="14" width="18" height="8" />
      <rect x="84" y="16" width="28" height="4" />
      <rect x="110" y="14" width="8" height="8" />
      <rect x="40" y="5" width="34" height="4.5" />
      <rect x="35" y="3.5" width="7" height="7.5" />
      <rect x="72" y="3" width="9" height="8.5" />
      <rect x="46" y="9" width="3" height="4" />
      <rect x="64" y="9" width="3" height="4" />
      <path d="M32 23h9l-3 12h-8z" />
      <rect x="50" y="23" width="11" height="7" />
    </>
  ),
  sheriff: (
    <>
      <rect x="62" y="11" width="36" height="8" />
      <rect x="62" y="19" width="22" height="3" />
      <rect x="44" y="10" width="18" height="13" rx="3" />
      <rect x="34" y="12" width="10" height="9" />
      <path d="M30 9l6 3v4h-6z" />
      <rect x="94" y="8" width="2.5" height="3" />
      <path d="M34 20l14 3-5 15H30z" />
    </>
  ),
  ghost: (
    <>
      <rect x="32" y="10" width="40" height="9" />
      <rect x="72" y="11" width="28" height="7" rx="1.5" />
      <rect x="36" y="19" width="32" height="3" />
      <path d="M34 20h13l-3 16H31z" />
      <path d="M48 22h9v6h-2v-4h-7z" />
      <rect x="66" y="7.5" width="2.5" height="2.5" />
    </>
  ),
  classic: (
    <>
      <rect x="36" y="10" width="46" height="9" />
      <rect x="40" y="19" width="38" height="3" />
      <path d="M38 20h13l-3 16H35z" />
      <path d="M52 22h9v6h-2v-4h-7z" />
      <rect x="77" y="7.5" width="2.5" height="2.5" />
    </>
  ),
};

export function WeaponIcon({ id, className, color = 'currentColor' }: { id: WeaponId; className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 120 40" className={className} fill={color} aria-hidden="true">
      {SHAPES[id]}
    </svg>
  );
}
