// `bun run spec:find "<câu>" [--k 8] [--history] [--json]` — tra cứu spec cho Intake (dev-flow.md §7 Bậc 1).
// Chỉ mục dựng trong bộ nhớ mỗi lần gọi ⇒ không bao giờ cũ. Nguồn theo độ tin cậy:
// docs/current → Delta chưa gộp → CHANGE-REQUESTS → ADR → TECH-DEBT (→ docs/specs/** chỉ với --history).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDelta } from "./openspec.rules";
import {
  bestLine,
  buildIndex,
  chunkMarkdown,
  extractCodes,
  formatHit,
  type SpecUnit,
  type SynonymGroups,
  search,
} from "./spec-find.rules";

const rd = (p: string) => readFileSync(p, "utf8");

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\\/g, "/"))
    .sort();
}

function currentUnits(root: string): SpecUnit[] {
  const out: SpecUnit[] = [];
  for (const f of mdFiles(join(root, "docs", "current"))) {
    const area = f.includes("/") ? (f.split("/")[0] as string) : "current";
    out.push(
      ...chunkMarkdown(rd(join(root, "docs", "current", f)), {
        source: "current",
        file: `docs/current/${f}`,
        area,
        status: "đang chạy",
      }),
    );
  }
  return out;
}

/** Khối `## Delta` của lát "chưa gộp" (đúng định nghĩa openspec:pending). */
function deltaUnits(root: string): SpecUnit[] {
  const out: SpecUnit[] = [];
  const dir = join(root, "docs", "specs");
  if (!existsSync(dir)) return out;
  for (const slice of readdirSync(dir).sort()) {
    const f = join(dir, slice, "tasks.md");
    if (!existsSync(f)) continue;
    const text = rd(f);
    const p = parseDelta(text);
    if (p.state !== "chưa gộp") continue;
    const lines = text.split(/\r?\n/);
    let end = lines.length;
    for (let i = p.headingLine; i < lines.length; i++)
      if (/^##\s/.test(lines[i] ?? "")) {
        end = i;
        break;
      }
    out.push(
      ...chunkMarkdown(lines.slice(p.headingLine - 1, end).join("\n"), {
        source: "delta",
        file: `docs/specs/${slice}/tasks.md`,
        area: slice,
        status: "đang làm",
        lineOffset: p.headingLine,
      }),
    );
  }
  return out;
}

function historyUnits(root: string): SpecUnit[] {
  const out: SpecUnit[] = [];
  const base = join(root, "docs", "specs");
  for (const f of mdFiles(base)) {
    out.push(
      ...chunkMarkdown(rd(join(base, f)), {
        source: "history",
        file: `docs/specs/${f}`,
        area: f.split("/")[0] ?? "specs",
        status: "lịch sử",
      }),
    );
  }
  return out;
}

function crUnits(root: string): SpecUnit[] {
  const file = join(root, "docs", "CHANGE-REQUESTS.md");
  if (!existsSync(file)) return [];
  const out: SpecUnit[] = [];
  rd(file)
    .split(/\r?\n/)
    .forEach((l, i) => {
      const m = /^\|\s*(CR-\d+)\s*\|/.exec(l);
      if (!m) return;
      const cells = l.split("|").map((c) => c.trim());
      out.push({
        source: "cr",
        file: "docs/CHANGE-REQUESTS.md",
        line: i + 1,
        area: "change-requests",
        title: `${m[1]} ${(cells[4] ?? "").replace(/[`*]/g, "").slice(0, 70)}`,
        codes: extractCodes(l),
        status: "CR",
        text: l,
      });
    });
  return out;
}

function adrUnits(root: string): SpecUnit[] {
  const out: SpecUnit[] = [];
  const base = join(root, "docs", "adr");
  for (const f of mdFiles(base)) {
    const lines = rd(join(base, f)).split(/\r?\n/);
    const title = (lines[0] ?? "").replace(/^#+\s*/, "");
    const qi = lines.findIndex((l) => /^##\s+Quyết định/.test(l));
    const next = qi >= 0 ? lines.findIndex((l, i) => i > qi && /^##\s/.test(l)) : -1;
    const qe = next >= 0 ? next : lines.length;
    const body = qi >= 0 ? lines.slice(qi, qe) : lines.slice(0, 12);
    const start = qi >= 0 ? qi : 0;
    out.push({
      source: "adr",
      file: `docs/adr/${f}`,
      line: start + 1,
      area: "adr",
      title,
      codes: extractCodes(`${title}\n${body.join("\n")}`),
      status: "ADR",
      text: body.join("\n"),
    });
  }
  return out;
}

function debtUnits(root: string): SpecUnit[] {
  const f = join(root, "docs", "TECH-DEBT.md");
  if (!existsSync(f)) return [];
  return chunkMarkdown(rd(f), {
    source: "debt",
    file: "docs/TECH-DEBT.md",
    area: "tech-debt",
    status: "nợ kỹ thuật",
    maxLines: 12,
  });
}

export function loadUnits(root: string, history: boolean): SpecUnit[] {
  const u = [
    ...currentUnits(root),
    ...deltaUnits(root),
    ...crUnits(root),
    ...adrUnits(root),
    ...debtUnits(root),
  ];
  return history ? [...u, ...historyUnits(root)] : u;
}

export function loadSynonyms(root: string): SynonymGroups {
  const f = join(root, "docs", ".index", "synonyms.json");
  try {
    return JSON.parse(rd(f)) as SynonymGroups;
  } catch {
    return [];
  }
}

export function main(argv: string[], root: string): number {
  const args = [...argv];
  const flag = (n: string) => {
    const i = args.indexOf(n);
    if (i >= 0) args.splice(i, 1);
    return i >= 0;
  };
  const history = flag("--history");
  const json = flag("--json");
  let k = 8;
  const ki = args.indexOf("--k");
  if (ki >= 0) {
    k = Number(args[ki + 1]) || 8;
    args.splice(ki, 2);
  }
  const query = args.join(" ").trim();
  if (!query) {
    console.error('dùng: bun run spec:find "<câu>" [--k 8] [--history] [--json]');
    return 1;
  }
  const t0 = performance.now();
  const units = loadUnits(root, history);
  const groups = loadSynonyms(root);
  const hits = search(buildIndex(units), query, groups, k);
  const ms = Math.round(performance.now() - t0);
  if (json) {
    console.log(
      JSON.stringify({
        units: units.length,
        ms,
        hits: hits.map((h) => ({
          ...bestLine(h.unit, query, groups),
          file: h.unit.file,
          source: h.unit.source,
          status: h.unit.status,
          title: h.unit.title,
          codes: h.unit.codes,
          score: Number(h.score.toFixed(3)),
        })),
      }),
    );
    return 0;
  }
  for (const h of hits) console.log(formatHit(h, query, groups));
  if (!hits.length) console.log("(không có kết quả — được phép Grep thủ công)");
  console.error(`spec:find: ${units.length} đơn vị · ${ms} ms${history ? " · +lịch sử" : ""}`);
  return 0;
}

if (import.meta.main) {
  const git = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const top = git.exitCode === 0 ? `${git.stdout}`.trim() : process.cwd();
  process.exit(main(process.argv.slice(2), top));
}
