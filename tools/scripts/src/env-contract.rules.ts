// Luật thuần của check:env-contract: lấy TÊN biến một kit đặt (parse tĩnh văn bản), so với hợp đồng. Không đọc giá trị.

export type ContractVar = { name: string; kits: string[]; note?: string };
export type Contract = {
  kitFiles: Record<string, string[]>;
  vars: ContractVar[];
  allowDiff: string[];
};

const NAME = "[A-Z][A-Z0-9_]*";

/** Tên biến trong gen-env.sh: thân heredoc (`NAME=`), `setkv|ensure NAME`, `grep -q '^NAME='`, `NAME=` ở dòng đầu của lệnh `export`. */
function collect(text: string, re: RegExp, out: Set<string>): void {
  for (const m of text.matchAll(re)) if (m[1]) out.add(m[1]);
}

export function parseShNames(text: string): Set<string> {
  const out = new Set<string>();
  const heredoc = /<<-?\s*'?(\w+)'?[^\n]*\n([\s\S]*?)\n\s*\1\s*(?:\n|$)/g;
  for (const m of text.matchAll(heredoc)) collect(m[2] ?? "", new RegExp(`^(${NAME})=`, "gm"), out);
  collect(text, new RegExp(`\\b(?:setkv|ensure)\\s+(${NAME})\\b`, "g"), out);
  collect(text, new RegExp(`grep -q '\\^(${NAME})='`, "g"), out);
  collect(text, new RegExp(`^\\s*export\\s+(${NAME})=`, "gm"), out);
  return out;
}
/** Tên trong env.template: dòng `NAME=` (giá trị trống). */
export function parseTemplateNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(new RegExp(`^(${NAME})=`, "gm"))) if (m[1]) out.add(m[1]);
  return out;
}

export type ContractResult = {
  missing: Record<string, string[]>;
  onlyIn: Record<string, string[]>;
  ok: boolean;
};

export function checkContract(c: Contract, byKit: Record<string, Set<string>>): ContractResult {
  const missing: Record<string, string[]> = {};
  for (const v of c.vars)
    for (const kit of v.kits.filter((k) => !byKit[k]?.has(v.name)))
      missing[kit] = [...(missing[kit] ?? []), v.name];
  const allow = new Set(c.allowDiff);
  const kits = Object.keys(byKit);
  const onlyIn: Record<string, string[]> = {};
  for (const kit of kits) {
    const others = kits.filter((k) => k !== kit);
    const list = [...(byKit[kit] ?? [])]
      .filter((n) => !allow.has(n) && others.some((o) => !byKit[o]?.has(n)))
      .sort();
    if (list.length) onlyIn[kit] = list;
  }
  return { missing, onlyIn, ok: Object.keys(missing).length === 0 };
}

export function renderResult(r: ContractResult): string[] {
  const lines: string[] = [];
  for (const [kit, names] of Object.entries(r.missing))
    lines.push(`THIẾU ở ${kit}: ${names.join(", ")}`);
  for (const [kit, names] of Object.entries(r.onlyIn))
    lines.push(`chỉ ${kit} đặt (không có trong allowDiff): ${names.join(", ")}`);
  return lines;
}
