// Luật thuần cho `check:case`: hai đường dẫn khác nhau chỉ ở chữ hoa/thường (file hoặc tiền tố thư mục)
// sẽ va nhau trên Windows/macOS (không phân biệt hoa thường) nhưng tách nhau trên Linux (CI, evotest, prod).

export interface CaseCollision {
  a: string;
  b: string;
}

/** Mọi tiền tố thư mục + chính path: `a/b/c.ts` → `a`, `a/b`, `a/b/c.ts`. */
function prefixesOf(path: string): string[] {
  const parts = path.split("/").filter((p) => p.length > 0);
  const out: string[] = [];
  for (let i = 1; i <= parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

/**
 * Cặp (a, b) có cùng dạng viết thường nhưng khác chữ hoa/thường — tính trên mọi file và mọi tiền tố thư mục.
 * Đường dẫn trùng nhau tuyệt đối không tạo cặp.
 */
export function caseCollisions(paths: string[]): CaseCollision[] {
  const spellings = new Map<string, Set<string>>();
  for (const p of paths)
    for (const s of prefixesOf(p)) {
      const key = s.toLowerCase();
      const set = spellings.get(key) ?? new Set<string>();
      set.add(s);
      spellings.set(key, set);
    }
  const out: CaseCollision[] = [];
  for (const set of spellings.values()) {
    if (set.size < 2) continue;
    const [first, ...rest] = [...set].sort();
    for (const other of rest) out.push({ a: first as string, b: other });
  }
  return out.sort((x, y) => x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}

/** Thông báo lỗi cho người dùng; rỗng nếu không có va chạm. */
export function formatCollisions(cs: CaseCollision[]): string {
  if (cs.length === 0) return "";
  const lines = cs.map((c) => `  - "${c.a}"  ↔  "${c.b}"`);
  return [
    `check:case: ${cs.length} cặp đường dẫn chỉ khác chữ hoa/thường (Windows gộp, Linux tách):`,
    ...lines,
    "Đổi một trong hai tên cho thống nhất rồi thêm lại.",
  ].join("\n");
}
