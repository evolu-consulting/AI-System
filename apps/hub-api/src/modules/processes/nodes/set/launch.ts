// CR-103 · R4 · node `set` — chạy: đồng bộ trong tx khoá run, KHÔNG tạo `hub.runs`/agent/job. Dựng `fields` từ input run
// (`setFields`) → ghi output `.md` (khối ```fields) → stage `done` + join bước (như nhánh không-job của stage Áp).
import { settleApply } from "../../adapters/runs/hub-settle";
import { setFields, setInputsOf, setOutputMd } from "../../domain/set/set.rules";
import { loadHead } from "../../runs/apply-settle";
import type { NodeLauncher } from "../../runs/launch-common";

export const setLauncher: NodeLauncher = {
  async launch(d, tx, c) {
    const ex = c.def.executor;
    if (ex.kind !== "set") return { kind: "skip" };
    const lhead = await loadHead(tx, c.runId);
    if (!lhead) return { kind: "skip" };
    const declared = (c.def as { output: { fields?: { key: string; type: string }[] } }).output
      .fields;
    const fields = setFields(ex, setInputsOf(c.head.inputs), declared ?? []);
    const md = setOutputMd(c.def.name, fields);
    const stage = {
      id: c.stage.id,
      stage_idx: c.idx,
      status: "queued",
      attempt: Number(c.stage.attempt),
    };
    const s = await settleApply(d, tx, { head: lhead, stage, md, outcome: { kind: "done" } });
    // `more`: run còn bước/stage queued kế ⇒ kick tiếp (run kết thúc ⇒ kickOnce tự dừng).
    return { kind: "events", events: s.events, more: true };
  },
};
