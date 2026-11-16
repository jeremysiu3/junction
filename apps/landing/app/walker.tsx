// The logo figure walking. Every stroke is the original drawing: six clipped copies of figure.png,
// rotated at the joints like a paper cut-out puppet. Masks hide the far limbs where the torso and near limbs cover them.
// Each limb pivots on the outline itself, at the point where its edge leaves the body, so that line stays joined.
// The near arm and leg are cut along a ray from the pivot into the armpit/crotch and blend over a wedge past it:
// the limb fades in over FADE degrees with the torso underneath, then the torso fades out over OVER more.
// At rest the overlapping copies are the same pixels, so the logo pose is exact. Fixed wk- IDs: one instance per page.
const SRC = '/brand/figure.png';
const TORSO = 'M150 145 L200 142 L221 160 L226 180 L214 208 L204 262 L196 312 L188 322 L157 368 L150 368 L128 362 L110 356 L100 350 L103 330 L124 300 L136 242 L148 190 L146 160 Z';
const LEG_L = 'M108 347 L157 368 L148 380 L84 462 L48 478 L30 468 L46 442 L102 374 Z';
const ARM_L = 'M146 186 L124 210 L106 232 L92 256 L84 278 L52 278 L46 264 L82 222 L88 186 L100 172 L101 166 L147 183 Z';

// Pivot p on the outline, cut ray from p toward q (the armpit or crotch), wedge radius r. Matches the CSS transform-origins.
const joint = (p: [number, number], q: [number, number], r: number) => ({ p, a0: Math.atan2(q[1] - p[1], q[0] - p[0]), r });
const SH = joint([101, 165], [148, 182], 52);
const HIP = joint([103, 345], [157, 368], 62);
const FADE = 15;
const OVER = 10;
// The wedge from a to b degrees past the cut ray, toward the limb.
const wedge = ({ p, a0, r }: ReturnType<typeof joint>, a: number, b: number) =>
  [a, (a + b) / 2, b].reduce((s, d) => `${s} ${(p[0] + r * Math.cos(a0 + (d * Math.PI) / 180)).toFixed(1)},${(p[1] + r * Math.sin(a0 + (d * Math.PI) / 180)).toFixed(1)}`, `${p}`);
// Stepped fades (SVG has no conic gradient): n wedges between a and b, black at opacity op(k).
const steps = (j: ReturnType<typeof joint>, a: number, b: number, n: number, op: (k: number) => number) =>
  Array.from({ length: n }, (_, k) => <polygon key={k} points={wedge(j, a + ((b - a) * k) / n, a + ((b - a) * (k + 1)) / n)} fillOpacity={op(k)} />);
const limbIn = (j: ReturnType<typeof joint>) => steps(j, 0, FADE, 5, (k) => 1 - (k + 0.5) / 5);
const torsoOut = (j: ReturnType<typeof joint>) => steps(j, FADE, FADE + OVER, 4, (k) => (k + 0.5) / 4);
// Hides the torso behind a swung limb, except over the limb's own blend wedge.
const behindLimb = (j: ReturnType<typeof joint>, silhouette: string) => (
  <>
    <path d={silhouette} />
    <polygon points={wedge(j, -5, FADE + OVER)} fill="#fff" />
  </>
);

const CLIPS = {
  head: ['135,8 270,8 270,134 135,134'],
  armL: ['20,300 20,240 50,170 70,155 101,165 148,182 145,196 122,250 96,294'],
  armR: ['232,169 240,160 350,205 350,275 228,270 206,262 218,208 232,180'],
  torso: [
    '152,128 238,128 240,160 232,169 232,180 218,208 206,262 208,322 188,322 157,368 103,345 80,335 96,320 112,292 129,238 145,196 148,182 101,165 95,163 110,145 130,135',
    wedge(SH, -2, FADE + OVER),
    wedge(HIP, -2, FADE + OVER),
  ],
  legL: ['103,345 157,368 92,500 0,500 0,440 80,335'],
  legR: ['157,368 188,322 230,322 280,380 280,500 196,500'],
};
type Part = keyof typeof CLIPS;

const Img = ({ part, mask }: { part: Part; mask?: string }) => (
  <image href={SRC} width="360" height="512" clipPath={`url(#wk-c-${part})`} mask={mask && `url(#wk-m-${mask})`} />
);
const Mask = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <mask id={`wk-m-${id}`} maskUnits="userSpaceOnUse" x="-100" y="-100" width="560" height="712">
    <rect x="-100" y="-100" width="560" height="712" fill="#fff" />
    {children}
  </mask>
);

export function Walker({ className }: { className?: string }) {
  return (
    <svg className={`walker${className ? ` ${className}` : ''}`} viewBox="0 0 360 512" aria-hidden="true">
      <defs>
        {(Object.keys(CLIPS) as Part[]).map((p) => (
          <clipPath key={p} id={`wk-c-${p}`}>
            {CLIPS[p].map((pts) => <polygon key={pts} points={pts} />)}
          </clipPath>
        ))}
        {/* Applied inside the rotating groups, so these fades turn with their limb. */}
        <Mask id="legIn">{limbIn(HIP)}</Mask>
        <Mask id="armIn">{limbIn(SH)}</Mask>
      </defs>
      <g className="body">
        <defs>
          <Mask id="behind">
            <path d={TORSO} />
          </Mask>
          <Mask id="legR">
            <path d={TORSO} />
            <g className="legL"><path d={LEG_L} /></g>
          </Mask>
          <Mask id="torso">
            <g className="armL">{behindLimb(SH, ARM_L)}</g>
            <g className="legL">{behindLimb(HIP, LEG_L)}</g>
            {torsoOut(SH)}
            {torsoOut(HIP)}
          </Mask>
        </defs>
        <g mask="url(#wk-m-behind)"><g className="armR"><Img part="armR" /></g></g>
        <g mask="url(#wk-m-legR)"><g className="legR"><Img part="legR" /></g></g>
        <g mask="url(#wk-m-torso)"><g className="torso"><Img part="torso" /></g></g>
        <g className="legL"><Img part="legL" mask="legIn" /></g>
        <g className="armL"><Img part="armL" mask="armIn" /></g>
        <g className="head"><Img part="head" /></g>
      </g>
    </svg>
  );
}
