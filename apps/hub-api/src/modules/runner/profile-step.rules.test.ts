// HUB-FR-31 · HUB-FR-67 · AC-H4b2-07 · plan H4b2 §2.3 — biên của `pickStep` ngoài bảng ca qc (R50–R70).
import { describe, expect, test } from "bun:test";
import { blockedTrigger, pickStep, type StepView } from "./profile-step.rules";

const NOW = new Date("2026-10-13T08:00:00.000Z");
const ok: StepView = { enabled: true, state: { status: "ok", cooldownUntil: null } };
const st = (provider_key: string, on: string[] = []) => ({ provider_key, model: null, on });

describe("HUB-FR-67 · pickStep biên", () => {
  test("cooldown không có hạn (cooldownUntil null) ⇒ quota như providerBlocked", () => {
    expect(blockedTrigger({ status: "cooldown", cooldownUntil: null }, NOW)).toBe("quota");
  });
  test("profile rỗng ⇒ provider_unavailable (cả hai chế độ)", () => {
    expect(pickStep([], () => ok, NOW, false)).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
    expect(pickStep([], () => ok, NOW, true)).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
  });
  test("bước cuối bị chặn với `on` có trigger ⇒ hết bước, lý do của bước đó", () => {
    const cool: StepView = { enabled: true, state: { status: "cooldown", cooldownUntil: null } };
    expect(pickStep([st("a", ["quota"])], () => cool, NOW, false)).toEqual({
      ok: false,
      reason: "quota",
    });
  });
  test("model riêng: bước 0 vắng (view undefined) ⇒ provider_unavailable", () => {
    expect(pickStep([st("gone"), st("b")], (k) => (k === "b" ? ok : undefined), NOW, true)).toEqual(
      { ok: false, reason: "provider_unavailable" },
    );
  });
});
