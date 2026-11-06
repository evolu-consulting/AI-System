// CR-122 · U2 · FLOW2-FR-25/26: bảng node từ `GET /process-palette` → stage nháp (ghi `stage.node`) + kiểm nối hai bước liền kề
// bằng `edgeIssues` (cạnh vàng) + dựng node "Ghi giá trị" làm cầu nối từ gợi ý AI. Thuần.
import { type AppNodeDecl, type AppNodeIo, edgeIssues } from "@ai/contracts/app-manifest";
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { type FeNode, feNodeOf } from "../nodes/registry";
import type { StageDraft } from "./draft-types";

/** Nhãn node theo ngôn ngữ giao diện. */
export const nodeLabel = (n: AppNodeDecl, lang: string): string =>
  lang === "vi" ? n.label.vi : n.label.en;

/** Mỗi stage mẫu của node → phần draft (loại + cấu hình đặt sẵn) kèm `node` (khoá bảng) và `outcome` nếu là Kết thúc. */
export function nodeToPatches(n: AppNodeDecl): Partial<StageDraft>[] {
  return n.stages.map((s) => {
    const ex = s.executor as unknown as ProcessStageDef["executor"];
    const fe = feNodeOf(ex.kind) as FeNode;
    return {
      executor: fe.draftExecutor(ex as never),
      ...fe.fromDef?.(ex as never),
      node: n.key,
      ...(s.outcome === undefined ? {} : { outcome: s.outcome }),
      ...(s.real_action ? { real: true } : {}),
    };
  });
}

/** Đầu ra của bước = hợp đầu ra của node bảng đã chèn; bước không phải node bảng ⇒ không biết (rỗng). */
const outputsOf = (s: StageDraft, byKey: ReadonlyMap<string, AppNodeDecl>): readonly AppNodeIo[] =>
  (s.node && byKey.get(s.node)?.outputs) || [];
const inputsOf = (s: StageDraft, byKey: ReadonlyMap<string, AppNodeDecl>): readonly AppNodeIo[] =>
  (s.node && byKey.get(s.node)?.inputs) || [];

export type EdgeProblem = {
  /** uid hai bước. */
  from: string;
  to: string;
  /** Nhãn nghiệp vụ của đầu vào thiếu (nếu manifest/engine có). */
  label?: string;
  rule: "missing" | "type";
  key: string;
  expected?: string;
  got?: string;
};

/** Cạnh vàng: mỗi cặp bước liền kề (bước k → bước k+1) mà đầu vào bắt buộc của sau không có ở đầu ra của trước / lệch kiểu. */
export function edgeProblems(
  stages: readonly StageDraft[],
  nodes: readonly AppNodeDecl[],
): EdgeProblem[] {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const steps = [...new Set(stages.map((s) => s.step))].sort((a, b) => a - b);
  return steps.flatMap((st, i) => {
    const next = steps[i + 1];
    if (next === undefined) return [];
    const a = stages.find((s) => s.step === st);
    const prevOuts = stages.filter((s) => s.step === st).flatMap((s) => outputsOf(s, byKey));
    // hai stage của CÙNG một node bảng (vd Ký số = gửi + chờ) nối với nhau bên trong node, không phải cạnh giữa hai node.
    return stages
      .filter((b) => b.step === next && !!a && !(b.node && a.node === b.node))
      .flatMap((b) => pairProblems(a as StageDraft, b, prevOuts, inputsOf(b, byKey)));
  });
}

function pairProblems(
  a: StageDraft,
  b: StageDraft,
  prevOuts: readonly AppNodeIo[],
  ins: readonly AppNodeIo[],
): EdgeProblem[] {
  return edgeIssues(prevOuts, ins).map((is) => ({
    from: a.uid,
    to: b.uid,
    rule: is.rule,
    key: is.key,
    label: ioLabel(
      ins.find((x) => x.key === is.key),
      is.key,
    ),
    ...(is.rule === "type" ? { expected: is.expected, got: is.got } : {}),
  }));
}

export type EdgeGroup = {
  from: string;
  to: string;
  keys: string[];
  /** Nhãn nghiệp vụ của từng khoá (cùng thứ tự `keys`; chưa có nhãn ⇒ chính khoá). */
  labels: string[];
  fromName: string;
  toName: string;
};

/** Nhãn của một đầu vào node: `label` (engine lát A khai) nếu có, vắng ⇒ khoá. */
export function ioLabel(io: { key: string; label?: string } | undefined, key: string): string {
  return io?.label?.trim() ? io.label : key;
}

/** Gộp các lỗi cùng một cạnh (nhiều đầu vào thiếu) thành MỘT cạnh vàng. */
export function groupProblems(
  ps: readonly EdgeProblem[],
  names: (uid: string) => string = () => "",
): EdgeGroup[] {
  const out = new Map<string, EdgeGroup>();
  for (const p of ps) {
    const k = `${p.from}>${p.to}`;
    const g = out.get(k) ?? {
      from: p.from,
      to: p.to,
      keys: [],
      labels: [],
      fromName: names(p.from),
      toName: names(p.to),
    };
    if (!g.keys.includes(p.key)) {
      g.keys.push(p.key);
      g.labels.push(p.label ?? p.key);
    }
    out.set(k, g);
  }
  return [...out.values()];
}
