// HUB-BR-04 · H3a-R09 · HUB-H3a-AC-06 · `plan` P5, §4.1 · `blockedReason(state, now)` — lý do chặn trước enqueue
// (test-plan-cases H3a §1.1 R01–R05). Khớp tuyệt đối `providerBlocked` (H1-R18), không đoán biên `== now`.
import { describe, expect, it } from "bun:test";
import {
  blockedReason,
  providerBlocked,
} from "../../../../apps/hub-api/src/modules/runner/runner.rules";

const NOW = new Date("2026-10-06T00:00:00.000Z");
const at = (ms: number): Date => new Date(NOW.getTime() + ms);
type S = { status: string; cooldownUntil: Date | null } | undefined;
const s = (status: string, cooldownUntil: Date | null = null): S => ({ status, cooldownUntil });

describe("R01–R05 · blockedReason [H3a-R09 · HUB-H3a-AC-06]", () => {
  it("HUB-BR-04 · R01 · undefined / ok / busy (cooldownUntil null) → null [H3a-R09]", () => {
    expect(blockedReason(undefined, NOW)).toBeNull();
    expect(blockedReason(s("ok"), NOW)).toBeNull();
    expect(blockedReason(s("busy"), NOW)).toBeNull();
  });

  it("HUB-BR-04 · R02 · cooldown chưa hết hạn (now+1 s) / cooldown không giờ hết → quota [H3a-R09 · HUB-H3a-AC-06]", () => {
    expect(blockedReason(s("cooldown", at(1_000)), NOW)).toBe("quota");
    expect(blockedReason(s("cooldown", null), NOW)).toBe("quota");
  });

  it("HUB-BR-04 · R03 · cooldown đã hết hạn (now−1 s) → null [H3a-R09]", () => {
    expect(blockedReason(s("cooldown", at(-1_000)), NOW)).toBeNull();
  });

  it("HUB-BR-04 · R04 · logged_out / error (cooldownUntil null và có giá trị) → provider_unavailable [H3a-R09 · HUB-H3a-AC-06]", () => {
    for (const status of ["logged_out", "error"])
      for (const until of [null, at(-1_000), at(1_000)])
        expect(blockedReason(s(status, until), NOW)).toBe("provider_unavailable");
  });

  it("HUB-BR-04 · R05 · 16 tổ hợp (undefined + 5 trạng thái × {now−1 s, now+1 s, null}): khác null ⇔ providerBlocked [H3a-R09 · H1-R18]", () => {
    const states: S[] = [undefined];
    for (const status of ["ok", "busy", "cooldown", "logged_out", "error"])
      for (const until of [at(-1_000), at(1_000), null]) states.push(s(status, until));
    for (const st of states) {
      const got = blockedReason(st, NOW);
      expect({ st, blocked: got !== null }).toEqual({ st, blocked: providerBlocked(st, NOW) });
      expect([null, "quota", "provider_unavailable"]).toContain(got);
    }
  });
});
