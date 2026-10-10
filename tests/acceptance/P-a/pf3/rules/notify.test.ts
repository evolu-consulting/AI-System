// HUB-FR-112 · AC-H32 · HUB-BR-26 · R-N01, R-N02 — `noticeRecipients`, `dueReminder` (notify/notify.rules.ts, plan-contract §7).
// Đỏ trước code ở `fn()` (module vắng ⇒ `{}`), test-plan §5.
import { describe, expect, it } from "bun:test";
import { fn, loadProcRules } from "../../_support/modules";

const T = "a5a00000-0000-4000-8000-00000000d001";
const B = "a5a00000-0000-4000-8000-00000000d002";
const X = "a5a00000-0000-4000-8000-00000000d003";
const mod = () => loadProcRules("notify/notify.rules.ts");

describe("notify.rules [HUB-FR-112]", () => {
  it("HUB-FR-112 · R-N01 · users [T,B] + group [B,X], loại B ⇒ [T,X] không trùng", async () => {
    const f = fn(await mod(), "noticeRecipients");
    const out: string[] = f({ userIds: [T, B], groupMemberIds: [B, X] }, B);
    expect([...out].sort()).toEqual([T, X].sort());
    expect(new Set(out).size).toBe(out.length);
    const all: string[] = f({ userIds: [T, B], groupMemberIds: [B, X] });
    expect([...all].sort()).toEqual([T, B, X].sort());
  });
  it("AC-H32 · R-N02 · dueReminder: open + remindAt ≤ now + chưa nhắc ⇒ true; đã nhắc / closed / remindAt > now ⇒ false (chỉ 1 lần)", async () => {
    const f = fn(await mod(), "dueReminder");
    const now = new Date("2026-10-10T10:00:00Z");
    const past = new Date("2026-10-10T09:00:00Z");
    const future = new Date("2026-10-10T11:00:00Z");
    expect(f({ status: "open", remindAt: past, remindedAt: null }, now)).toBe(true);
    expect(f({ status: "open", remindAt: now, remindedAt: null }, now)).toBe(true);
    expect(f({ status: "open", remindAt: past, remindedAt: past }, now)).toBe(false);
    expect(f({ status: "closed", remindAt: past, remindedAt: null }, now)).toBe(false);
    expect(f({ status: "open", remindAt: future, remindedAt: null }, now)).toBe(false);
  });
});
