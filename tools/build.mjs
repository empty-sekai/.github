// Generates the profile banner as static SVG, one file per colour theme.
//
//   node tools/build.mjs [--out profile/assets]

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { out: { type: 'string', default: 'profile/assets' } } });

const W = 960;
const H = 360;

// `density` and `tooth` are [gain, floor] pairs for the two noise layers that
// modulate a wash: broad pooling of pigment and fine paper grain.
const themes = {
  light: {
    paper: ['#FAF9F6', '#F1F3F3'],
    mist: ['#FFFFFF', 0.8],
    line: '#6F7D89',
    onWash: '#FBFAF7',
    blue: ['#B4CEDB', '#86AEC5'],
    rose: ['#EED9DD', '#D9B6C0'],
    feather: ['#3F7499', '#86B1CB'],
    blend: 'multiply',
    washOpacity: [0.9, 0.9],
    rim: 0.6,
    density: [1.0, 0.44],
    tooth: [0.7, 0.62],
    grain: '0 0 0 0 0.2  0 0 0 0 0.24  0 0 0 0 0.28  0 0 0 0.075 0',
    edge: 'rgba(31,35,40,0.07)',
  },
  dark: {
    paper: ['#0F141A', '#131A22'],
    mist: ['#7FA3BD', 0.08],
    line: '#97A5B2',
    onWash: '#DCE8F0',
    blue: ['#5F8FB0', '#93C2DE'],
    rose: ['#96707E', '#C9A4B1'],
    feather: ['#B9DBF0', '#7FB2D2'],
    blend: 'screen',
    washOpacity: [0.84, 0.74],
    rim: 0.55,
    density: [0.55, 0.66],
    tooth: [0.45, 0.76],
    grain: '0 0 0 0 0.86  0 0 0 0 0.9  0 0 0 0 0.94  0 0 0 0.06 0',
    edge: 'rgba(240,246,252,0.08)',
  },
};

const n = (v) => String(Math.round(v * 100) / 100);

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A closed, slightly uneven pool of colour around (cx, cy).
function pool(cx, cy, radius, { seed, wobble = 0.1, points = 9, squash = 1, turn = 0 }) {
  const rand = random(seed);
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const r = radius * (1 + (rand() - 0.5) * 2 * wobble);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * squash;
    pts.push([cx + x * Math.cos(turn) - y * Math.sin(turn), cy + x * Math.sin(turn) + y * Math.cos(turn)]);
  }
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < points; i++) {
    const p0 = pts[(i - 1 + points) % points];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % points];
    const p3 = pts[(i + 2) % points];
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} `;
    d += `${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

// Triangle vertices from polar offsets around a centre.
function triangle(cx, cy, size, turn, shape = [1, 0.92, 1.08]) {
  return shape.map((k, i) => {
    const a = ((turn + i * 120 - 90) * Math.PI) / 180;
    return [cx + Math.cos(a) * size * k, cy + Math.sin(a) * size * k];
  });
}
const points = (pts) => pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');

function washFilter(id, seed, [x, y, w, h], t) {
  const alpha = ([gain, floor]) => `0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${gain} 0 0 0 ${floor}`;
  return `
    <filter id="${id}" filterUnits="userSpaceOnUse" x="${x}" y="${y}" width="${w}" height="${h}" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="${seed}" result="warp"/>
      <feDisplacementMap in="SourceGraphic" in2="warp" scale="30" xChannelSelector="R" yChannelSelector="G" result="drift"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.11" numOctaves="2" seed="${seed + 2}" result="fray"/>
      <feDisplacementMap in="drift" in2="fray" scale="4" xChannelSelector="G" yChannelSelector="R" result="shape"/>
      <feGaussianBlur in="shape" stdDeviation="0.35" result="edge"/>
      <feGaussianBlur in="shape" stdDeviation="6" result="spread"/>
      <feComponentTransfer in="spread" result="bleed"><feFuncA type="linear" slope="0.12"/></feComponentTransfer>
      <feMerge result="wet"><feMergeNode in="bleed"/><feMergeNode in="edge"/></feMerge>
      <feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="4" seed="${seed + 5}" result="cloud"/>
      <feColorMatrix in="cloud" type="matrix" values="${alpha(t.density)}" result="density"/>
      <feComposite in="wet" in2="density" operator="in" result="pooled"/>
      <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves="2" seed="${seed + 11}" result="tooth"/>
      <feColorMatrix in="tooth" type="matrix" values="${alpha(t.tooth)}" result="granulation"/>
      <feComposite in="pooled" in2="granulation" operator="in"/>
    </filter>`;
}

function washGradient(id, [soft, deep]) {
  return `
    <radialGradient id="${id}" cx="0.47" cy="0.45" r="0.55">
      <stop offset="0" stop-color="${soft}" stop-opacity="0.34"/>
      <stop offset="0.6" stop-color="${soft}" stop-opacity="0.5"/>
      <stop offset="0.9" stop-color="${deep}" stop-opacity="0.66"/>
      <stop offset="1" stop-color="${deep}" stop-opacity="0.82"/>
    </radialGradient>`;
}

function wash(d, name, filter, [, deep], width, t) {
  return `<g filter="url(#${filter})">
        <path d="${d}" fill="url(#${name})"/>
        <path d="${d}" fill="none" stroke="${deep}" stroke-width="${width}" opacity="${t.rim}"/>
      </g>`;
}

// The feather is drawn tip-up around its shaft, a cubic from tip to base.
const SHAFT = [[4, -44], [5, -20], [1, 6], [-3, 30]];
const VANE = 'M4 -44C10 -36 13 -18 11.5 0C10.5 12 5 24 -2.4 31C-9 25 -12.5 12 -11.5 -4C-10.5 -22 -3 -38 4 -44Z';
const SPLITS = 'M12.6 -6L3.2 3M9.8 14L0.2 20.4M11.8 -24L4.8 -17.6M-11.8 -10L2.8 0M-11.4 13.4L0 20.6M-8.4 -27L4.6 -19';
const DOWN = 'M-2.6 30C-6 31 -8.5 33.5 -10 36.5M-2.8 31C-0.5 33 1.5 35.5 2.5 38.5M-3.4 33C-6 35 -7.6 38 -8 41';

function shaftAt(u) {
  const [p0, p1, p2, p3] = SHAFT;
  const v = 1 - u;
  const at = (i) => v * v * v * p0[i] + 3 * v * v * u * p1[i] + 3 * v * u * u * p2[i] + u * u * u * p3[i];
  const slope = (i) => 3 * v * v * (p1[i] - p0[i]) + 6 * v * u * (p2[i] - p1[i]) + 3 * u * u * (p3[i] - p2[i]);
  const length = Math.hypot(slope(0), slope(1));
  return { x: at(0), y: at(1), tx: slope(0) / length, ty: slope(1) / length };
}

// Fine barbs leaving the shaft on both sides, angled toward the tip.
function barbs() {
  const lean = (40 * Math.PI) / 180;
  let d = '';
  for (let u = 0.05; u < 0.97; u += 0.036) {
    const { x, y, tx, ty } = shaftAt(u);
    for (const side of [1, -1]) {
      const dx = -tx * Math.cos(lean) + side * ty * Math.sin(lean);
      const dy = -ty * Math.cos(lean) - side * tx * Math.sin(lean);
      d += `M${n(x)} ${n(y)}L${n(x + dx * 18)} ${n(y + dy * 18)}`;
    }
  }
  return d;
}

function banner(t) {
  const blue = pool(806, 92, 172, { seed: 21, wobble: 0.05, points: 11, squash: 0.97, turn: 0.3 });
  const rose = pool(636, 232, 64, { seed: 34, wobble: 0.07, points: 9, squash: 0.97, turn: 0.7 });

  const staff = [0, 1, 2, 3, 4].map((i) => `<path d="M0 ${266.5 + i * 9}H${W}"/>`).join('');

  const prism = triangle(884, 284, 22, -14, [1, 0.86, 1.1]);
  const apex = [prism[0][0] + 4.5, prism[0][1] + 27];
  const spokes = prism.map(([x, y]) => `M${n(apex[0])} ${n(apex[1])}L${n(x)} ${n(y)}`).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="empty sekai">
  <defs>
    <clipPath id="sheet"><rect width="${W}" height="${H}" rx="10"/></clipPath>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.paper[0]}"/>
      <stop offset="1" stop-color="${t.paper[1]}"/>
    </linearGradient>
    <radialGradient id="mist">
      <stop offset="0" stop-color="${t.mist[0]}" stop-opacity="${t.mist[1]}"/>
      <stop offset="1" stop-color="${t.mist[0]}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="staff" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${W}" y2="0">
      <stop offset="0.03" stop-color="${t.line}" stop-opacity="0"/>
      <stop offset="0.24" stop-color="${t.line}" stop-opacity="0.4"/>
      <stop offset="0.66" stop-color="${t.line}" stop-opacity="0.34"/>
      <stop offset="0.97" stop-color="${t.line}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="vane" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${t.feather[0]}"/>
      <stop offset="1" stop-color="${t.feather[1]}"/>
    </linearGradient>${washGradient('blue', t.blue)}${washGradient('rose', t.rose)}${washFilter('washA', 4, [580, -60, 400, 400], t)}${washFilter('washB', 17, [530, 130, 220, 210], t)}
    <filter id="grain" filterUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3"/>
      <feColorMatrix type="matrix" values="${t.grain}"/>
    </filter>
    <mask id="vaneShape" maskUnits="userSpaceOnUse" x="-16" y="-48" width="32" height="84">
      <path d="${VANE}" fill="#fff"/>
      <path d="${SPLITS}" stroke="#000" stroke-width="0.7" stroke-linecap="round" fill="none"/>
    </mask>
    <filter id="plume" filterUnits="userSpaceOnUse" x="-18" y="-50" width="36" height="104" color-interpolation-filters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="2" seed="29" result="tooth"/>
      <feColorMatrix in="tooth" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0.6 0 0 0 0.68" result="granulation"/>
      <feComposite in="SourceGraphic" in2="granulation" operator="in"/>
    </filter>
  </defs>
  <g clip-path="url(#sheet)">
    <rect width="${W}" height="${H}" fill="url(#paper)"/>
    <ellipse cx="400" cy="306" rx="560" ry="80" fill="url(#mist)"/>

    <g style="mix-blend-mode:${t.blend}" opacity="${t.washOpacity[0]}">
      ${wash(blue, 'blue', 'washA', t.blue, 2, t)}
    </g>
    <g style="mix-blend-mode:${t.blend}" opacity="${t.washOpacity[1]}">
      ${wash(rose, 'rose', 'washB', t.rose, 1.8, t)}
    </g>

    <g fill="none" stroke="url(#staff)" stroke-width="0.7">${staff}</g>

    <g fill="none" stroke="${t.line}" stroke-width="0.75" stroke-linejoin="round">
      <polygon points="${points(triangle(418, 112, 27, 16))}" opacity="0.5"/>
      <polygon points="${points(triangle(566, 50, 10, 196, [1.2, 0.8, 1]))}" opacity="0.46"/>
      <polygon points="${points(triangle(176, 84, 14, 8, [1.2, 0.78, 1]))}" opacity="0.44"/>
      <polygon points="${points(triangle(298, 204, 4.5, 40, [1, 0.8, 1.1]))}" opacity="0.42"/>
      <polygon points="${points(prism)}" opacity="0.6"/>
      <path d="${spokes}" opacity="0.32"/>
      <polygon points="${points(triangle(856, 122, 20, 12, [1.16, 0.84, 1]))}" stroke="${t.onWash}" opacity="0.85"/>
    </g>
    <g fill="${t.line}">
      <circle cx="352" cy="44" r="0.9" opacity="0.4"/>
      <circle cx="514" cy="150" r="0.8" opacity="0.34"/>
      <circle cx="716" cy="322" r="0.9" opacity="0.3"/>
      <circle cx="262" cy="330" r="0.8" opacity="0.3"/>
      <circle cx="64" cy="150" r="0.8" opacity="0.3"/>
    </g>

    <g transform="translate(108 292) rotate(59) scale(1.18)" filter="url(#plume)">
      <g mask="url(#vaneShape)">
        <path d="${VANE}" fill="url(#vane)" opacity="0.9"/>
        <path d="${barbs()}" fill="none" stroke="${t.paper[0]}" stroke-width="0.32" opacity="0.34"/>
      </g>
      <path d="M${SHAFT[0].join(' ')}C${SHAFT.slice(1).map((p) => p.join(' ')).join(' ')}L-6.5 46" fill="none" stroke="${t.feather[0]}" stroke-width="0.6" stroke-linecap="round" opacity="0.9"/>
      <path d="${DOWN}" fill="none" stroke="${t.feather[1]}" stroke-width="0.5" stroke-linecap="round" opacity="0.8"/>
    </g>

    <rect width="${W}" height="${H}" filter="url(#grain)"/>
    <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="9.5" fill="none" stroke="${t.edge}"/>
  </g>
</svg>
`;
}

mkdirSync(args.out, { recursive: true });
for (const [name, theme] of Object.entries(themes)) {
  writeFileSync(join(args.out, `banner-${name}.svg`), banner(theme));
}
console.log(`wrote ${Object.keys(themes).length} files to ${args.out}`);
