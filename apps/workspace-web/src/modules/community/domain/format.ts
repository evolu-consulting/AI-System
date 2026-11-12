// Định dạng hiển thị (logic thuần).
import type { PostView } from "@ai/contracts/community";
import { numLocale, t } from "../i18n";

export function timeAgo(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return t("community.time.now");
  if (min < 60) return t("community.time.minutes", { n: min });
  const h = Math.round(min / 60);
  if (h < 24) return t("community.time.hours", { n: h });
  return t("community.time.days", { n: Math.round(h / 24) });
}

export function initials(name: string): string {
  const words = name
    .replace(/^(Công ty|Cơ sở|Hãng|TNHH|CP)\s+/giu, "") // i18n-ignore
    .trim()
    .split(/\s+/);
  const letters =
    words.length === 1
      ? (words[0] ?? "").slice(0, 2)
      : words
          .slice(0, 2)
          .map((w) => w[0] ?? "")
          .join("");
  return letters.toUpperCase();
}

/** Màu avatar ổn định theo id (t2..t7 trong mockup; t1 = chủ quản). */
export function tone(id: string, host: boolean): string {
  if (host) return "t1";
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 6;
  return `t${h + 2}`;
}

/**
 * Số lượng có thể lẫn numeric DB dạng "320.0000 cuộn": số đầu có đúng 4 số lẻ ⇒ đọc là thập phân, in theo locale UI, bỏ số 0 thừa
 * ("320 cuộn", "1.250,5 kg"). Chuỗi người dùng gõ ("1.250 kg", "8 tấn") giữ nguyên.
 */
export function formatQty(raw: string, locale: string = numLocale()): string {
  return raw.replace(/^(d+.d{4})(?=s|$)/, (m) =>
    Number(m).toLocaleString(locale, { maximumFractionDigits: 4 }),
  );
}

const factLabel = (key: string): string =>
  ["product", "qty", "price", "area", "neededBy", "budget"].includes(key)
    ? t(`community.fact.${key}`)
    : key;

/** Dòng "fact" dưới tiêu đề bài, theo thứ tự cố định; bỏ trường rỗng. Cần bán không giá ⇒ "Liên hệ". */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: bảng thứ tự trường theo loại bài
export function factRows(p: Pick<PostView, "type" | "fields">): { k: string; v: string }[] {
  const order =
    p.type === "sell"
      ? ["product", "qty", "price", "area"]
      : ["product", "qty", "budget", "neededBy", "area"];
  const rows: { k: string; v: string }[] = [];
  for (const key of order) {
    if (p.type === "note") break;
    const raw = p.fields[key];
    if (key === "price" && (raw === null || raw === undefined || raw === "")) {
      rows.push({ k: factLabel("price"), v: t("community.fact.contact") });
      continue;
    }
    if (key === "budget" && !raw) {
      rows.push({ k: factLabel("budget"), v: t("community.fact.contact") });
      continue;
    }
    if (raw) {
      const v =
        key === "neededBy"
          ? raw.split("-").reverse().join("/")
          : key === "qty"
            ? formatQty(raw)
            : raw;
      rows.push({ k: factLabel(key), v });
    }
  }
  return rows;
}

export type Deal = {
  hero: { k: string; v: string };
  cells: { k: string; v: string }[];
};

/**
 * Dải "deal" (cần bán / cần mua): ô hero = giá chào (bán) / ngân sách (mua), thiếu ⇒ "Liên hệ";
 * ô phụ = số lượng, khu vực, hạn cần (mua). Hàng hoá chỉ thêm khi bài không có tiêu đề. Ghi chú ⇒ null.
 */
export function dealStrip(p: Pick<PostView, "type" | "fields"> & { title?: string }): Deal | null {
  if (p.type === "note") return null;
  const f = p.fields;
  const heroRaw = p.type === "sell" ? f.price : f.budget;
  const hero = {
    k: p.type === "sell" ? t("community.fact.askPrice") : t("community.fact.budget"),
    v: heroRaw?.trim() ? heroRaw : t("community.fact.contact"),
  };
  const cells: { k: string; v: string }[] = [];
  const add = (k: string, v: string | null | undefined) => {
    if (v?.trim()) cells.push({ k, v });
  };
  if (!p.title) add(t("community.fact.product"), f.product);
  add(
    p.type === "sell" ? t("community.fact.qty") : t("community.fact.need"),
    f.qty ? formatQty(f.qty) : f.qty,
  );
  add(p.type === "sell" ? t("community.fact.area") : t("community.fact.deliverTo"), f.area);
  if (p.type === "buy")
    add(t("community.fact.neededBy"), f.neededBy?.split("-").reverse().join("/"));
  return { hero, cells };
}

/** Nhãn "sắp hết hạn" (≤ 3 ngày: hỏi gia hạn). */
export function expiryNote(expiresAt: string | undefined, now: number = Date.now()): string | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000);
  return days >= 0 && days <= 3 ? t("community.time.expiresIn", { n: days }) : null;
}
