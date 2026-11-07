// CR-123 · FLOW3-FR-13 (ux-audit #10): node "Nếu" đọc thành MỘT câu cho giám đốc/sale:
// "Nếu Giá trị hợp đồng lớn hơn 100 triệu → đi tới Bước 3 · Giám đốc duyệt, ngược lại → đi tới Bước tiếp theo".
// Thuần (nhận nhãn đã dịch), không React.
export type SentenceCond = {
  from: string;
  op: string;
  value: string;
  type: string;
  /** Dữ kiện Có/Không: đọc "Đối tác mới là Có", không phải "bằng true". */
  bool?: boolean;
};

export type SentenceWords = {
  /** "Nếu" */
  if: string;
  /** "và" */
  and: string;
  /** "hoặc" */
  or: string;
  /** "đi tới" */
  goTo: string;
  /** "ngược lại" */
  otherwise: string;
  /** "Bước tiếp theo" (khi nhánh Sai bỏ trống) */
  nextStep: string;
  /** Chưa chọn */
  blank: string;
  /** "triệu" · "tỷ" */
  million: string;
  billion: string;
  /** phép so sánh → chữ ("lớn hơn") */
  ops: Readonly<Record<string, string>>;
  /** Có/Không: "là" · "không là" · "Có" · "Không" (vắng ⇒ dùng `ops`). */
  bool?: { is: string; isNot: string; yes: string; no: string };
};

/** 100000000 → "100 triệu", 2500000000 → "2,5 tỷ"; số lẻ/nhỏ giữ nguyên chữ số. */
export function friendlyNumber(raw: string, w: Pick<SentenceWords, "million" | "billion">): string {
  const s = raw.trim();
  if (!/^-?\d+$/.test(s)) return s;
  const n = Number(s);
  const trim = (x: number) => String(Number(x.toFixed(2))).replace(".", ",");
  if (Math.abs(n) >= 1_000_000_000) return `${trim(n / 1_000_000_000)} ${w.billion}`;
  if (Math.abs(n) >= 1_000_000 && n % 100_000 === 0) return `${trim(n / 1_000_000)} ${w.million}`;
  return s;
}

/** Một điều kiện: "Giá trị hợp đồng lớn hơn 100 triệu"; chưa chọn nguồn ⇒ null (câu chưa đủ). */
export function condText(c: SentenceCond, w: SentenceWords, from: string): string | null {
  if (c.from === "") return null;
  if (c.bool && w.bool)
    return `${from} ${c.op === "ne" ? w.bool.isNot : w.bool.is} ${c.value.trim() === "false" ? w.bool.no : w.bool.yes}`;
  const value = c.type === "number" ? friendlyNumber(c.value, w) : c.value.trim();
  return `${from} ${w.ops[c.op] ?? c.op} ${value === "" ? w.blank : value}`;
}

/**
 * Câu hoàn chỉnh. `fromLabel` = nhãn nguồn của điều kiện; `yes`/`no` = nhãn bước đích đã dựng ("Bước 3 · Giám đốc duyệt"),
 * null = chưa chọn (Sai bỏ trống = Bước tiếp theo). Chưa có điều kiện hợp lệ nào ⇒ null.
 */
export function ifSentence(a: {
  join: "and" | "or";
  conds: readonly SentenceCond[];
  fromLabel: (c: SentenceCond) => string;
  yes: string | null;
  no: string | null;
  words: SentenceWords;
}): string | null {
  const w = a.words;
  const parts = a.conds.flatMap((c) => {
    const t = condText(c, w, a.fromLabel(c));
    return t ? [t] : [];
  });
  if (parts.length === 0) return null;
  const glue = ` ${a.join === "or" ? w.or : w.and} `;
  return `${w.if} ${parts.join(glue)} → ${w.goTo} ${a.yes ?? w.blank}, ${w.otherwise} → ${w.goTo} ${a.no ?? w.nextStep}`;
}
