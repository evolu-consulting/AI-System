// verify:* (slice / wave / predeploy / prod): luật thuần — đọc VERSION, tổ tiên, migration mới, biến env mới, so migration đã áp,
// health, log lỗi, và dựng bản tóm tắt ≤ 10 dòng. Phần I/O (git/ssh/fetch) ở verify-*.ts; không script nào ghi lên prod.

export const SUMMARY_MAX = 10;

/** Cắt tóm tắt về tối đa `max` dòng (dòng cuối nói còn bao nhiêu dòng bị ẩn). */
export function clip(lines: readonly string[], max = SUMMARY_MAX): string[] {
  if (lines.length <= max) return [...lines];
  return [...lines.slice(0, max - 1), `… +${lines.length - (max - 1)} dòng nữa (xem --json)`];
}

/** Dòng đầu của VERSION: `<commit> (<ref>)`. */
export function parseVersionLine(line: string): { commit: string; ref: string } | null {
  const m = /^([0-9a-f]{7,40})(?:\s+\((.*)\))?\s*$/i.exec(line.trim());
  return m?.[1] ? { commit: m[1], ref: m[2] ?? "" } : null;
}

export type NewMigrations = { admin: string[]; hub: string[]; packs: Record<string, string[]> };

const MIG_RE =
  /^packages\/db\/(migrations|migrations-hub|migrations-pack-([a-z0-9-]+))\/([^/]+\.sql)$/;

/** Từ `git diff --name-status` ⇒ migration (.sql) thêm mới (`A`) giữa hai bản, theo admin / hub / từng gói. */
export function listMigrationsByStatus(nameStatus: string, status: "A" | "D"): NewMigrations {
  const out: NewMigrations = { admin: [], hub: [], packs: {} };
  for (const raw of nameStatus.split(/\r?\n/)) {
    const [st, file] = raw.split("\t");
    const m = st === status && file ? MIG_RE.exec(file.replaceAll("\\", "/")) : null;
    if (!m?.[3]) continue;
    if (m[1] === "migrations") out.admin.push(m[3]);
    else if (m[1] === "migrations-hub") out.hub.push(m[3]);
    else out.packs[m[2] ?? "?"] = [...(out.packs[m[2] ?? "?"] ?? []), m[3]];
  }
  return out;
}

export const countMigrations = (m: NewMigrations): number =>
  m.admin.length + m.hub.length + Object.values(m.packs).reduce((a, x) => a + x.length, 0);

/** Tên biến (`NAME=`) khai trong env.template (bỏ dòng chú thích). */
export function envVarNames(text: string): Set<string> {
  const out = new Set<string>();
  for (const l of text.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(l);
    if (m?.[1]) out.add(m[1]);
  }
  return out;
}

export const newEnvVars = (prevText: string, refText: string): string[] => {
  const prev = envVarNames(prevText);
  return [...envVarNames(refText)].filter((v) => !prev.has(v)).sort();
};

export type Predeploy = {
  prod: { commit: string; ref: string } | null;
  /** `true` tổ tiên; `false` không phải; `null` commit prod không có trong repo này. */
  ancestor: boolean | null;
  added: NewMigrations;
  lost: NewMigrations;
  envNew: string[];
};

export type Verdict = { ok: boolean; lines: string[] };

const migLine = (label: string, m: NewMigrations): string[] =>
  countMigrations(m) === 0
    ? []
    : [
        `${label}: admin ${m.admin.length}, hub ${m.hub.length}` +
          Object.entries(m.packs)
            .map(([k, v]) => `, pack-${k} ${v.length}`)
            .join(""),
        ...[...m.admin, ...m.hub, ...Object.values(m.packs).flat()]
          .slice(0, 6)
          .map((f) => `  ${f}`),
      ];

/** Kết luận trước deploy: prod phải là tổ tiên của ref và ref không làm mất migration nào của prod. */
export function predeployVerdict(ref: string, p: Predeploy): Verdict {
  if (!p.prod)
    return { ok: true, lines: ["prod: chưa có VERSION (lần đầu) — bỏ qua kiểm tổ tiên"] };
  const head = `prod ${p.prod.commit} (${p.prod.ref || "?"}) → ref ${ref}`;
  if (p.ancestor === null)
    return {
      ok: false,
      lines: [
        head,
        "KHÔNG: commit prod không có trong repo này (nhánh/máy khác) — dừng, hỏi người dùng",
      ],
    };
  if (!p.ancestor)
    return {
      ok: false,
      lines: [
        head,
        "KHÔNG: prod không phải tổ tiên của ref — deploy sẽ làm mất việc của nhánh kia; merge nhánh đó trước hoặc hỏi người dùng",
        ...migLine("migration chỉ có ở prod (sẽ MẤT)", p.lost),
      ],
    };
  const lost = countMigrations(p.lost) > 0;
  return {
    ok: !lost,
    lines: [
      `${head}: tổ tiên OK`,
      ...(lost ? migLine("migration chỉ có ở prod (sẽ MẤT)", p.lost) : []),
      ...(countMigrations(p.added) ? migLine("migration mới", p.added) : ["migration mới: không"]),
      `env.template biến mới: ${p.envNew.length ? p.envNew.join(", ") : "không"}`,
    ],
  };
}

/** Khuyến nghị migration lệch: bảng drizzle → thư mục migration của repo. */
export function tableToDir(table: string): string | null {
  const t = table.split(".").pop() ?? table;
  if (t === "__drizzle_migrations") return "migrations";
  if (t === "__drizzle_migrations_hub") return "migrations-hub";
  const m = /^__drizzle_migrations_pack_([a-z0-9_]+)$/.exec(t);
  return m?.[1] ? `migrations-pack-${m[1].replaceAll("_", "-")}` : null;
}

export type Applied = { table: string; count: number };

/** Dòng `MIG:<schema.bảng>:<số hàng>` của script ssh ⇒ danh sách bảng migration đã áp (bỏ bảng dev). */
export function parseApplied(out: string): Applied[] {
  const res: Applied[] = [];
  for (const l of out.split(/\r?\n/)) {
    const m = /^MIG:([^:]+):(\d+)/.exec(l);
    if (m?.[1] && !m[1].endsWith("_dev")) res.push({ table: m[1], count: Number(m[2]) });
  }
  return res;
}

/** So số migration đã áp với số mục journal của repo tại commit prod (`expected`: thư mục → số mục; thiếu ⇒ không so được). */
export function compareMigrations(
  applied: readonly Applied[],
  expected: Record<string, number | undefined>,
): { table: string; applied: number; expected: number | null; ok: boolean }[] {
  return applied.map((a) => {
    const dir = tableToDir(a.table);
    const e = dir ? (expected[dir] ?? null) : null;
    return { table: a.table, applied: a.count, expected: e, ok: e === null || e === a.count };
  });
}

/** Số mục `entries` trong `_journal.json`. */
export function journalCount(json: string): number {
  try {
    return (JSON.parse(json) as { entries?: unknown[] }).entries?.length ?? 0;
  } catch {
    return 0;
  }
}

export type Health = { host: string; status: number | "down" };
export const healthOk = (h: Health): boolean => typeof h.status === "number" && h.status < 400;

const SECRET_RE =
  /(bearer|token|password|passwd|secret|api[_-]?key|authorization)(["'\s:=]+)[^\s"',;]+/gi;

/** Cắt + che giá trị nhạy cảm trong dòng log trước khi in. */
export function redact(line: string, max = 160): string {
  const s = line.replace(/(bearer\s+)[^\s"',;]+/gi, "$1***").replace(SECRET_RE, "$1$2***");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Dòng log lỗi ("service-1  | ... error ...") ⇒ đếm theo dịch vụ + vài dòng mẫu đã che. */
export function errorLogSummary(log: string): {
  total: number;
  byService: Record<string, number>;
  samples: string[];
} {
  const byService: Record<string, number> = {};
  const samples: string[] = [];
  let total = 0;
  for (const l of log.split(/\r?\n/)) {
    if (
      !/\b(error|fatal|exception|unhandled|panic)\b/i.test(l) ||
      /level["=:]+\s*"?(info|debug)/i.test(l)
    )
      continue;
    total++;
    const svc = /^([a-z0-9._-]+?)(?:-\d+)?\s+\|/i.exec(l)?.[1] ?? "?";
    byService[svc] = (byService[svc] ?? 0) + 1;
    if (samples.length < 5) samples.push(redact(l));
  }
  return { total, byService, samples };
}

const NEW_RED = /NEW \[|NEW \d+ lượt|đỏ MỚI/;

/** Các dòng "đỏ MỚI" (do test:e2e:par / test:int:par in) trong một log; bỏ tiền tố `[server:N:step]`, giữ thứ tự, bỏ trùng. */
export function newRedLines(text: string): string[] {
  const out = text
    .split(/\r?\n/)
    .filter((l) => NEW_RED.test(l))
    .map((l) => l.replace(/^\s*\[server:\d+:\w+\]\s*/, "").trim());
  return [...new Set(out)];
}

export type LegResult = {
  mode: "local" | "server";
  code: number;
  seconds: number;
  summary: string;
  newReds: string[];
};

/** Dòng tổng kết cuối (`N bước xanh…` / `x/y bước đỏ…`) + đỏ mới của một lượt `test:affected`. */
export function legSummary(text: string): { summary: string; newReds: string[] } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const sum =
    [...lines].reverse().find((l) => /bước (xanh|đỏ)|không có int\/e2e/.test(l)) ??
    "(không có dòng tổng kết — xem log)";
  return { summary: sum, newReds: newRedLines(text) };
}

/** Cổng lát: xanh khi cả hai chân thoát 0 (chân server chỉ đỏ khi có đỏ mới vì evotest quarantine). */
export function sliceVerdict(legs: readonly LegResult[]): Verdict {
  const ok = legs.every((l) => l.code === 0);
  return {
    ok,
    lines: [
      ok ? "verify:slice: XANH" : "verify:slice: ĐỎ",
      ...legs.map(
        (l) =>
          `${l.mode}: ${l.code === 0 ? "✓" : `✗ (mã ${l.code})`} ${l.seconds} s — ${l.summary}`,
      ),
      ...legs.flatMap((l) => l.newReds.map((r) => `  [${l.mode}] ${r}`)),
      `log: .data/verify/slice-{local,server}.log`,
    ],
  };
}

/** Bộ lọc int cho evotest: thư mục khi MỌI file int của nó đều thuộc cổng ta, ngược lại từng file (không kéo test đóng băng/của rowan). */
export function waveFilters(kept: readonly string[], all: readonly string[]): string[] {
  const dirOf = (f: string) => f.slice(0, Math.max(0, f.lastIndexOf("/")));
  const keptSet = new Set(kept);
  // Tiền tố thư mục của test-int-par khớp cả thư mục con ⇒ chỉ dùng khi MỌI file bên dưới đều thuộc cổng ta.
  const clean = (d: string) =>
    all.filter((f) => f.startsWith(`${d}/`)).every((f) => keptSet.has(f));
  const entries = [...new Set(kept.map(dirOf))].flatMap((d) =>
    clean(d) ? [`${d}/`] : kept.filter((f) => dirOf(f) === d),
  );
  const dirs = entries.filter((e) => e.endsWith("/"));
  return entries.filter((e) => !dirs.some((d) => d !== e && e.startsWith(d))).sort();
}

export type WaveInput = {
  ints: number;
  jobs: readonly string[];
  results: readonly { name: string; ok: boolean; ms: number }[];
  newReds: readonly string[];
  seconds: number;
};

/** Cổng đợt: xanh khi mọi lệnh evotest thoát 0 (không đỏ mới); liệt kê đỏ mới, bỏ qua đỏ cũ. */
export function waveVerdict(w: WaveInput): Verdict {
  const bad = w.results.filter((r) => !r.ok);
  const ok = bad.length === 0 && w.newReds.length === 0;
  return {
    ok,
    lines: [
      `verify:wave: ${ok ? "XANH (không đỏ mới)" : `ĐỎ — ${w.newReds.length} đỏ mới, ${bad.length}/${w.results.length} lệnh đỏ`} · ${w.ints} file int, e2e ${w.jobs.length} việc, ${w.seconds.toFixed(0)} s`,
      ...w.results.map((r) => `${r.ok ? "✓" : "✗"} ${r.name} (${(r.ms / 1000).toFixed(0)} s)`),
      ...w.newReds.slice(0, 6).map((r) => `  ${r}`),
    ],
  };
}

/** Kết quả mỗi bước script (text ≤ 10 dòng hoặc JSON). */
export function render(json: boolean, obj: unknown, lines: readonly string[]): string {
  return json ? JSON.stringify(obj, null, 2) : clip(lines).join("\n");
}
