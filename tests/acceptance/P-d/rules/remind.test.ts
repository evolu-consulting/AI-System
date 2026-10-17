// HUB-FR-145 · HUB-BR-43 · HUB-BR-26 · AC-H42 · PD-R18/R19 — `domain/notify/remind.rules.ts` (tách
// `notify/notify.rules.ts` ở T9s; plan-domain §4.13). test-plan-rules PD-U76…U80 (U76, U80 hồi quy R-N02, R-N01).
import { describe, expect, it } from "bun:test";
import { domainFn } from "../_support/modules";

const REL = "notify/remind.rules.ts";
const N = new Date("2026-10-19T01:00:00.000Z");
const HOUR = 3_600_000;
const at = (h: number) => new Date(N.getTime() + h * HOUR);
const G2 = "a5d00000-0000-4000-8000-0000000000a2";

describe("dueReminder [PD-R18, R-N02]", () => {
  it("HUB-BR-26 · AC-H42 · PD-U76 · cũ (remindEveryH null): chưa nhắc + remindAt ≤ now ⇒ true; đã nhắc ⇒ false (giữ R-N02)", async () => {
    const f = await domainFn(REL, "dueReminder");
    const old = { status: "open", remindEveryH: null, remindCount: 0 };
    expect(f({ ...old, remindAt: at(-1), remindedAt: null }, N)).toBe(true);
    expect(f({ ...old, remindAt: N, remindedAt: null }, N)).toBe(true);
    expect(f({ ...old, remindAt: at(-1), remindedAt: at(-1) }, N)).toBe(false);
    expect(f({ ...old, remindAt: at(1), remindedAt: null }, N)).toBe(false);
    // vắng hẳn trường mới (task cũ) ⇒ như R-N02
    expect(f({ status: "open", remindAt: at(-1), remindedAt: null }, N)).toBe(true);
    expect(f({ status: "open", remindAt: at(-1), remindedAt: at(-1) }, N)).toBe(false);
  });
  it("HUB-FR-145 · AC-H42 · PD-U77 · lặp remindEveryH 4: count 9 ⇒ true (kể cả đã nhắc trước); count 10 ⇒ false; closed ⇒ false; remindAt > now ⇒ false", async () => {
    const f = await domainFn(REL, "dueReminder");
    const rep = { status: "open", remindEveryH: 4, remindAt: N, remindedAt: at(-4) };
    expect(f({ ...rep, remindCount: 9 }, N)).toBe(true);
    expect(f({ ...rep, remindCount: 10 }, N)).toBe(false);
    expect(f({ ...rep, remindCount: 0, status: "closed" }, N)).toBe(false);
    expect(f({ ...rep, remindCount: 1, remindAt: at(1) }, N)).toBe(false);
  });
});

describe("nextRemind, reviewTaskTiming [PD-R18, PD-R19]", () => {
  it("HUB-FR-145 · PD-U78 · nextRemind({remindAt:N, remindCount:2, remindEveryH:4}) ⇒ {remindAt:N+4h, remindCount:3}", async () => {
    const f = await domainFn(REL, "nextRemind");
    expect(f({ remindAt: N, remindCount: 2, remindEveryH: 4 })).toEqual({
      remindAt: at(4),
      remindCount: 3,
    });
  });
  it("HUB-FR-145 · HUB-BR-43 · PD-U79 · reviewTaskTiming: không cấu hình ⇒ remindAt N+24h như cũ; {4, {24, G2}} ⇒ {N+4h, 4, N+24h, G2}", async () => {
    const f = await domainFn(REL, "reviewTaskTiming");
    expect(f(N, { remindEveryH: null, escalate: null })).toEqual({
      remindAt: at(24),
      remindEveryH: null,
      escalateAt: null,
      escalateGroupId: null,
    });
    expect(f(N, { remindEveryH: 4, escalate: { afterH: 24, groupId: G2 } })).toEqual({
      remindAt: at(4),
      remindEveryH: 4,
      escalateAt: at(24),
      escalateGroupId: G2,
    });
  });
});

describe("noticeRecipients hồi quy [R-N01]", () => {
  it("HUB-BR-26 · PD-U80 · R-N01 · users [T,B] + group [B,X], loại B ⇒ [T,X] không trùng; không loại ⇒ [T,B,X]", async () => {
    const T = "a5a00000-0000-4000-8000-00000000d001";
    const B = "a5a00000-0000-4000-8000-00000000d002";
    const X = "a5a00000-0000-4000-8000-00000000d003";
    const f = await domainFn(REL, "noticeRecipients");
    const out: string[] = f({ userIds: [T, B], groupMemberIds: [B, X] }, B);
    expect([...out].sort()).toEqual([T, X].sort());
    expect(new Set(out).size).toBe(out.length);
    const all: string[] = f({ userIds: [T, B], groupMemberIds: [B, X] });
    expect([...all].sort()).toEqual([T, B, X].sort());
  });
});
