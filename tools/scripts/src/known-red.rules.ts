// Danh sách đỏ đã biết có hạn (`tests/known-red.json`): hàm thuần. Một "đỏ" (red) = {suite, name}; đỏ khớp một mục CÒN HẠN là
// "đỏ cũ" (known), còn lại — gồm cả mục HẾT HẠN — là "đỏ MỚI" và là thứ duy nhất làm hỏng mã thoát khi bật quarantine.
// Dùng bởi `test:e2e:par`, `test:int:par` (bản tóm tắt cuối, evotest chạy lại đúng hai lệnh này) và `test:affected`.

export type KnownRed = {
  /** Tiêu đề ca/spec hoặc đường dẫn file; khớp theo ranh giới (đầu chuỗi, sau `/`, sau khoảng trắng), không phân biệt hoa/thường. */
  id: string;
  /** `*`, hoặc tiền tố của suite của đỏ: `e2e:root` khớp `e2e:root-0`, `int`, `unit`. */
  suite: string;
  reason: string;
  owner: string;
  /** `YYYY-MM-DD`, còn hiệu lực HẾT ngày này; ngày sau đó mục coi như không có. */
  expires: string;
  since: string;
};

/** Một ca đỏ: `suite` = `e2e:<việc>` | `int` | `unit`; `name` = `<file> › <describe> › <ca>` (file có thể vắng). */
export type Red = { suite: string; name: string };

export type Hit = { red: Red; entry: KnownRed };
export type Split = { known: Hit[]; fresh: Red[]; expired: Hit[] };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ["id", "suite", "reason", "owner", "expires", "since"] as const;

/** Đọc `{ "entries": [...] }`; thiếu trường hoặc ngày sai ⇒ ném lỗi nêu rõ mục nào (tránh nuốt đỏ vì file hỏng). */
export function parseKnownRed(text: string): KnownRed[] {
  const raw = JSON.parse(text) as { entries?: unknown };
  if (!Array.isArray(raw.entries)) throw new Error("known-red.json: thiếu mảng `entries`");
  return raw.entries.map((e: Record<string, unknown>, i) => {
    for (const f of FIELDS)
      if (typeof e[f] !== "string" || !e[f])
        throw new Error(`known-red.json: entries[${i}] thiếu \`${f}\``);
    for (const f of ["expires", "since"] as const)
      if (!DATE.test(e[f] as string))
        throw new Error(`known-red.json: entries[${i}].${f} phải là YYYY-MM-DD`);
    return e as unknown as KnownRed;
  });
}

/** Mục hết hạn khi `expires` < hôm nay (so chuỗi ISO). */
export const isExpired = (e: KnownRed, today: string): boolean => e.expires < today;

const fold = (s: string): string => s.replaceAll("\\", "/").toLowerCase();

/** `id` nằm trong `name` và bắt đầu ở ranh giới (đầu chuỗi, sau `/`, khoảng trắng hay `>`). */
export function containsId(name: string, id: string): boolean {
  const n = fold(name);
  const k = fold(id);
  for (let i = n.indexOf(k); i >= 0; i = n.indexOf(k, i + 1)) {
    const prev = n[i - 1];
    if (i === 0 || prev === "/" || prev === " " || prev === ">") return true;
  }
  return false;
}

const suiteMatches = (e: KnownRed, red: Red): boolean =>
  e.suite === "*" || red.suite.startsWith(e.suite);

/** Phân loại các đỏ: mục còn hạn ⇒ known; chỉ khớp mục hết hạn ⇒ expired (tính là MỚI); không khớp ⇒ fresh. */
export function splitReds(
  reds: readonly Red[],
  entries: readonly KnownRed[],
  today: string,
): Split {
  const out: Split = { known: [], fresh: [], expired: [] };
  for (const red of reds) {
    const hits = entries.filter((e) => suiteMatches(e, red) && containsId(red.name, e.id));
    const live = hits.find((e) => !isExpired(e, today));
    const dead = hits.find((e) => isExpired(e, today));
    if (live) out.known.push({ red, entry: live });
    else if (dead) out.expired.push({ red, entry: dead });
    else out.fresh.push(red);
  }
  return out;
}

/** Số đỏ MỚI (gồm hết hạn) + số lần chạy đỏ mà không rút được tên ca (sập, không có báo cáo) — không thể quarantine. */
export const newCount = (s: Split, unattributed: number): number =>
  s.fresh.length + s.expired.length + unattributed;

/** Mã thoát: quarantine bật ⇒ chỉ đỏ mới; tắt (nghiêm) ⇒ mọi đỏ. */
export function exitCode(s: Split, unattributed: number, quarantine: boolean): number {
  const total = quarantine ? newCount(s, unattributed) : s.known.length + newCount(s, unattributed);
  return total > 0 ? 1 : 0;
}

/** Các dòng tóm tắt: đỏ MỚI trước (riêng), rồi đỏ cũ. Rỗng khi không có đỏ nào. */
export function formatSplit(label: string, s: Split, unattributed: number): string[] {
  const lines: string[] = [];
  const nNew = newCount(s, unattributed);
  if (nNew > 0) {
    lines.push(`${label}: ${nNew} đỏ MỚI (không nằm trong tests/known-red.json còn hạn):`);
    for (const r of s.fresh) lines.push(`  NEW [${r.suite}] ${r.name}`);
    for (const h of s.expired)
      lines.push(`  NEW [${h.red.suite}] ${h.red.name} — mục known-red HẾT HẠN ${h.entry.expires}`);
    if (unattributed)
      lines.push(`  NEW ${unattributed} lượt chạy đỏ không rút được tên ca (xem log)`);
  }
  if (s.known.length) {
    lines.push(
      `${label}: ${s.known.length} đỏ cũ (known-red, không tính vào mã thoát khi quarantine):`,
    );
    for (const h of s.known)
      lines.push(
        `  known [${h.red.suite}] ${h.red.name} — ${h.entry.reason} (${h.entry.owner}, hạn ${h.entry.expires})`,
      );
  }
  return lines;
}

/** Quarantine bật bằng `--quarantine` hoặc `TEST_QUARANTINE=1` (evotest/test:affected); vắng ⇒ nghiêm như cũ. `--no-quarantine` thắng. */
export function quarantineOn(
  argv: readonly string[],
  env: Record<string, string | undefined>,
): boolean {
  if (argv.includes("--no-quarantine")) return false;
  return argv.includes("--quarantine") || env.TEST_QUARANTINE === "1";
}

/** Các ca `(fail)` trong log `bun test` (kèm file lấy từ dòng tiêu đề `path/x.test.ts:` đứng trước); `[12ms]` ở cuối bị bỏ. */
export function intReds(text: string): Red[] {
  const out: Red[] = [];
  let file = "";
  for (const raw of text.split(/\r?\n/)) {
    const head = /^(\S+\.(?:test|spec)\.[cm]?[jt]sx?):$/.exec(raw);
    if (head?.[1]) file = head[1].replaceAll("\\", "/").replace(/^\.\//, "");
    else if (raw.startsWith("(fail) ")) {
      const title = raw.slice(7).replace(/\s*\[[\d.]+m?s\]\s*$/, "");
      out.push({ suite: "int", name: file ? `${file} › ${title}` : title });
    }
  }
  return out;
}
