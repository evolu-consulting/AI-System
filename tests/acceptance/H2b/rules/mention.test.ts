// HUB-FR-91 · H2b-R02, R03, R07, R10 · suggestAgents, firstUnknownTag, directText, responderOf (test-plan H2b §4
// R10–R14, cases §1.2; chữ ký plan-rules; câu chữ plan-errors §2).
import { describe, expect, it } from "bun:test";
import { ResponderSchema } from "@ai/contracts/chat";
import { classifyMessage } from "../../../../apps/hub-api/src/modules/commands/command-parse.rules";
import {
  directText,
  firstUnknownTag,
  responderOf,
  suggestAgents,
} from "../../../../apps/hub-api/src/modules/mention/mention.rules";

const KEYS = ["assistant", "helper", "writer"];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("HUB-FR-91 · tag `@` sai, gợi ý, câu partial, responder [R10–R14]", () => {
  it("HUB-FR-91 · R10 · suggestAgents: lower, ngưỡng max(2,⌊len/3⌋), ≤ 3 sắp (khoảng cách, key), không `@` [H2b-R03]", () => {
    expect(suggestAgents("asistant", KEYS)).toEqual(["assistant"]);
    expect(suggestAgents("ASISTANT", KEYS)).toEqual(["assistant"]);
    expect(suggestAgents("xyz", KEYS)).toEqual([]);
    expect(suggestAgents("abc", ["abg", "abf", "abe", "abd"])).toEqual(["abd", "abe", "abf"]);
    expect(suggestAgents("asistant", [])).toEqual([]);
    for (const k of suggestAgents("helpr", KEYS)) expect(k.startsWith("@")).toBe(false);
  });

  it("HUB-FR-91 · R11 · firstUnknownTag: tag đầu tiên ∉ AU, null khi đủ [H2b-R02]", () => {
    expect(firstUnknownTag(["a", "b"], new Set(["a", "b"]))).toBeNull();
    expect(firstUnknownTag(["a", "x", "y"], new Set(["a"]))).toBe("x");
    expect(firstUnknownTag(["x", "a"], new Set(["a"]))).toBe("x");
  });

  it("HUB-FR-91 · R12 · directText: text + \n\n + PARTIAL_PREFIX theo locale + missing [H2b-R07]", () => {
    const r = { status: "partial", text: "A", missing: "B" } as const;
    expect(directText(r, "vi")).toBe("A\n\nPhần chưa làm được: B");
    expect(directText(r, "en")).toBe("A\n\nNot done yet: B");
  });

  it("HUB-FR-91 · R13 · responderOf: tên theo locale, cắt ≤ 100 đơn vị UTF-16 không tách surrogate [H2b-R10]", () => {
    const a = { key: "assistant", name: { vi: "Trợ lý", en: "Assistant" } };
    expect(responderOf(a, "vi")).toEqual({ key: "assistant", name: "Trợ lý" });
    expect(responderOf(a, "en")).toEqual({ key: "assistant", name: "Assistant" });
    const long = { key: "writer", name: { vi: `${"x".repeat(99)}😀😀😀`, en: "Writer" } };
    const r = responderOf(long, "vi");
    expect(r.name).toBe("x".repeat(99));
    expect(LONE_SURROGATE.test(r.name)).toBe(false);
    expect(ResponderSchema.parse(r)).toEqual(r);
    const fit = { key: "writer", name: { vi: `${"x".repeat(98)}😀😀`, en: "Writer" } };
    expect(responderOf(fit, "vi").name).toBe(`${"x".repeat(98)}😀`);
  });

  it("HUB-FR-91 · R14 · bất biến: classifyMessage(`@a x`) vẫn là chữ [H2b-R01]", () => {
    expect(classifyMessage("@a x")).toEqual({ kind: "text", content: "@a x" });
  });
});
