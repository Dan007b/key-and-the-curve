/**
 * The "why does a lap change my colour?" picture, for the holonomy card and
 * the help screen. Two laps, counter-clockwise, carrying a needle you never
 * turn (parallel transport):
 *
 * - flat square: four 90° corners, so you turn 4 × 90° = 360° and the needle
 *   comes back exactly as it was;
 * - this space: the four rooms round a pillar make a square with 72° corners,
 *   so each corner is a 108° turn and you turn 4 × 108° = 432° = 360° + 72°.
 *   You end up facing the way you started, but the needle (never turned) is
 *   now 72° clockwise of where it was: one colour down.
 *
 * Plain SVG, drawn once.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** An arrow (a needle) at (x, y), pointing `deg` degrees clockwise from up. */
function needle(x: number, y: number, deg: number, colour: string): string {
  return `<g transform="translate(${x} ${y}) rotate(${deg})"><line x1="0" y1="12" x2="0" y2="-14" stroke="${colour}" stroke-width="3" stroke-linecap="round"/><path d="M0,-20 L-6,-10 L6,-10 Z" fill="${colour}"/></g>`;
}

/** One panel: a square path (sides bowed inwards by `bow`, 0 = straight), its corner turns, and the needle before and after. */
function panel(x0: number, title: string, turn: string, bow: number, endDeg: number, caption: string[]): string {
  const c = [
    [x0 + 40, 150],
    [x0 + 160, 150],
    [x0 + 160, 30],
    [x0 + 40, 30],
  ];
  const mid = [x0 + 100, 90];
  let d = `M${c[0][0]},${c[0][1]}`;
  for (let i = 0; i < 4; i++) {
    const a = c[i];
    const b = c[(i + 1) % 4];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    // Control point pulled towards the centre: a geodesic-looking side.
    const q = [m[0] + (mid[0] - m[0]) * bow, m[1] + (mid[1] - m[1]) * bow];
    d += ` Q${q[0]},${q[1]} ${b[0]},${b[1]}`;
  }
  let s = `<text x="${x0 + 100}" y="16" class="ex-title">${title}</text>`;
  s += `<path d="${d}" class="ex-path"/>`;
  // Direction of travel: counter-clockwise (right along the bottom, up the right side...).
  s += `<path d="M${x0 + 96},${150 - 30 * bow} l8,0 m-4,-4 l4,4 l-4,4" class="ex-arrow"/>`;
  for (const [x, y] of c) s += `<text x="${x + (x < mid[0] ? -6 : 6)}" y="${y + (y > mid[1] ? 16 : -6)}" class="ex-turn" text-anchor="${x < mid[0] ? 'end' : 'start'}">${turn}</text>`;
  // The needle at the start (white) and, back at the start after the lap, where it points now (gold).
  s += needle(c[0][0] + 22, c[0][1] - 26, 0, '#ffffff');
  if (Math.abs(endDeg) > 0.5) {
    s += needle(c[0][0] + 22, c[0][1] - 26, endDeg, '#ffcc4d');
    s += `<path d="M${c[0][0] + 22},${c[0][1] - 50} A24,24 0 0 1 ${c[0][0] + 22 + 24 * Math.sin((endDeg * Math.PI) / 180)},${c[0][1] - 26 - 24 * Math.cos((endDeg * Math.PI) / 180)}" class="ex-angle"/>`;
  }
  caption.forEach((line, i) => (s += `<text x="${x0 + 100}" y="${178 + i * 15}" class="ex-caption">${line}</text>`));
  return s;
}

/** The two-panel figure, as an element ready to put in a card. */
export function holonomyFigure(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'explain-figure';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 420 215');
  svg.innerHTML =
    panel(0, 'Flat space', '90°', 0, 0, ['turns: 4 × 90° = 360°', 'needle: unchanged']) +
    panel(220, 'This maze (curved)', '108°', 0.28, 72, ['turns: 4 × 108° = 432° = 360° + 72°', 'needle: 72° off = one colour']);
  wrap.appendChild(svg);
  return wrap;
}
