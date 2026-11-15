// The logo figure walking. Every stroke is the original drawing: six clipped copies of figure.png,
// rotated at the joints like a paper cut-out puppet. Masks hide the far limbs where the torso and near limbs cover them.
// Fixed wk- IDs: one instance per page.
const SRC = '/brand/figure.png';
const TORSO = 'M150 145 L200 142 L225 160 L232 180 L218 208 L206 262 L196 312 L191 320 L160 368 L150 368 L128 362 L110 356 L100 350 L103 330 L124 300 L136 242 L148 190 L146 160 Z';
const LEG_L = 'M112 350 L160 352 L148 380 L84 462 L48 478 L30 468 L46 442 L102 374 Z';
const ARM_L = 'M146 186 L124 210 L106 232 L92 256 L84 278 L52 278 L46 264 L82 222 L88 186 L100 172 L124 158 L138 177 Z';
const CLIPS = {
  head: '135,8 270,8 270,134 135,134',
  armL: '20,240 50,196 78,160 112,146 122,150 140,176 140,179 147,182 145,196 122,250 96,294 20,300',
  armR: '214,170 350,205 350,275 228,270 216,214',
  torso: '152,128 238,128 243,176 220,204 208,322 194,321 162,370 150,371 128,365 109,359 96,353 100,330 112,292 129,238 145,196 147,182 139,179 139,176 121,150',
  legL: '108,322 170,330 158,368 92,500 0,500 0,440',
  legR: '152,358 192,316 280,380 280,500 196,500',
};
type Part = keyof typeof CLIPS;

const Img = ({ part }: { part: Part }) => <image href={SRC} width="360" height="512" clipPath={`url(#wk-c-${part})`} />;
const Mask = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <mask id={id} maskUnits="userSpaceOnUse" x="-100" y="-100" width="560" height="712">
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
            <polygon points={CLIPS[p]} />
          </clipPath>
        ))}
      </defs>
      <g className="body">
        <defs>
          <Mask id="wk-m-behind">
            <path d={TORSO} />
          </Mask>
          <Mask id="wk-m-legR">
            <path d={TORSO} />
            <g className="legL"><path d={LEG_L} /></g>
          </Mask>
          <Mask id="wk-m-torso">
            <g className="armL"><path d={ARM_L} /></g>
          </Mask>
        </defs>
        <g mask="url(#wk-m-behind)"><g className="armR"><Img part="armR" /></g></g>
        <g mask="url(#wk-m-legR)"><g className="legR"><Img part="legR" /></g></g>
        <g mask="url(#wk-m-behind)"><g className="legL"><Img part="legL" /></g></g>
        <g mask="url(#wk-m-torso)"><g className="torso"><Img part="torso" /></g></g>
        <g className="armL"><Img part="armL" /></g>
        <g className="head"><Img part="head" /></g>
      </g>
    </svg>
  );
}
