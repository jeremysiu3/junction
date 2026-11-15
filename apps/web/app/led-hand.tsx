import { useId } from 'react';

// The LED hand of a "don't walk" signal: dot-matrix mask, orange gradient, visor lattice.
export function LedHand({ size }: { size: number }) {
  const id = useId().replace(/:/g, '');
  const cl = `cl${id}`, gr = `gr${id}`, dp = `dp${id}`, mk = `mk${id}`, ll = `ll${id}`, ld = `ld${id}`;
  return (
    <svg viewBox="-20 -10 340 490" width={size} aria-hidden="true" style={{ display: 'block', filter: 'drop-shadow(0 0 4px rgba(255,150,50,.75)) drop-shadow(0 0 18px rgba(243,130,30,.35))' }}>
      <defs>
        <clipPath id={cl}>
          <rect x="8" y="80" width="37" height="170" rx="18.5" />
          <rect x="55" y="35" width="36" height="215" rx="18" />
          <rect x="101" y="10" width="38" height="240" rx="19" />
          <rect x="149" y="35" width="38" height="215" rx="19" />
          <path d="M8 200h187v100c0 28-10 48-30 58v102H35V358C18 348 8 328 8 300z" />
          <rect x="-28" y="0" width="56" height="128" rx="28" transform="translate(172 318) rotate(-136)" />
        </clipPath>
        <radialGradient id={gr} cx="45%" cy="55%" r="65%">
          <stop offset="0" stopColor="#ffe2b0" />
          <stop offset=".55" stopColor="#ffa63d" />
          <stop offset="1" stopColor="#d9620f" />
        </radialGradient>
        <pattern id={dp} width="9" height="9" patternUnits="userSpaceOnUse">
          <circle cx="4.5" cy="4.5" r="3.6" fill="#fff" />
        </pattern>
        <mask id={mk}>
          <rect x="-20" y="-10" width="340" height="490" fill={`url(#${dp})`} />
        </mask>
        <pattern id={ll} width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H34M0 0V34" stroke="rgba(255,255,255,.09)" strokeWidth="3" fill="none" />
        </pattern>
        <pattern id={ld} width="34" height="34" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M0 0H34M0 0V34" stroke="rgba(20,8,0,.75)" strokeWidth="7" fill="none" />
        </pattern>
      </defs>
      <rect width="300" height="470" fill={`url(#${ll})`} />
      <g mask={`url(#${mk})`}>
        <rect x="-20" y="-10" width="340" height="490" fill={`url(#${gr})`} clipPath={`url(#${cl})`} />
      </g>
      <rect width="300" height="470" fill={`url(#${ld})`} clipPath={`url(#${cl})`} />
    </svg>
  );
}
