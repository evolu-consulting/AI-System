// tool-affected-modules · phân loại một file migration `.sql` của hub/admin lõi: chỉ THÊM (bảng/cột/chỉ mục mới) hay có đổi
// đối tượng sẵn có. Hàm thuần, bảo thủ: câu lệnh lạ ⇒ không phải "chỉ thêm" ⇒ cổng giữ chọn rộng.
export type SqlImpact = {
  /** `true` = chỉ thêm / chỉ đổi dữ liệu (không đổi cấu trúc đối tượng sẵn có) ⇒ chọn theo bảng chạm tới. */
  scoped: boolean;
  /** Bảng bị chạm (dạng `schema.bảng` và `bảng`, chữ thường). */
  tables: string[];
  /** Lý do khi `scoped=false` (câu lệnh đầu tiên làm đổi đối tượng sẵn có). */
  reason?: string;
};

const NAME = String.raw`([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)`;
const IF_NE = String.raw`(?:if not exists\s+)?`;
const re = (s: string): RegExp => new RegExp(`^${s}`);
const CREATE_TABLE = re(`create (?:unlogged )?table ${IF_NE}${NAME}`);
const CREATE_INDEX = re(
  String.raw`create (?:unique )?index (?:concurrently )?${IF_NE}(?:[\w$"]+\s+)?on (?:only )?${NAME}`,
);
const ALTER_TABLE = re(String.raw`alter table (?:if exists )?(?:only )?${NAME}\s+(.*)$`);
const DML = re(String.raw`(?:insert into|update (?:only )?|delete from (?:only )?)\s*${NAME}`);
const ON_TABLE = re(String.raw`(?:create (?:constraint )?trigger|create policy)\b.*?\son ${NAME}`);
const OK_NO_TABLE = re(
  String.raw`(?:create schema|create sequence|create type [\w."$]+ as enum|comment on (?:table|column|schema|index))`,
);
const ALTER_BAD =
  /\b(drop|alter column|rename|add constraint|add primary|add foreign|add unique|add check|set |type )/;

/** Bỏ chú thích, chuỗi `'…'`, thân `$$…$$`; tách theo `;`; chữ thường, bỏ nháy kép. */
export function sqlStatements(sql: string): string[] {
  const clean = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\$([a-z_]*)\$[\s\S]*?\$\1\$/gi, "$$")
    .replace(/'(?:[^']|'')*'/g, "''");
  return clean
    .split(";")
    .map((s) => s.replaceAll('"', "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);
}

const bare = (n: string): string => n.slice(n.lastIndexOf(".") + 1);

type Acc = { tables: Set<string>; created: Set<string> };
const touch = (a: Acc, t: string): undefined => {
  a.tables.add(t);
  a.tables.add(bare(t));
  return undefined;
};

const FROM_JOIN = /\b(?:from|join|into|update)\s+(?:only\s+)?([a-z_][\w$]*(?:\.[a-z_][\w$]*)?)/g;
const alterOk = (a: Acc, t: string, rest: string): boolean =>
  (/^(enable|force) row level security/.test(rest) && a.created.has(t)) ||
  (/^add (column )?/.test(rest) && !ALTER_BAD.test(rest));

/** Câu lệnh tạo mới / chú thích ⇒ `true` (đã ghi bảng chạm tới). */
function additive(st: string, a: Acc): boolean {
  const ct = CREATE_TABLE.exec(st)?.[1];
  if (ct) {
    a.created.add(ct);
    touch(a, ct);
    return true;
  }
  const ci = CREATE_INDEX.exec(st)?.[1];
  if (ci) {
    touch(a, ci);
    return true;
  }
  return OK_NO_TABLE.test(st);
}

/** Câu lệnh đổi/dữ liệu: `undefined` nếu chấp nhận được, ngược lại lý do. */
function other(st: string, a: Acc): string | undefined {
  const at = ALTER_TABLE.exec(st);
  if (at?.[1]) {
    touch(a, at[1]);
    return alterOk(a, at[1], at[2] ?? "")
      ? undefined
      : `alter table ${at[1]} ${at[2]?.slice(0, 30)}`;
  }
  const on = ON_TABLE.exec(st)?.[1];
  if (on) return a.created.has(on) ? touch(a, on) : `đổi policy/trigger ${on}`;
  if (DML.test(st)) {
    for (const m of st.matchAll(FROM_JOIN)) if (m[1]) touch(a, m[1]);
    return undefined;
  }
  const grant = /^grant .* on (?:table )?([a-z_][\w$.]*)/.exec(st)?.[1];
  return grant && a.created.has(grant) ? undefined : st.slice(0, 40);
}

const judge = (st: string, a: Acc): string | undefined =>
  additive(st, a) ? undefined : other(st, a);
export function analyzeSql(sql: string): SqlImpact {
  const a: Acc = { tables: new Set(), created: new Set() };
  for (const st of sqlStatements(sql)) {
    const bad = judge(st, a);
    if (bad) return { scoped: false, tables: [...a.tables], reason: bad };
  }
  return { scoped: true, tables: [...a.tables] };
}

/** Mẫu tìm tham chiếu tới bảng trong mã: `"tên"`/`'tên'`/`` `tên` ``, `schema.tên`, snake_case, camelCase (≥ 4 ký tự; ngắn hơn chỉ `schema.tên`). */
export function tableRefs(
  tables: readonly string[],
  idents: readonly string[] = [],
): RegExp | undefined {
  const parts = new Set<string>();
  for (const id of idents) if (id.length >= 4) parts.add(String.raw`\b${id}\b`);
  for (const t of tables) {
    const b = bare(t);
    if (t.includes(".")) parts.add(String.raw`\b${t.replace(".", String.raw`\.`)}\b`);
    if (b.length < 4) continue;
    parts.add(String.raw`["'\`]${b}["'\`]`);
    if (b.includes("_")) {
      parts.add(String.raw`\b${b}\b`);
      parts.add(String.raw`\b${b.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())}\b`);
    }
  }
  return parts.size ? new RegExp([...parts].join("|")) : undefined;
}
