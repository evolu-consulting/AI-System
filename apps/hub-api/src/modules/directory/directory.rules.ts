// HUB-FR-102 · luật thuần danh bạ (X2a plan §8, plan-db §4.5; spec R22). Không I/O.

/** Mẫu `ILIKE` chứa `q`: thoát `\ % _` (ký tự thoát mặc định của Postgres là `\`) rồi bọc `%…%`. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
