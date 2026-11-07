// CR-125 · m8 · MOD-FR-12 · nguồn tự nối của MỘT bước trong flow đã có: "Bắt đầu khi" + đầu ra của mọi bước đứng trước (topo theo cạnh engine).
// Node đọc từ sổ `MODULES` (MỘT nguồn; def cũ không có `stage.node` khớp bước cơ bản như Duyệt theo `executor.kind`). Cụm nhiều stage của
// cùng một node (Ký số = gửi + chờ) chỉ tính đầu ra MỘT lần (ở stage cuối cụm) để không thành "nhiều nguồn". Thuần, O(stage + cạnh).
import { defStartOutputs } from "../app-manifest/index";
import { type MapSource, mapSourcesAt, type StepOutputs } from "../modules/auto-map";
import { MODULES } from "../modules/index.generated";
import { baseNodeOf, featureNodeByKey } from "../modules/modules.rules";
import { type EdgeDef, flowEdges, stageOwnOutputs } from "./process-flow-edges";

type Stage = EdgeDef["stages"][number];

function declOf(s: Stage) {
  return s.node === undefined
    ? baseNodeOf(MODULES, { executor: s.executor, outcome: s.outcome })
    : featureNodeByKey(MODULES, s.node);
}

/** Đầu ra của từng stage (cùng chỉ số `def.stages`) theo sổ; stage đầu/giữa cụm cùng node ⇒ rỗng. */
export function flowStepOutputs(stages: readonly Stage[]): StepOutputs[] {
  return stages.map((s, i) => {
    const next = stages[i + 1];
    const inCluster = s.node !== undefined && next?.node === s.node;
    return { id: s.key, outputs: inCluster ? [] : stageOwnOutputs(s, declOf(s)) };
  });
}

/** Nguồn tại stage `target` (chỉ số trong `def.stages`). */
export function flowMapSources(def: EdgeDef, target: number): MapSource[] {
  return mapSourcesAt(
    defStartOutputs(def),
    flowStepOutputs(def.stages),
    flowEdges(def.stages),
    target,
  );
}
