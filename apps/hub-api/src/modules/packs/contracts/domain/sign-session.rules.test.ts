// CR-127 · P1 · spec §3 #12–#14c · luật phiên ký chung: trạng thái phiên ⇒ chuyển HĐ (cả hai bên) + tín hiệu node chờ.
import { describe, expect, it } from "bun:test";
import { transition } from "./contract-state.rules";
import { signSessionErrorOf, signSessionPlan } from "./sign-session.rules";

describe("CR-127 P1 · signSessionPlan", () => {
  it.each([
    ["accepted", null, null, "sign.session.accepted"],
    ["signing", null, null, "sign.session.signed"],
    ["done", null, "done", "sign.session.done"],
    ["declined", null, "reject", "sign.session.declined"],
    ["cancelled", null, "draft", "sign.session.cancelled"],
    ["expired", null, null, "sign.session.expired"],
    ["expired", "resend", "draft", "sign.session.cancelled"],
    ["expired", "stop", "reject", "sign.session.declined"],
    ["fallback", null, null, "sign.session.expired"],
  ] as const)("%s/%s ⇒ HĐ %s, tín hiệu %s", (st, choice, to, signal) => {
    const p = signSessionPlan(st, choice);
    expect(p.signal).toBe(signal);
    expect(p.ev ? (transition("processing", p.ev, {}) as { to: string }).to : null).toBe(to);
  });

  it("mã lỗi từ RAISE của hàm hub (kể cả bọc trong cause); lỗi khác ⇒ null", () => {
    expect(signSessionErrorOf(new Error("SESSION_HASH_MISMATCH"))).toBe("SESSION_HASH_MISMATCH");
    expect(
      signSessionErrorOf(new Error("Failed query", { cause: new Error("SESSION_FORBIDDEN") })),
    ).toBe("SESSION_FORBIDDEN");
    expect(signSessionErrorOf(new Error("boom"))).toBeNull();
  });
});
