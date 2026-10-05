// HUB-FR-12 · H2c-R22 · runErrorTextFor + reason `file_rejected` (test-plan H2c §1, cases §1.7 R41; câu chữ
// plan-errors §2).
import { describe, expect, it } from "bun:test";
import { CHAT_RUN_ERROR_CODES } from "@ai/contracts/chat";
import {
  runErrorText,
  runErrorTextFor,
} from "../../../../apps/hub-api/src/modules/runs/run-errors";

const LOCALES = ["vi", "en"] as const;

describe("HUB-FR-12 · hint file_rejected [R41]", () => {
  it("HUB-FR-12 · R41 · UPSTREAM_ERROR + file_rejected → hint riêng, message giữ câu H1 [H2c-R22 · HUB-H2c-AC-09]", () => {
    expect(runErrorTextFor("UPSTREAM_ERROR", "vi", "file_rejected")).toEqual({
      message: runErrorText("UPSTREAM_ERROR", "vi").message,
      hint: "Dify không nhận file này (loại hoặc kích thước).",
    });
    expect(runErrorTextFor("UPSTREAM_ERROR", "en", "file_rejected")).toEqual({
      message: runErrorText("UPSTREAM_ERROR", "en").message,
      hint: "Dify rejected this file (type or size).",
    });
  });

  it("HUB-FR-12 · R41 · mã khác + file_rejected, reason null/upstream/refused → kết quả cũ (7 mã × 2 locale) [H2c-R22]", () => {
    const REFUSED = {
      vi: "Yêu cầu chưa xử lý được — hãy diễn đạt lại hoặc chia nhỏ.",
      en: "The request could not be handled — rephrase or split it.",
    };
    for (const code of CHAT_RUN_ERROR_CODES) {
      for (const locale of LOCALES) {
        const want = runErrorText(code, locale);
        expect(runErrorTextFor(code, locale, null)).toEqual(want);
        expect(runErrorTextFor(code, locale, "upstream")).toEqual(want);
        if (code === "UPSTREAM_ERROR") {
          expect(runErrorTextFor(code, locale, "refused")).toEqual({
            ...want,
            hint: REFUSED[locale],
          });
        } else {
          expect(runErrorTextFor(code, locale, "refused")).toEqual(want);
          expect(runErrorTextFor(code, locale, "file_rejected")).toEqual(want);
        }
      }
    }
  });
});
