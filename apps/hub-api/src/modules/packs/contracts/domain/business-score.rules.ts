// V2-J1 · BA v2 §5.2 (a-e) · KN-15 · CD-06: điểm kinh doanh 0–100 của sản phẩm + đề xuất. Hàm thuần (không I/O); tính khi đọc.
//   Điểm = Σ(yếu tố × trọng số) ÷ Σ trọng số của yếu tố CÓ dữ liệu (mặc định 40% tốc độ bán · 35% biên lãi · 25% xu hướng).
//   Tốc độ bán — kho: 100 − (ngày tồn − 30) ÷ 1,5 · gói suất có hạn: suất dự kiến bán trước hạn ÷ suất đang giữ · đặt theo khách:
//   bán 3 tháng ÷ mục tiêu. Biên lãi ×400 (25% = 100); Giới thiệu: hoa hồng đã nhận ÷ phát sinh. Xu hướng = 50 + (3 th gần − 3 th
//   trước) ÷ 3 th trước × 50. Đề xuất: đang giữ hàng ⇒ Mua thêm / Giữ / Xả hàng; không giữ ⇒ Đẩy mạnh / Duy trì / Cân nhắc dừng.
import type { BizConfig, BizFactor, BizKind, BizScore, BizSuggestion } from "./business.types";
import type { ProductGroup } from "./products.types";

export const DEFAULT_BIZ: BizConfig = {
  w: { rot: 40, margin: 35, trend: 25 },
  buyDays: 45,
  dumpDays: 150,
  quotaBuy: 120,
  quotaDump: 70,
  hi: 70,
  lo: 45,
  vol: 6,
  soon: 60,
};

/** Một khoảng 3 tháng = 91 ngày (tốc độ bán = SL 3 tháng ÷ 91). */
export const BIZ_WINDOW_DAYS = 91;

/** Cấu hình lưu sai luật ⇒ thông báo (null = hợp lệ). Zod đã kiểm khoảng; đây là quan hệ giữa các ngưỡng. */
export function bizProblem(c: BizConfig): string | null {
  if (c.w.rot + c.w.margin + c.w.trend <= 0) return "Tổng trọng số phải lớn hơn 0";
  if (c.buyDays >= c.dumpDays) return "Ngưỡng Mua thêm (ngày) phải nhỏ hơn ngưỡng Xả hàng";
  if (c.quotaDump >= c.quotaBuy) return "Ngưỡng Xả hàng của gói phải nhỏ hơn ngưỡng Mua thêm";
  if (c.lo >= c.hi) return "Ngưỡng Cân nhắc dừng phải nhỏ hơn ngưỡng Đẩy mạnh";
  return null;
}

/** Cấu hình đã lưu (có thể thiếu khoá ở bản cũ) ⇒ đủ khoá, thiếu thì mặc định. */
export function mergeBiz(stored: unknown): BizConfig {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<BizConfig>;
  return { ...DEFAULT_BIZ, ...s, w: { ...DEFAULT_BIZ.w, ...(s.w ?? {}) } };
}

export type BizInput = {
  group: ProductGroup;
  kind: BizKind;
  /** SL đang giữ (kho / suất); 0 ⇒ không giữ. */
  heldQty: number;
  unit: string | null;
  /** Gói suất: số ngày tới hạn sớm nhất của suất còn lại (≥ 0; hết hạn ⇒ 0); không biết ⇒ null. */
  expiresInDays: number | null;
  sold12: number;
  /** SL bán (Giới thiệu: số HĐ) 3 tháng gần / 3 tháng trước đó. */
  l3: number;
  p3: number;
  /** Chỉ các dòng bán CÓ giá vốn: doanh thu và giá vốn (đồng); doanh thu 0 ⇒ chưa có biên lãi. */
  revenue: number;
  cost: number;
  commissionTotal: number;
  commissionReceived: number;
};

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const fmt = (n: number) => n.toLocaleString("vi-VN");

type Rotation = { f: BizFactor; ds: number; ratio: number };
type RotBase = { key: "rot"; weight: number };

/** Giới thiệu (số HĐ) / đặt theo khách (SL): 3 tháng ÷ mục tiêu. */
function volumeRotation(i: BizInput, c: BizConfig, base: RotBase): Rotation {
  const u = i.unit ?? "";
  const f: BizFactor =
    i.kind === "referral"
      ? {
          ...base,
          label: "Số lượng giới thiệu",
          value: clamp((i.l3 / c.vol) * 100),
          detail: `${i.l3} hợp đồng / mục tiêu ${c.vol} trong 3 tháng`,
        }
      : {
          ...base,
          label: "Số lượng bán",
          value: clamp((i.l3 / c.vol) * 100),
          detail: `${i.l3} ${u} / mục tiêu ${c.vol} trong 3 tháng`.replace("  ", " "),
        };
  return { f, ds: 0, ratio: 0 };
}

/** Gói suất có hạn: suất dự kiến bán trước hạn ÷ suất đang giữ. */
function quotaRotation(i: BizInput, days: number, vel: number, base: RotBase): Rotation {
  const proj = Math.round(vel * days);
  const value = i.heldQty ? clamp((proj / i.heldQty) * 100) : 100;
  return {
    f: {
      ...base,
      label: "Tốc độ bán",
      value,
      detail: vel
        ? `~${Math.round(vel * 30)} suất/tháng · dự kiến bán ${Math.min(proj, i.heldQty)}/${i.heldQty} suất trước khi gói hết hạn`
        : "3 tháng chưa bán",
    },
    ds: 0,
    ratio: i.heldQty ? proj / i.heldQty : 9,
  };
}

function rotation(i: BizInput, c: BizConfig, vel: number): Rotation {
  const u = i.unit ?? "";
  const base = { key: "rot" as const, weight: c.w.rot };
  if (i.kind === "referral" || i.kind === "order") return volumeRotation(i, c, base);
  if (i.kind === "quota" && i.expiresInDays !== null)
    return quotaRotation(i, i.expiresInDays, vel, base);
  const ds = vel ? Math.round(i.heldQty / vel) : Number.POSITIVE_INFINITY;
  return {
    f: {
      ...base,
      label: "Tốc độ bán",
      value: vel ? clamp(100 - (ds - 30) / 1.5) : 0,
      detail: vel
        ? `~${Math.round(vel * 30)} ${u}/tháng · tồn đủ bán ${ds} ngày`.replace("  ", " ")
        : "3 tháng chưa bán",
    },
    ds,
    ratio: 0,
  };
}

function marginFactor(i: BizInput, c: BizConfig): BizFactor {
  const base = { key: "margin" as const, weight: c.w.margin };
  if (i.kind === "referral") {
    const v =
      i.commissionTotal > 0 ? clamp((i.commissionReceived / i.commissionTotal) * 100) : null;
    return {
      ...base,
      label: "Thu được hoa hồng",
      value: v,
      detail: `${fmt(i.commissionReceived)} / ${fmt(i.commissionTotal)}`,
    };
  }
  if (i.revenue <= 0)
    return { ...base, label: "Biên lãi", value: null, detail: "chưa có giá vốn / giá bán" };
  const m = (i.revenue - i.cost) / i.revenue;
  return {
    ...base,
    label: "Biên lãi",
    value: clamp(m * 400),
    detail: `${(m * 100).toFixed(0)}% trên giá bán`,
  };
}

type Pick = { suggestion: BizSuggestion; reason: string };

/** Gói suất có hạn: `pct` = % số suất dự kiến bán trước hạn. */
function quotaPick(c: BizConfig, score: number, pct: number): Pick {
  const p = Math.round(pct);
  if (pct >= c.quotaBuy && score >= c.hi - 5)
    return {
      suggestion: "buy",
      reason: `Dự kiến bán ${p}% số suất trước hạn (≥ ${c.quotaBuy}%) và điểm ≥ ${c.hi - 5}.`,
    };
  if (pct < c.quotaDump)
    return {
      suggestion: "dump",
      reason: `Dự kiến chỉ bán ${p}% số suất trước hạn (< ${c.quotaDump}%).`,
    };
  return {
    suggestion: "hold",
    reason: `Dự kiến bán ${p}% số suất, nằm giữa ${c.quotaDump}% và ${c.quotaBuy}%.`,
  };
}

function heldPick(
  i: BizInput,
  c: BizConfig,
  score: number,
  r: { ds: number; ratio: number; vel: number },
): Pick {
  if (!r.vel)
    return {
      suggestion: "dump",
      reason:
        `Đang giữ ${i.heldQty} ${i.unit ?? ""} nhưng 3 tháng chưa bán được${i.kind === "quota" && i.expiresInDays !== null ? `, gói hết hạn sau ${i.expiresInDays} ngày` : ""}.`.replace(
          "  ",
          " ",
        ),
    };
  if (i.kind === "quota" && i.expiresInDays !== null) return quotaPick(c, score, r.ratio * 100);
  if (r.ds < c.buyDays && score >= c.hi - 5)
    return {
      suggestion: "buy",
      reason: `Tồn chỉ đủ bán ${r.ds} ngày (< ${c.buyDays}) và điểm ≥ ${c.hi - 5}.`,
    };
  if (r.ds > c.dumpDays || score < c.lo - 5)
    return {
      suggestion: "dump",
      reason:
        r.ds > c.dumpDays ? `Tồn đủ bán ${r.ds} ngày (> ${c.dumpDays}).` : `Điểm dưới ${c.lo - 5}.`,
    };
  return {
    suggestion: "hold",
    reason: `Tồn đủ bán ${r.ds} ngày, nằm giữa ${c.buyDays} và ${c.dumpDays}.`,
  };
}

function freePick(c: BizConfig, score: number): Pick {
  if (score >= c.hi) return { suggestion: "push", reason: `Điểm ≥ ${c.hi}.` };
  if (score < c.lo) return { suggestion: "stop", reason: `Điểm < ${c.lo}.` };
  return { suggestion: "keep", reason: `Điểm giữa ${c.lo} và ${c.hi}.` };
}

/** Điểm + đề xuất của một SP. `score` null ⇒ chưa có dữ liệu (chưa bán, không giữ hàng, hoặc mọi yếu tố trống). */
export function scoreBusiness(i: BizInput, c: BizConfig = DEFAULT_BIZ): BizScore {
  const vel = i.l3 / BIZ_WINDOW_DAYS;
  const rot = rotation(i, c, vel);
  const trend: BizFactor = {
    key: "trend",
    label: "Xu hướng",
    weight: c.w.trend,
    value: clamp(50 + ((i.l3 - i.p3) / Math.max(i.p3, 1)) * 50),
    detail: `3 tháng gần: ${i.l3} · 3 tháng trước: ${i.p3}`,
  };
  const factors = [rot.f, marginFactor(i, c), trend];
  const use = factors.filter((f) => f.value !== null && f.weight > 0);
  const wsum = use.reduce((a, f) => a + f.weight, 0);
  const has = i.sold12 > 0 || i.heldQty > 0;
  if (!has || wsum === 0)
    return { score: null, suggestion: null, reason: "Chưa bán lần nào.", factors };
  const score = Math.round(use.reduce((a, f) => a + (f.value as number) * f.weight, 0) / wsum);
  const held = (i.kind === "stock" || i.kind === "quota") && i.heldQty > 0;
  const p = held
    ? heldPick(i, c, score, { ds: rot.ds, ratio: rot.ratio, vel })
    : freePick(c, score);
  return { score, suggestion: p.suggestion, reason: p.reason, factors };
}
