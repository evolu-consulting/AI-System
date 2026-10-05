// HUB-BR-04 · H3a-R08 · HUB-H3a-AC-06 · `plan` P4, §4.2–4.3 · `runErrorTextFor(code, locale, reason)` chọn câu theo reason
// cho `ALL_PROVIDERS_EXHAUSTED` (test-plan-cases H3a §1.2 R10–R18). `runErrorText(code)` giữ nguyên (H1 khoá).
import { describe, expect, it } from "bun:test";
import { CHAT_ERROR_TEXT_MAX } from "@ai/contracts/chat";
import {
  runErrorText,
  runErrorTextFor,
} from "../../../../apps/hub-api/src/modules/runs/run-errors";
import { H1_EXHAUSTED, R08 } from "../_r08";

const LOCALES = ["vi", "en"] as const;
const EX = "ALL_PROVIDERS_EXHAUSTED";

describe("R10–R13 · câu R08 nguyên văn [H3a-R08 · HUB-H3a-AC-06]", () => {
  it("HUB-BR-04 · R10 · EXHAUSTED + quota (vi) → câu hết hạn mức [H3a-R08 · HUB-H3a-AC-06]", () => {
    expect(runErrorTextFor(EX, "vi", "quota")).toEqual({
      message: "Dịch vụ AI đã dùng hết hạn mức của gói hiện tại.",
      hint: "Thử lại sau; hạn mức sẽ tự mở lại.",
    });
  });

  it("HUB-BR-04 · R11 · EXHAUSTED + quota (en) [H3a-R08 · HUB-H3a-AC-06]", () => {
    expect(runErrorTextFor(EX, "en", "quota")).toEqual({
      message: "The AI service has used up the current plan's limit.",
      hint: "Try again later; the limit will reset automatically.",
    });
  });

  it("HUB-BR-04 · R12 · EXHAUSTED + provider_unavailable (vi) → câu tạm ngưng [H3a-R08 · HUB-H3a-AC-06]", () => {
    expect(runErrorTextFor(EX, "vi", "provider_unavailable")).toEqual({
      message: "Dịch vụ AI đang tạm ngưng để quản trị viên kiểm tra.",
      hint: "Báo quản trị viên nếu lỗi kéo dài.",
    });
  });

  it("HUB-BR-04 · R13 · EXHAUSTED + provider_unavailable (en) [H3a-R08 · HUB-H3a-AC-06]", () => {
    expect(runErrorTextFor(EX, "en", "provider_unavailable")).toEqual({
      message: "The AI service is paused for an administrator to check.",
      hint: "Contact your administrator if this persists.",
    });
  });
});

describe("R14–R16, R18 · hồi quy câu H1/H2 [H3a-R08 · H3a-R19]", () => {
  it("HUB-BR-04 · R14 · EXHAUSTED + reason null/tenant_slots/provider_busy/timeout/zzz → câu H1 [H3a-R08]", () => {
    for (const locale of LOCALES)
      for (const reason of [null, "tenant_slots", "provider_busy", "timeout", "zzz"]) {
        expect(runErrorTextFor(EX, locale, reason)).toEqual(runErrorText(EX, locale));
        expect(runErrorTextFor(EX, locale, reason)).toEqual(H1_EXHAUSTED[locale]);
      }
  });

  it("HUB-BR-04 · R15 · TIMEOUT/INTERNAL_ERROR/UPSTREAM_ERROR + quota/provider_unavailable → câu theo mã (reason chỉ áp cho EXHAUSTED) [H3a-R08]", () => {
    for (const code of ["TIMEOUT", "INTERNAL_ERROR", "UPSTREAM_ERROR"] as const)
      for (const locale of LOCALES)
        for (const reason of ["quota", "provider_unavailable"])
          expect(runErrorTextFor(code, locale, reason)).toEqual(runErrorText(code, locale));
  });

  it("HUB-BR-04 · R16 · runErrorText(EXHAUSTED) không đổi — câu H1 [H3a-R19 · P4]", () => {
    for (const locale of LOCALES) expect(runErrorText(EX, locale)).toEqual(H1_EXHAUSTED[locale]);
  });

  it("HUB-BR-04 · R18 · UPSTREAM_ERROR + file_rejected giữ hint H2c [H3a-R19 · H2c-R22]", () => {
    expect(runErrorTextFor("UPSTREAM_ERROR", "vi", "file_rejected")).toEqual({
      message: runErrorText("UPSTREAM_ERROR", "vi").message,
      hint: "Dify không nhận file này (loại hoặc kích thước).",
    });
    expect(runErrorTextFor("UPSTREAM_ERROR", "en", "file_rejected")).toEqual({
      message: runErrorText("UPSTREAM_ERROR", "en").message,
      hint: "Dify rejected this file (type or size).",
    });
  });
});

describe("R17 · câu R08 tĩnh, ngắn, không lộ thông tin [H3a-R08 · H1-R26]", () => {
  it("HUB-BR-04 · R17 · 4 câu mới (message + hint): ≤ CHAT_ERROR_TEXT_MAX, không số/giờ, tên provider, @, http; khác câu H1 [H3a-R08 · Q5]", () => {
    for (const reason of ["quota", "provider_unavailable"] as const)
      for (const locale of LOCALES) {
        const t = runErrorTextFor(EX, locale, reason);
        expect(t).not.toEqual(H1_EXHAUSTED[locale]);
        for (const text of [t.message, t.hint]) {
          expect(text.length).toBeGreaterThan(0);
          expect(text.length).toBeLessThanOrEqual(CHAT_ERROR_TEXT_MAX);
          expect(text).not.toMatch(/\d/);
          expect(text).not.toMatch(/claude|anthropic|sub|fake/i);
          expect(text).not.toContain("@");
          expect(text).not.toContain("http");
        }
        expect(t).toEqual(R08[reason][locale]);
      }
  });
});
