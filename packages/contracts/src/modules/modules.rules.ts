// CR-125 · m1 · MOD-FR-01/04/05/10 · luật THUẦN của sổ module: `moduleIssues` (khai báo × tóm tắt binding), nhìn node theo app, node bảng,
// khớp bước cơ bản cho def cũ. O(node + sự kiện + kết quả), không I/O.
import { z } from "zod";
import type { AppEventDecl, AppNodeDecl, AppSignalDecl } from "../app-manifest/manifest";
import type {
  BoundSummary,
  FeatureModule,
  FeatureNodeDecl,
  ModuleIssue,
  ModuleIssueCode,
} from "./types";

/** Bỏ phần riêng của sổ (kind, baseExecutor, configPort, legacy) ⇒ đúng hình `AppNodeDecl` cũ (API, def đã lưu không đổi). */
export function toAppNode(n: FeatureNodeDecl): AppNodeDecl {
  const { kind: _k, baseExecutor: _b, configPort: _c, legacy: _l, ...rest } = n;
  return rest;
}

/** Node của một module (`core` hoặc key app) ở dạng `AppNodeDecl`; chỉ node có stage mẫu (đã chèn được vào flow). */
export function nodesOfApp(mods: readonly FeatureModule[], app: string): AppNodeDecl[] {
  return mods
    .filter((m) => m.app === app)
    .flatMap((m) => m.nodes)
    .filter((n) => n.stages.length > 0)
    .map(toAppNode);
}

/** Tra khai báo node đầy đủ theo khoá. */
export function featureNodeByKey(
  mods: readonly FeatureModule[],
  key: string,
): FeatureNodeDecl | undefined {
  for (const m of mods) {
    const n = m.nodes.find((x) => x.key === key);
    if (n) return n;
  }
  return undefined;
}

/** Ghép sự kiện của manifest vào sổ (m1: sự kiện còn khai ở `AppManifest.events`). Module không có manifest giữ nguyên. */
export function withEvents(
  mods: readonly FeatureModule[],
  manifests: readonly {
    key: string;
    events: readonly AppEventDecl[];
    signals?: readonly AppSignalDecl[] | undefined;
  }[],
): FeatureModule[] {
  const ev = new Map(manifests.map((m) => [m.key, m]));
  return mods.map((m) => {
    const mf = ev.get(m.app);
    const signals = mf?.signals ?? m.signals;
    return { ...m, events: mf?.events ?? m.events, ...(signals ? { signals } : {}) };
  });
}

/**
 * MOD-FR-05 · def cũ không có `stage.node`: khớp bước cơ bản theo `executor.kind` (+ `outcome` ⇒ Kết thúc; `notify` có kênh email ⇒ Gửi email,
 * còn lại Thông báo chuông). Không khớp ⇒ undefined (bước tuỳ biến, không lỗi).
 */
export function baseNodeOf(
  mods: readonly FeatureModule[],
  stage: { executor: { kind: string; channels?: readonly string[] }; outcome?: string | undefined },
): FeatureNodeDecl | undefined {
  const kind = stage.executor.kind;
  const base = mods.flatMap((m) => m.nodes).filter((n) => n.kind === "base");
  if (kind === "set")
    return stage.outcome !== undefined ? base.find((n) => n.key === "core.end") : undefined;
  const cands = base.filter((n) => n.baseExecutor === kind);
  if (kind !== "notify") return cands[0];
  const email = stage.executor.channels?.includes("email") === true;
  return cands.find((n) => n.key === (email ? "core.email" : "core.bell"));
}

const sep = "\0";
const issue = (
  code: ModuleIssueCode,
  app: string,
  key: string,
  message: string,
  detail?: string,
): ModuleIssue =>
  detail === undefined ? { code, app, key, message } : { code, app, key, detail, message };

/** Hình JSON Schema (đầu vào) để so hai schema khác tham chiếu; schema không biểu diễn được ⇒ coi là khác. */
function shapeOf(s: z.ZodTypeAny): Record<string, unknown> | null {
  try {
    return z.toJSONSchema(s, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Khoá trường mức đầu của schema (nếu là object) — để câu lỗi nói rõ thiếu khoá nào. */
function topKeys(shape: Record<string, unknown> | null): string[] {
  const p = shape?.properties;
  return p && typeof p === "object" ? Object.keys(p) : [];
}

function portMismatch(decl: FeatureNodeDecl, args: z.ZodTypeAny | undefined): string | null {
  const port = decl.configPort;
  if (!port || !args || port.schema === args) return null;
  const a = shapeOf(port.schema);
  const b = shapeOf(args);
  if (a && b && JSON.stringify(a) === JSON.stringify(b)) return null;
  const have = new Set(topKeys(b));
  const missing = topKeys(a).filter((k) => !have.has(k));
  return missing.length > 0 ? `thiếu «${missing.join("», «")}»` : "khác kiểu hoặc ràng buộc";
}

/** Khoá đầu ra node khai báo và máy chủ ghi được (không `pending`). */
export const writableOutputKeys = (n: Pick<FeatureNodeDecl, "outputs">): string[] =>
  n.outputs.filter((o) => o.pending !== true).map((o) => o.key);

/**
 * CR-125 · m8 · `MOD_OUTPUT_UNBOUND` hai chiều: đầu ra khai (không `pending`) mà binding không ghi ⇒ lỗi; binding ghi khoá không khai hoặc còn
 * `pending` ⇒ lỗi (khai báo và máy chủ phải khớp, không để cổng "ma"). Chỉ xét khi node có binding.
 */
function outputIssues(
  m: FeatureModule,
  n: FeatureNodeDecl,
  b: { outputs?: readonly string[] },
  out: ModuleIssue[],
): void {
  const wrote = new Set(b.outputs ?? []);
  const file = `packs/${m.app}/nodes/${n.key.split(".")[1] ?? n.key}/binding.ts`;
  for (const o of n.outputs) {
    const label = o.label?.vi ?? o.key;
    if (o.pending !== true && !wrote.has(o.key))
      out.push(
        issue(
          "MOD_OUTPUT_UNBOUND",
          m.app,
          n.key,
          `Node «${n.label.vi}» khai đầu ra «${label}» (${o.key}) nhưng xử lý máy chủ chưa ghi giá trị này — ghi nó trong ${file} (outputs) hoặc đánh dấu pending: true ở node.ts.`,
          o.key,
        ),
      );
    else if (o.pending === true && wrote.has(o.key))
      out.push(
        issue(
          "MOD_OUTPUT_UNBOUND",
          m.app,
          n.key,
          `Node «${n.label.vi}»: đầu ra «${label}» (${o.key}) đã được máy chủ ghi — bỏ pending: true ở node.ts.`,
          o.key,
        ),
      );
  }
  const declared = new Set(n.outputs.map((o) => o.key));
  for (const k of wrote)
    if (!declared.has(k))
      out.push(
        issue(
          "MOD_OUTPUT_UNBOUND",
          m.app,
          n.key,
          `Xử lý máy chủ của node «${n.label.vi}» ghi đầu ra «${k}» nhưng node.ts không khai — thêm vào outputs hoặc bỏ khỏi ${file}.`,
          k,
        ),
      );
}

function nodeIssues(
  m: FeatureModule,
  n: FeatureNodeDecl,
  bound: BoundSummary,
  out: ModuleIssue[],
): void {
  if (n.legacy === true) return;
  const b = bound.nodes.get(n.key);
  if (n.kind === "base") {
    if (b) outputIssues(m, n, b, out);
    return;
  }
  if (!b) {
    out.push(
      issue(
        "MOD_UNBOUND",
        m.app,
        n.key,
        `Node «${n.label.vi}» (${n.key}) chưa có xử lý máy chủ — thêm packs/${m.app}/nodes/${n.key.split(".")[1] ?? n.key}/binding.ts.`,
      ),
    );
    return;
  }
  for (const s of n.stages) {
    const tool = s.executor.kind === "tool" ? s.executor.tool_key : undefined;
    if (typeof tool === "string" && !bound.tools.has(tool))
      out.push(
        issue(
          "MOD_TOOL_MISSING",
          m.app,
          n.key,
          `Node «${n.label.vi}» gọi tool «${tool}» nhưng tool chưa đăng ký.`,
          tool,
        ),
      );
  }
  outputIssues(m, n, b, out);
  const why = portMismatch(n, b.argsSchema);
  if (why !== null)
    out.push(
      issue(
        "MOD_PORT_MISMATCH",
        m.app,
        n.key,
        `Cấu hình node «${n.label.vi}» khác tham số tool: ${why}.`,
        why,
      ),
    );
}

function eventIssues(m: FeatureModule, e: AppEventDecl, bound: BoundSummary, out: ModuleIssue[]) {
  const k = `${m.app}${sep}${e.key}`;
  if (e.facts.length > 0 && !bound.facts.has(k))
    out.push(
      issue(
        "MOD_EVENT_UNBOUND",
        m.app,
        e.key,
        `Sự kiện «${e.label}» (${e.key}) chưa có bộ đọc dữ kiện.`,
      ),
    );
  if (e.outcomes.length > 0 && !bound.outcomes.has(k)) {
    const first = e.outcomes[0]?.key ?? "";
    out.push(
      issue(
        "MOD_OUTCOME_UNBOUND",
        m.app,
        e.key,
        `Sự kiện «${e.key}» có kết quả «${first}» nhưng app chưa xử lý kết quả.`,
        first,
      ),
    );
  }
}

type Dups = { nodeOwner: Map<string, string>; eventKeys: Set<string> };

/** Khoá node / sự kiện khai hai lần (node: toàn tập; sự kiện: trong cùng app). */
function dupIssues(mods: readonly FeatureModule[], out: ModuleIssue[]): Dups {
  const nodeOwner = new Map<string, string>();
  const eventKeys = new Set<string>();
  for (const m of mods) {
    for (const n of m.nodes) {
      const prev = nodeOwner.get(n.key);
      if (prev === undefined) nodeOwner.set(n.key, m.app);
      else
        out.push(
          issue(
            "MOD_DUP",
            m.app,
            n.key,
            `Khoá node «${n.key}» khai báo hai lần (${prev}, ${m.app}) — giữ một.`,
          ),
        );
    }
    for (const e of m.events) {
      const k = `${m.app}${sep}${e.key}`;
      if (eventKeys.has(k))
        out.push(
          issue(
            "MOD_DUP",
            m.app,
            e.key,
            `Khoá sự kiện «${e.key}» khai báo hai lần (${m.app}) — giữ một.`,
          ),
        );
      eventKeys.add(k);
    }
  }
  return { nodeOwner, eventKeys };
}

/** Binding cho khoá không khai (node, dữ kiện, kết quả). */
function orphanIssues(bound: BoundSummary, d: Dups, out: ModuleIssue[]): void {
  const orphan = (app: string, key: string, what: string) =>
    out.push(
      issue(
        "MOD_ORPHAN_BINDING",
        app,
        key,
        `Có xử lý cho ${what} «${key}» nhưng không có khai báo — xoá binding hoặc thêm node.ts.`,
      ),
    );
  for (const key of bound.nodes.keys())
    if (!d.nodeOwner.has(key))
      orphan(key.includes(".") ? (key.split(".")[0] ?? "unknown") : "unknown", key, "node"); // khoá không có dấu chấm ⇒ app "unknown"
  for (const k of new Set([...bound.facts, ...bound.outcomes])) {
    if (d.eventKeys.has(k)) continue;
    const [app = "", ev = ""] = k.split(sep);
    orphan(app, ev, "sự kiện");
  }
}

/** Khoá tín hiệu mà node chờ: `wait_event.event` + `also_events` của stage, `exits[].on`. */
function signalsOfNode(n: FeatureNodeDecl): string[] {
  const fromStages = n.stages.flatMap((s) => {
    const x = s.executor as { kind: string; event?: string; also_events?: readonly string[] };
    return x.kind === "wait_event" ? [x.event ?? "", ...(x.also_events ?? [])] : [];
  });
  return [...fromStages, ...(n.exits ?? []).flatMap((ex) => ex.on ?? [])];
}

function waitedSignals(mods: readonly FeatureModule[]): Set<string> {
  return new Set(mods.flatMap((m) => m.nodes.flatMap(signalsOfNode)));
}

/** Tín hiệu chờ không bị node nào dùng ⇒ `MOD_SIGNAL_ORPHAN` (tín hiệu không cần binding máy chủ, không vào "Bắt đầu khi"). */
function signalIssues(mods: readonly FeatureModule[], out: ModuleIssue[]): void {
  const used = waitedSignals(mods);
  for (const m of mods)
    for (const s of m.signals ?? [])
      if (!used.has(s.key))
        out.push(
          issue(
            "MOD_SIGNAL_ORPHAN",
            m.app,
            s.key,
            `Tín hiệu «${s.label}» (${s.key}) không node nào chờ — xoá khỏi signals hoặc thêm node chờ nó.`,
          ),
        );
}

/**
 * Đối chiếu khai báo × binding. Node `legacy` (DLC) chỉ kiểm khoá trùng; node `base` không cần binding.
 * Mã `MOD_PANEL_ORPHAN` (admin-web) và `MOD_INDEX_STALE` (CI) do bên đó phát, không ở đây.
 */
export function moduleIssues(mods: readonly FeatureModule[], bound: BoundSummary): ModuleIssue[] {
  const out: ModuleIssue[] = [];
  const dups = dupIssues(mods, out);
  for (const m of mods) {
    for (const n of m.nodes) if (dups.nodeOwner.get(n.key) === m.app) nodeIssues(m, n, bound, out);
    for (const e of m.events) eventIssues(m, e, bound, out);
  }
  signalIssues(mods, out);
  orphanIssues(bound, dups, out);
  return out;
}
