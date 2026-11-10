// Sơ đồ luồng dạng làn bơi (SVG nội tuyến): mỗi vai một làn, mỗi bước một ô, trái → phải, có mũi tên.
import { esc } from "./html";
import type { Prototype } from "./schema";

const LW = 112;
const CW = 172;
const LH = 78;
const NW = 150;
const NH = 48;

/** Cắt chữ thành tối đa 2 dòng ~20 ký tự. */
export function wrap2(s: string, w = 20): string[] {
  const out: string[] = [""];
  for (const word of s.split(/\s+/)) {
    const last = out[out.length - 1] ?? "";
    if (!last || `${last} ${word}`.length <= w)
      out[out.length - 1] = last ? `${last} ${word}` : word;
    else if (out.length < 2) out.push(word);
    else {
      out[1] = `${out[1]} ${word}`;
    }
  }
  return out.map((l) => (l.length > w + 3 ? `${l.slice(0, w)}…` : l));
}

export function flowSvg(p: Prototype): string {
  if (!p.flow.length) return "";
  const used = p.roles.filter((r) => p.flow.some((f) => f.by === r.key));
  const lane = (key: string) => used.findIndex((r) => r.key === key);
  const title = new Map(p.screens.map((s) => [s.id, s.title]));
  const W = LW + CW * p.flow.length;
  const H = LH * used.length;
  const pos = p.flow.map((_, i) => ({
    x: LW + i * CW + (CW - NW) / 2,
    cy: lane(p.flow[i]?.by ?? "") * LH + LH / 2,
  }));
  const lanes = used
    .map(
      (r, i) =>
        `<rect class="lane" x="0" y="${i * LH + 2}" width="${W}" height="${LH - 4}" rx="6"/><text class="lane-label" x="10" y="${i * LH + LH / 2 + 4}">${esc(r.label)}</text>`,
    )
    .join("");
  const arrows = pos
    .slice(1)
    .map((b, i) => {
      const a = pos[i];
      if (!a) return "";
      const x1 = a.x + NW;
      const xm = (x1 + b.x) / 2;
      return `<path class="arrow" marker-end="url(#ah)" d="M${x1} ${a.cy}H${xm}V${b.cy}H${b.x}"/>`;
    })
    .join("");
  const nodes = p.flow
    .map((f, i) => {
      const q = pos[i];
      if (!q) return "";
      const lines = wrap2(f.action)
        .map(
          (l, k, all) =>
            `<text x="${q.x + NW / 2}" y="${q.cy + 4 + (k - (all.length - 1) / 2) * 14}" text-anchor="middle">${esc(l)}</text>`,
        )
        .join("");
      return `<g class="node" data-step="${i}" role="button" tabindex="0"><title>${esc(f.action)}: «${esc(title.get(f.from) ?? f.from)}» → «${esc(title.get(f.to) ?? f.to)}»</title><rect x="${q.x}" y="${q.cy - NH / 2}" width="${NW}" height="${NH}" rx="8"/>${lines}</g>`;
    })
    .join("");
  return `<div class="flowwrap"><svg viewBox="0 0 ${W} ${H}" width="${W}" role="img" aria-label="Sơ đồ luồng theo vai"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path class="ah" d="M0 0L8 4L0 8z"/></marker></defs>${lanes}${arrows}${nodes}</svg></div>`;
}
