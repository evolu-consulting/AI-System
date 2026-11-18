// CR-185 · sơ đồ CHỈ XEM của Sổ Hợp Tác vẽ CÙNG nút / cạnh với trang quản trị: node module nhiều stage (Ký số = Gửi ký + Chờ ký) là MỘT ô, các đầu ra
// có tên (Từ chối · Hết hạn…) là cạnh nét đứt có nhãn tới bước đích. Cùng luật cụm (`moduleClusters`), cùng sổ `MODULES` với `module-cluster.ts` của admin
// (test `def-parity.test.ts` ở admin-web khoá hai bên khớp nhau). Hàm thuần.
import { moduleClusters } from "@ai/contracts/hub-admin";
import { featureNodeByKey, MODULES } from "@ai/contracts/modules";
import type { DefViewStage } from "./def-graph";
import type { LayoutEdge } from "./graph";

/** Đầu ra của ô module đã gắn đích: `main` = «đi tiếp» (cạnh tiến thường), còn lại = cạnh nét đứt có nhãn. */
export type DefExit = { key: string; label: string; main: boolean; to: string[] };

const pick = (l: { vi: string; en: string }, lang: string): string =>
  lang.startsWith("en") ? l.en : l.vi;

type ExitDecl = { key: string; label: string; on?: readonly string[] | undefined };

function exitsOf(
  decl: readonly ExitDecl[],
  branches: readonly { on: string; step: number | null }[],
  headAtStep: (step: number) => string | undefined,
): DefExit[] {
  return decl.map((x) => {
    const to = new Set<string>();
    if (x.on)
      for (const b of branches) {
        const uid = b.step === null || !x.on.includes(b.on) ? undefined : headAtStep(b.step);
        if (uid !== undefined) to.add(uid);
      }
    return { key: x.key, label: x.label, main: x.on === undefined, to: [...to] };
  });
}

/** Gộp mỗi cụm node module thành MỘT stage (stage đầu cụm) kèm `exits`; đánh lại số cột như `collapseModules` của admin. Không có cụm ⇒ giữ nguyên. */
export function collapseDefModules(stages: readonly DefViewStage[], lang: string): DefViewStage[] {
  const clusters = moduleClusters(
    stages.map((s) => ({ node: s.node ?? undefined, executor: s.exec ?? "" })),
  );
  if (clusters.length === 0) return [...stages];
  const head = new Map<string, string>();
  for (const c of clusters)
    for (const s of stages.slice(c.start, c.end)) head.set(s.uid, stages[c.start]?.uid as string);
  const kept = stages.filter((s) => (head.get(s.uid) ?? s.uid) === s.uid);
  const keptSteps = [...new Set(kept.map((s) => s.step))].sort((a, b) => a - b);
  const total = stages.reduce((m, s) => Math.max(m, s.step + 1), 0);
  const toStep = (s: number): number => {
    const at = keptSteps.indexOf(s);
    if (at >= 0) return at;
    if (s >= total) return keptSteps.length;
    return Math.max(0, keptSteps.filter((k) => k < s).length - 1);
  };
  const headAtStep = (s: number) => kept.find((k) => k.step === s)?.uid;
  const byHead = new Map(clusters.map((c) => [stages[c.start]?.uid as string, c]));
  const nz = (n: number | null): number | null => (n === null ? null : toStep(n));
  return kept.map((s) => {
    const base: DefViewStage = {
      ...s,
      step: toStep(s.step),
      backTo: s.backTo.map(toStep),
      branch: (s.branch ?? []).map(nz),
      ifs: s.ifs && { yes: nz(s.ifs.yes), no: nz(s.ifs.no) },
      nextStep: nz(s.nextStep),
    };
    const c = byHead.get(s.uid);
    if (!c) return base;
    const members = stages.slice(c.start, c.end);
    const decl = featureNodeByKey(MODULES, c.node)?.exits?.map((x) => ({
      key: x.key,
      label: pick(x.label, lang),
      on: x.on,
    }));
    const branches = members.find((m) => m.exec === "wait_event")?.waitBranches ?? [];
    const exits = exitsOf(
      decl && decl.length > 0 ? decl : [{ key: "done", label: "" }],
      branches,
      headAtStep,
    ).map((x) => ({ ...x, to: x.to.map((u) => head.get(u) ?? u) }));
    return { ...base, exits };
  });
}

/** Cạnh nét đứt có nhãn từ đầu ra có tên của ô module tới bước đích; nhiều đầu ra cùng một đích ⇒ MỘT cạnh với nhãn ghép («Từ chối · Hết hạn»). */
export function exitEdges(stages: readonly DefViewStage[]): LayoutEdge[] {
  return stages.flatMap((s) => {
    const pairs = (s.exits ?? []).flatMap((x) => (x.main ? [] : x.to.map((to) => ({ x, to }))));
    const targets = [...new Set(pairs.map((p) => p.to))];
    return targets.map((to): LayoutEdge => {
      const label = pairs
        .filter((p) => p.to === to)
        .map((p) => p.x.label)
        .filter(Boolean)
        .join(" · ");
      return {
        id: `${s.uid}>${to}#exit`,
        source: s.uid,
        target: to,
        kind: "forward",
        exit: true,
        ...(label ? { label } : {}),
      };
    });
  });
}
