/**
 * "How the 4D lock works": small diagrams for the explainer card, drawn from
 * the same 4D projection the key inset uses.
 */

import { MARKED_VERTEX, TESSERACT_EDGES, TESSERACT_VERTICES, apply4, mul4, planeRotation, project4to3 } from '../math/four';
import type { Mat4 } from '../math/four';

const AXIS_COLORS = ['#ff5c5c', '#5cff8c', '#5cb3ff', '#ffcc4d'];

/** A tesseract shadow as SVG markup: 4D → 3D by perspective, 3D → 2D by an oblique view. */
function tesseractSvg(k: Mat4, labels: boolean): string {
  const to2d = (p: [number, number, number]) => [50 + 30 * (p[0] + 0.45 * p[2]), 52 - 30 * (p[1] + 0.3 * p[2])];
  const pts = TESSERACT_VERTICES.map((v) => to2d(project4to3(apply4(k, v))));
  let s = '';
  for (const e of TESSERACT_EDGES) {
    const [x1, y1] = pts[e.a];
    const [x2, y2] = pts[e.b];
    s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${AXIS_COLORS[e.axis]}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>`;
  }
  const [bx, by] = pts[MARKED_VERTEX];
  s += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="3.2" fill="#fff"/>`;
  if (labels) {
    s +=
      `<text x="3" y="98" fill="#8d9cc2" font-size="7">outer cube: near side in w</text>` +
      `<text x="3" y="8" fill="#8d9cc2" font-size="7">inner cube: far side in w</text>`;
  }
  return `<svg viewBox="0 0 100 102">${s}</svg>`;
}

/** A lock dial with its needle off by `deg` and an arrow showing which way to turn. */
function dialSvg(deg: number): string {
  return (
    `<svg viewBox="-50 -50 100 100">` +
    `<circle r="34" fill="#0b1020" stroke="#33426a" stroke-width="3"/>` +
    `<path d="M0,-44 L-7,-33 L7,-33 Z" fill="#dfe7ff"/>` +
    `<g transform="rotate(${-deg})"><line x1="0" y1="6" x2="0" y2="-28" stroke="#ff5c5c" stroke-width="6" stroke-linecap="round"/><circle r="5" fill="#ff5c5c"/></g>` +
    `<path d="M-30,-22 A37,37 0 0 1 -8,-36" fill="none" stroke="#7fe7ff" stroke-width="3" marker-end="url(#arrow)"/>` +
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 Z" fill="#7fe7ff"/></marker></defs>` +
    `</svg>`
  );
}

/** The figure row and extra paragraphs for the explainer card. */
export function lockExplainer(): HTMLElement {
  const wrap = document.createElement('div');
  const fig = document.createElement('div');
  fig.className = 'explainer-figure';
  const cell = (svg: string, caption: string) => {
    const d = document.createElement('div');
    d.innerHTML = svg;
    const c = document.createElement('div');
    c.textContent = caption;
    d.appendChild(c);
    fig.appendChild(d);
  };
  const tilt = planeRotation('yw', 0.35);
  cell(tesseractSvg(tilt, true), 'The key: a tesseract’s shadow. Gold edges run along w, the 4th direction.');
  // The same view of the key, twisted 45° in XW (twist first, then the viewing tilt).
  cell(tesseractSvg(mul4(tilt, planeRotation('xw', Math.PI / 4)), false), 'Twisting XW turns red x into gold w: the inner and outer cubes swap along x.');
  cell(dialSvg(55), 'Each lock dial shows one plane. Turn until the needle points up.');
  wrap.appendChild(fig);
  return wrap;
}
