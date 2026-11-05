// CR-120 · G3/G4 · editor: đổi qua lại draft ⇄ contract của `wait_for` / `wait_event`, ép giá trị khoá, validate form.
import { describe, expect, test } from "bun:test";
import { ProcessStageDefSchema } from "@ai/contracts/hub-admin";
import { feNodeOf } from "../nodes/registry";
import type { StageDraft, WaitDraft } from "./draft-types";
import {
  timedWaitErrors,
  WAIT_EVENT_PATCH,
  WAIT_FOR_PATCH,
  waitEventFromDef,
  waitEventToDef,
  waitForFromDef,
  waitForToDef,
} from "./timed-wait-form";
import { normalizeWait } from "./wait-form";

const WF_WAIT = WAIT_FOR_PATCH.wait as WaitDraft;
const WE_WAIT = WAIT_EVENT_PATCH.wait as WaitDraft;
const draft = (p: Partial<StageDraft>): StageDraft =>
  ({
    uid: "u",
    keyAuto: false,
    key: "w",
    name: "W",
    executor: "",
    instruction: "x",
    filename: "w.md",
    template: "",
    sections: [],
    fields: [],
    after: "review",
    step: 1,
    backTo: [],
    groupId: "g",
    real: true,
    answerer: "starter",
    answererId: "",
    timeout: "60",
    budget: "9",
    sources: [],
    mustKnow: "x",
    autofix: { on: false } as never,
    wait: { source: "", offset: "0", time: "09:00" },
    remind: "",
    escalate: { on: false, afterH: "24", groupId: "" },
    tool: { key: "", args: {} },
    set: { rows: [] },
    branch: [],
    ifx: { op: "and", conds: [], yes: null, no: null },
    ...p,
  }) as StageDraft;

describe("CR-120 · timed wait editor", () => {
  test("wait_for: draft ⇄ contract khứ hồi; executor hợp lệ theo schema", () => {
    const d = draft({ ...WAIT_FOR_PATCH, wait: { ...WF_WAIT, hours: "36" } });
    const ex = waitForToDef(d.wait);
    expect(ex).toEqual({ kind: "wait_for", hours: 36 });
    expect(waitForFromDef(ex).hours).toBe("36");
    expect(feNodeOf("wait_for").toDef(d)).toEqual(ex);
  });

  test("wait_event: khứ hồi + khoá sự kiện cắt khoảng trắng", () => {
    const d = draft({
      ...WAIT_EVENT_PATCH,
      wait: { ...WE_WAIT, event: " esign.completed ", timeoutH: "72" },
    });
    const ex = waitEventToDef(d.wait);
    expect(ex).toEqual({ kind: "wait_event", event: "esign.completed", timeout_h: 72 });
    expect(waitEventFromDef(ex)).toMatchObject({ event: "esign.completed", timeoutH: "72" });
  });

  test("normalizeWait ép tự chạy tiếp, không hành động thật, giữ loại executor", () => {
    const n = normalizeWait(
      draft({ ...WAIT_FOR_PATCH, real: true, after: "review", groupId: "g" }),
    );
    expect(n).toMatchObject({
      executor: "wait_for",
      real: false,
      after: "auto",
      groupId: "",
      fields: [],
    });
    const ex = ProcessStageDefSchema.shape.executor.safeParse(waitForToDef(n.wait));
    expect(ex.success).toBe(true);
  });

  test("validate: số giờ/hạn ngoài 1…8760 và khoá sự kiện sai dạng ⇒ lỗi ở path như server", () => {
    const e: Record<string, string> = {};
    timedWaitErrors(draft({ ...WAIT_FOR_PATCH, wait: { ...WF_WAIT, hours: "0" } }), 2, e);
    timedWaitErrors(
      draft({
        ...WAIT_EVENT_PATCH,
        wait: { ...WE_WAIT, event: "Bad Key", timeoutH: "9999" },
      }),
      3,
      e,
    );
    expect(Object.keys(e).sort()).toEqual([
      "stages.2.executor.hours",
      "stages.3.executor.event",
      "stages.3.executor.timeout_h",
    ]);
    const ok: Record<string, string> = {};
    timedWaitErrors(draft({ ...WAIT_FOR_PATCH }), 0, ok);
    expect(ok).toEqual({});
  });
});
