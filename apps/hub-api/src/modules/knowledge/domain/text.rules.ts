// N4-FR-03 · ADR-0021: xử lý chữ tiếng Việt cho tìm kiếm (c) — thuần, không I/O. `foldVi` khớp `knowledge.fold` (SQL: unaccent +
// lower) để lọc từ dừng phía ứng dụng; tách từ thật do Postgres làm (`phraseto_tsquery('knowledge.vi', fold(term))`) nên chỉ cần
// tách theo khoảng trắng/dấu câu mà KHÔNG cắt mã có `/`, `-`, `.` (vd `01/2026/HĐMB-PN`, `149.202.83.5:9443`).

/** Bỏ dấu tiếng Việt + chữ thường (đ/Đ → d). */
export function foldVi(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

/**
 * Từ dừng (đã bỏ dấu) cho CÂU HỎI: từ hỏi + hư từ hay gặp. Chỉ bỏ ở unigram; bigram chứa từ dừng cũng bỏ (cụm "bao nhieu"
 * vô nghĩa khi tìm). Không bỏ từ nội dung như "hop dong", "thanh toan" — IDF tự hạ trọng số từ phổ biến của kho.
 */
export const VI_STOPWORDS: ReadonlySet<string> = new Set(
  (
    "la cua co khong va cac nhung duoc cho voi trong khi thi nay do ay nao gi bao nhieu sao the nhu ra vao tu den " +
    "mot hai ba hay hoac neu boi vi ma de len xuong tai theo ve o bi da dang se roi con cung chi moi " +
    "ai dau lau hien hanh nhat hon nhieu it ca tat quy dinh ke ten " +
    "toi chung minh ban em anh chi ong ba ho no gom bang"
  ).split(/\s+/),
);

/** Tách câu thành token (đã fold): giữ mã có `/ . - : _ ,` bên trong, bỏ dấu câu bao quanh. */
export function tokenize(q: string): string[] {
  return foldVi(q)
    .split(/[\s?!;()"“”'‘’[\]{}<>|*#`]+/u)
    .map((t) => t.replace(/^[.,:\-–—/_]+|[.,:\-–—/_%]+$/gu, ""))
    .filter((t) => t.length > 0);
}

export type QueryTerm = { term: string; w: number };

export type QueryOpts = {
  /** Thêm cụm 2 từ liền nhau (từ ghép: "thanh toan"). Mặc định TẮT: eval 0.11 đo R@5 0,901 (bật, w 1,5) < 0,944 (tắt). */
  bigrams?: boolean;
  /** Trọng số cụm so với từ đơn. */
  bigramWeight?: number;
  /** Trần số term gửi xuống SQL (câu SQL cố định, tham số jsonb). */
  maxTerms?: number;
};

const isStop = (t: string): boolean => VI_STOPWORDS.has(t);
/** Token "có nghĩa" làm unigram: không phải từ dừng, không phải 1 ký tự chữ đơn lẻ (trừ chữ số). */
const keep = (t: string): boolean => !isStop(t) && (t.length > 1 || /\d/.test(t));

/** Câu hỏi → danh sách term (unigram + bigram), không trùng, theo thứ tự xuất hiện. */
export function queryTerms(q: string, o: QueryOpts = {}): QueryTerm[] {
  const toks = tokenize(q);
  const out = new Map<string, number>();
  for (const t of toks) if (keep(t) && !out.has(t)) out.set(t, 1);
  if (o.bigrams ?? false) addBigrams(toks, out, o.bigramWeight ?? 1.5);
  return [...out.entries()].slice(0, o.maxTerms ?? 40).map(([term, w]) => ({ term, w }));
}

function addBigrams(toks: readonly string[], out: Map<string, number>, w: number): void {
  for (let i = 0; i + 1 < toks.length; i++) {
    const a = toks[i] as string;
    const b = toks[i + 1] as string;
    const bg = `${a} ${b}`;
    if (!isStop(a) && !isStop(b) && !out.has(bg)) out.set(bg, w);
  }
}

/** Phần mã có `/` (vd `01/2026/hdmb-pn` → `hdmb-pn`, `hdmb pn`) để câu hỏi gõ thiếu tiền tố vẫn khớp (cột `context`). */
export function codeAliases(text: string): string[] {
  const out = new Set<string>();
  for (const m of foldVi(text).matchAll(/[a-z0-9]+(?:[/.-][a-z0-9]+)*\/[a-z0-9-]+/g)) {
    const parts = m[0].split("/");
    const tail = parts[parts.length - 1] as string;
    if (/[a-z]/.test(tail)) out.add(`${tail} ${tail.replace(/-/g, " ")}`);
  }
  return [...out];
}
