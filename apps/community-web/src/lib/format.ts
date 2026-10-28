// Định dạng hiển thị (logic thuần).
import type { PostView } from "@ai/contracts/community";

export function timeAgo(iso: string, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return "Vừa xong";
  if (min < 60) return `${min} phút`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} giờ`;
  return `${Math.round(h / 24)} ngày`;
}

export function initials(name: string): string {
  const words = name
    .replace(/^(Công ty|Cơ sở|Hãng|TNHH|CP)\s+/giu, "")
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

const FACT_LABEL: Record<string, string> = {
  product: "Hàng hoá",
  qty: "Số lượng",
  price: "Giá",
  area: "Khu vực",
  neededBy: "Cần trước",
  budget: "Ngân sách",
};

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
      rows.push({ k: FACT_LABEL.price ?? key, v: "Liên hệ" });
      continue;
    }
    if (key === "budget" && !raw) {
      rows.push({ k: FACT_LABEL.budget ?? key, v: "Liên hệ" });
      continue;
    }
    if (raw) {
      const v = key === "neededBy" ? raw.split("-").reverse().join("/") : raw;
      rows.push({ k: FACT_LABEL[key] ?? key, v });
    }
  }
  return rows;
}

/** Nhãn "sắp hết hạn" (≤ 3 ngày: hỏi gia hạn). */
export function expiryNote(expiresAt: string | undefined, now: number = Date.now()): string | null {
  if (!expiresAt) return null;
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000);
  return days >= 0 && days <= 3 ? `Hết hạn sau ${days} ngày` : null;
}
