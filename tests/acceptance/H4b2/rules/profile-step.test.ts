// HUB-FR-67 · HUB-FR-31 (phần lúc giao job, Q4) · AC-H4b2-07 (thay AC-H04 nguyên văn, dời H2d) · plan H4b2 §2.3
// `runner/profile-step.rules.ts` · test-plan H4b2 §3 R50–R70: `blockedTrigger` + `pickStep` — 8 ca bảng plan §2.3 + biên.
// Đỏ trước code: module chưa có ⇒ `qc: <hàm> chưa có`.
import { describe, expect, it } from "bun:test";
import { fn, loadPick } from "./_rules";

const m = await loadPick();
const NOW = new Date("2026-10-13T08:00:00.000Z");
const FUTURE = new Date("2026-10-13T08:42:00.000Z");
const PAST = new Date("2026-10-13T07:00:00.000Z");
type State = { status: string; cooldownUntil: Date | null } | undefined;
type View = { enabled: boolean; state: State };
const st = (provider_key: string, on: string[] = []) => ({ provider_key, model: null, on });
const ok: View = { enabled: true, state: { status: "ok", cooldownUntil: null } };
const off: View = { enabled: false, state: { status: "ok", cooldownUntil: null } };
const cool: View = { enabled: true, state: { status: "cooldown", cooldownUntil: FUTURE } };
const pick = (steps: object[], views: Record<string, View | undefined>, ownModel = false) =>
  fn(m, "pickStep")(steps, (k: string) => views[k], NOW, ownModel);

describe("R50–R54 · blockedTrigger [plan §2.3]", () => {
  const t = (s: State) => fn(m, "blockedTrigger")(s, NOW);
  it("HUB-FR-67 · R50 · cooldown chưa hết ⇒ quota", () => {
    expect(t({ status: "cooldown", cooldownUntil: FUTURE })).toBe("quota");
  });
  it("HUB-FR-67 · R51 · cooldown đã hết (≤ now) ⇒ null", () => {
    expect(t({ status: "cooldown", cooldownUntil: PAST })).toBeNull();
    expect(t({ status: "cooldown", cooldownUntil: NOW })).toBeNull();
  });
  it("HUB-FR-67 · R52 · logged_out / error ⇒ error", () => {
    expect(t({ status: "logged_out", cooldownUntil: null })).toBe("error");
    expect(t({ status: "error", cooldownUntil: null })).toBe("error");
  });
  it("HUB-FR-67 · R53 · ok / busy ⇒ null", () => {
    expect(t({ status: "ok", cooldownUntil: null })).toBeNull();
    expect(t({ status: "busy", cooldownUntil: null })).toBeNull();
  });
  it("HUB-FR-67 · R54 · chưa có hàng state (undefined) ⇒ null", () => {
    expect(t(undefined)).toBeNull();
  });
});

describe("R55–R63 · pickStep — bảng ca plan §2.3 [Q4 · AC-H4b2-07]", () => {
  it("HUB-FR-67 · AC-H4b2-07 · R55 · ca 1: bước 0 ok ⇒ index 0, skipped []", () => {
    expect(pick([st("a", ["quota"]), st("b")], { a: ok, b: ok })).toEqual({
      ok: true,
      index: 0,
      skipped: [],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R56 · ca 2: bước 0 tắt ⇒ index 1, skipped [{0, disabled}] (vô điều kiện, on [])", () => {
    expect(pick([st("a"), st("b")], { a: off, b: ok })).toEqual({
      ok: true,
      index: 1,
      skipped: [{ index: 0, why: "disabled" }],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R57 · ca 3: bước 0 cooldown + on [quota] ⇒ index 1, skipped [{0, quota}]", () => {
    expect(pick([st("a", ["quota"]), st("b")], { a: cool, b: ok })).toEqual({
      ok: true,
      index: 1,
      skipped: [{ index: 0, why: "quota" }],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R58 · ca 4: bước 0 cooldown + on [] ⇒ {ok:false, quota} (không thử bước kế)", () => {
    expect(pick([st("a"), st("b")], { a: cool, b: ok })).toEqual({ ok: false, reason: "quota" });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R59 · ca 5: bước 0 logged_out + on [error] ⇒ index 1, skipped [{0, error}]", () => {
    const lo: View = { enabled: true, state: { status: "logged_out", cooldownUntil: null } };
    expect(pick([st("a", ["error"]), st("b")], { a: lo, b: ok })).toEqual({
      ok: true,
      index: 1,
      skipped: [{ index: 0, why: "error" }],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R60 · ca 6: cooldown đã hết hạn ⇒ index 0", () => {
    const past: View = { enabled: true, state: { status: "cooldown", cooldownUntil: PAST } };
    expect(pick([st("a"), st("b")], { a: past, b: ok })).toMatchObject({ ok: true, index: 0 });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R61 · ca 7: mọi bước tắt / vắng ⇒ {ok:false, provider_unavailable}", () => {
    expect(pick([st("a"), st("b")], { a: off, b: off })).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
    expect(pick([st("a"), st("b")], { a: off, b: undefined })).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R62 · ca 8: 2 bước cùng cooldown, on [quota] ⇒ {ok:false, quota}", () => {
    expect(pick([st("a", ["quota"]), st("b", ["quota"])], { a: cool, b: cool })).toEqual({
      ok: false,
      reason: "quota",
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R63 · provider vắng (dev_only bị bỏ) ⇒ bỏ qua như tắt; bước có state undefined ⇒ chọn", () => {
    expect(
      pick([st("gone"), st("a", ["quota"]), st("b")], {
        gone: undefined,
        a: { enabled: true, state: undefined },
        b: ok,
      }),
    ).toEqual({ ok: true, index: 1, skipped: [{ index: 0, why: "disabled" }] });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R64 · tắt + cooldown(on quota) + logged_out(on error) ⇒ index 3, skipped theo thứ tự", () => {
    const lo: View = { enabled: true, state: { status: "logged_out", cooldownUntil: null } };
    expect(
      pick([st("a"), st("b", ["quota"]), st("c", ["error", "quota"]), st("d")], {
        a: off,
        b: cool,
        c: lo,
        d: ok,
      }),
    ).toEqual({
      ok: true,
      index: 3,
      skipped: [
        { index: 0, why: "disabled" },
        { index: 1, why: "quota" },
        { index: 2, why: "error" },
      ],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R65 · trigger error ⇒ reason provider_unavailable: bước 0 error + on [] dừng; tắt rồi bước cuối error (on [error]) hết bước", () => {
    const er: View = { enabled: true, state: { status: "error", cooldownUntil: null } };
    expect(pick([st("a"), st("b")], { a: er, b: ok })).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
    expect(pick([st("a"), st("b", ["error"])], { a: off, b: er })).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
  });
});

describe("R66–R70 · pickStep — agent có model riêng ⇒ không dự phòng [Q4 chốt · AC-H4b2-07]", () => {
  const lo: View = { enabled: true, state: { status: "logged_out", cooldownUntil: null } };
  const past: View = { enabled: true, state: { status: "cooldown", cooldownUntil: PAST } };
  it("HUB-FR-67 · AC-H4b2-07 · R66 · ca 9: bước 0 ok ⇒ index 0, skipped []", () => {
    expect(pick([st("a", ["quota"]), st("b")], { a: ok, b: ok }, true)).toEqual({
      ok: true,
      index: 0,
      skipped: [],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R67 · ca 10: bước 0 tắt, bước 1 ok ⇒ {ok:false, provider_unavailable}", () => {
    expect(pick([st("a"), st("b")], { a: off, b: ok }, true)).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R68 · ca 11: bước 0 cooldown + on [quota], bước 1 ok ⇒ {ok:false, quota, skipped []}", () => {
    expect(pick([st("a", ["quota"]), st("b")], { a: cool, b: ok }, true)).toMatchObject({
      ok: false,
      reason: "quota",
      skipped: [],
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R69 · ca 12: bước 0 logged_out + on [error], bước 1 ok ⇒ {ok:false, provider_unavailable}", () => {
    expect(pick([st("a", ["error"]), st("b")], { a: lo, b: ok }, true)).toEqual({
      ok: false,
      reason: "provider_unavailable",
    });
  });
  it("HUB-FR-67 · AC-H4b2-07 · R70 · ca 13: bước 0 cooldown đã hết hạn ⇒ index 0", () => {
    expect(pick([st("a"), st("b")], { a: past, b: ok }, true)).toMatchObject({
      ok: true,
      index: 0,
    });
  });
});
