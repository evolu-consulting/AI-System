// WRK-FR-15 · HUB-FR-89 · HUB-H2b-AC-08 · H2b-R27 · runErrorTextFor (test-plan H2b §4 R30, cases §1.7;
// chữ ký plan-rules; câu chữ plan-errors §2).
import { describe, expect, it } from "bun:test";
import { CHAT_RUN_ERROR_CODES } from "@ai/contracts/chat";
import {
  runErrorText,
  runErrorTextFor,
} from "../../../../apps/hub-api/src/modules/runs/run-errors";

const LOCALES = ["vi", "en"] as const;

describe("WRK-FR-15 · hint F4 `refused` [R30]", () => {
  it("WRK-FR-15 · R30 · UPSTREAM_ERROR + refused → hint riêng, message giữ câu H1 [H2b-R27]", () => {
    expect(runErrorTextFor("UPSTREAM_ERROR", "vi", "refused")).toEqual({
      message: runErrorText("UPSTREAM_ERROR", "vi").message,
      hint: "Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ.",
    });
    expect(runErrorTextFor("UPSTREAM_ERROR", "en", "refused")).toEqual({
      message: runErrorText("UPSTREAM_ERROR", "en").message,
      hint: "The request could not be handled — rephrase or split it.",
    });
  });

  it("WRK-FR-15 · R30 · reason null/khác, mã khác (7 mã × 2 locale) → như runErrorText [H2b-R27]", () => {
    for (const code of CHAT_RUN_ERROR_CODES) {
      for (const locale of LOCALES) {
        const want = runErrorText(code, locale);
        expect(runErrorTextFor(code, locale, null)).toEqual(want);
        expect(runErrorTextFor(code, locale, "upstream")).toEqual(want);
        if (code !== "UPSTREAM_ERROR") {
          expect(runErrorTextFor(code, locale, "refused")).toEqual(want);
        }
      }
    }
  });
});
