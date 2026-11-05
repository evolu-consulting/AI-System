// CR-121 T-1 · "mảnh" việc e2e cho cổng đợt (verify:wave): một việc quá lớn (root, contracts-web, studio…) được chia ra nhiều slot evotest.
// Mảnh nêu TƯỜNG MINH trong `--only` (không tính lại ở slot ⇒ thời lượng cache khác nhau giữa slot không làm lệch/trùng/sót file):
//   root@<k>=<e2e/a.spec.ts>+<e2e/b.spec.ts>   mảnh k (0..6; 0 giữ cổng 3000) của cấu hình gốc, đúng các file spec đó
//   root@clock=<files>                          mảnh dùng đồng hồ giả (spec chờ bước TOTP)
//   <việc>@<i>/<n>                              mảnh i (1..n) của một cấu hình khác, bằng `playwright --shard=i/n` (xác định theo danh sách test)
// Hàm thuần.

export type Piece =
  | { kind: "root"; key: string; files: string[] }
  | { kind: "shard"; job: string; i: number; n: number };

/** Mảnh gốc tối đa (k = 0..MAX): cổng web = 3600 + 10k (k ≥ 1), dải 3600–3699 không cấu hình e2e nào khác dùng (xem test chặn trùng cổng). */
export const ROOT_PIECE_MAX = 6;
export const ROOT_CLOCK_PORT = 3690;

export function parsePiece(tok: string): Piece | null {
  const r = /^root@(\d+|clock)=(.+)$/.exec(tok);
  if (r?.[1] && r[2]) {
    const k = r[1];
    if (k !== "clock" && Number(k) > ROOT_PIECE_MAX) return null;
    return { kind: "root", key: k, files: r[2].split("+").filter(Boolean) };
  }
  const s = /^([A-Za-z0-9_-]+)@(\d+)\/(\d+)$/.exec(tok);
  if (s?.[1]) {
    const i = Number(s[2]);
    const n = Number(s[3]);
    if (i >= 1 && i <= n) return { kind: "shard", job: s[1], i, n };
  }
  return null;
}

export const rootToken = (key: string | number, files: readonly string[]): string =>
  `root@${key}=${files.join("+")}`;
export const shardToken = (job: string, i: number, n: number): string => `${job}@${i}/${n}`;

/** Tên việc của mảnh: `root-<k>`, `<việc>.<i>of<n>`. */
export const pieceName = (p: Piece): string =>
  p.kind === "root" ? `root-${p.key}` : `${p.job}.${p.i}of${p.n}`;

/** Tên việc gốc của một thư mục báo cáo (`studio.1of2` → `studio`, `root-3` → `root`). */
export const baseJobName = (name: string): string =>
  name.startsWith("root-") ? "root" : name.replace(/\.\d+of\d+$/, "");
