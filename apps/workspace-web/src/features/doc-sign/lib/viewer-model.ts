// CR-181 · s14 · hàm thuần cho màn «Xem bản đã ký»: chọn bản, nhãn, chấm theo bên, danh sách chữ ký, hình chữ nhật phần.
import type {
  SignFileOut,
  SignPart,
  SignSide,
  SignVersionItemOut,
  SignVersionMarkOut,
} from "@ai/contracts/pack-contracts";
import type { StagePage } from "./geometry";

export type VersionLabel =
  | { key: "contracts.docsign.viewer.original" }
  | { key: "contracts.docsign.viewer.afterSign"; who: string; at: string };

/** Bản mới nhất chưa bị bỏ (Trả lại); không có ⇒ bản mới nhất. */
export function latestVersion(vs: SignVersionItemOut[]): SignVersionItemOut | undefined {
  const live = vs.filter((v) => !v.voided);
  return (live.length ? live : vs).reduce<SignVersionItemOut | undefined>(
    (a, v) => (!a || v.seq > a.seq ? v : a),
    undefined,
  );
}

/** Bản đang xem: `v` trên URL nếu có thật, không thì bản mới nhất. */
export function pickVersion(
  vs: SignVersionItemOut[],
  versionId: string | undefined,
): SignVersionItemOut | undefined {
  return (versionId ? vs.find((v) => v.version_id === versionId) : undefined) ?? latestVersion(vs);
}

export const versionKey = (v: SignVersionItemOut) => v.version_id ?? "original";

export function versionLabel(v: SignVersionItemOut, unknown: string, at: string): VersionLabel {
  if (v.original) return { key: "contracts.docsign.viewer.original" };
  return { key: "contracts.docsign.viewer.afterSign", who: v.signed_by_name ?? unknown, at };
}

/** Đường tải/xem PDF của bản (url máy chủ trả là đường tương đối dưới `/pack/contracts`). */
export const contentPath = (v: SignVersionItemOut) => `/pack/contracts${v.url}`;

export type SignedStatus =
  | { kind: "full" }
  | { kind: "partial"; done: number; total: number }
  | { kind: "none" };

export function fileStatus(f: SignFileOut): SignedStatus {
  const total = f.fields.length;
  const done = f.fields.filter((x) => x.signed).length;
  if (total > 0 && done === total) return { kind: "full" };
  if (done > 0) return { kind: "partial", done, total };
  return { kind: "none" };
}

export type RailDot = SignSide | "mark";

/** Chấm màu theo bên trên từng trang (chữ ký không thuộc ô ⇒ chấm «mark»). */
export function dotsOf(
  v: SignVersionItemOut | undefined,
  sideByField: Record<string, SignSide>,
): Record<number, RailDot[]> {
  const d: Record<number, RailDot[]> = {};
  for (const m of v?.marks ?? []) {
    const side = m.field_id ? sideByField[m.field_id] : undefined;
    for (const pg of m.pages) d[pg] = [...(d[pg] ?? []), side ?? "mark"];
  }
  return d;
}

export const placementKey = (m: SignVersionMarkOut) =>
  `contracts.docsign.viewer.placement.${m.placement}`;

/** Bấm một chữ ký ⇒ trang để cuộn tới (phần đầu) và mọi trang cần viền vàng (giáp lai: tất cả). */
export function jumpTarget(
  parts: SignPart[],
): { page: number; flash: number[]; parts: SignPart[] } | null {
  const first = parts[0];
  return first ? { page: first.page, flash: parts.map((p) => p.page), parts } : null;
}

/** Phần chữ ký → hình chữ nhật px trên sân khấu (chỉ phần nằm trên trang này). */
export function partRect(part: SignPart, page: StagePage) {
  const k = page.width / page.ptWidth;
  return {
    left: page.left + part.cx * k,
    top: page.top + (page.ptHeight - part.cy - part.ch) * k,
    width: part.cw * k,
    height: part.ch * k,
  };
}
