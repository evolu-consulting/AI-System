// HUB-FR-21, HUB-FR-27 · H1-R06, R07, R08, R09 · hàm thuần Orchestrator (test-plan H1 §4 R1–R6, chữ ký plan §6.4).
import { describe, expect, it } from "bun:test";
import type { AgentResult } from "@ai/contracts/hub";
import {
  budgetExceeded,
  budgetOutcome,
  canPassThrough,
  chunkText,
  parseDecision,
} from "../../../../apps/hub-api/src/modules/orchestrator/orchestrator.rules";

const DELEGATE = { decision: "delegate", agent: "assistant", task: "Tóm tắt tài liệu" } as const;
const ANSWER = { decision: "answer", text: "Xin chào, tôi giúp được gì?" } as const;
const ASK = { decision: "ask" as const, question: "Bạn muốn ngôn ngữ nào?", choices: ["vi", "en"] };

const cps = (s: string): number => [...s].length;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function expectChunks(text: string, max = 40): string[] {
  const parts = max === 40 ? chunkText(text) : chunkText(text, max);
  expect(parts.join("")).toBe(text);
  for (const p of parts) {
    expect(cps(p)).toBeGreaterThanOrEqual(1);
    expect(cps(p)).toBeLessThanOrEqual(max);
    expect(LONE_SURROGATE.test(p)).toBe(false);
  }
  return parts;
}

describe("R1 · parseDecision hợp lệ [H1-R06]", () => {
  it("R1 · 3 loại decision đúng schema → ok [H1-R06]", () => {
    for (const d of [DELEGATE, ANSWER, ASK]) {
      expect(parseDecision(JSON.stringify(d))).toEqual({ ok: true, decision: d });
    }
  });

  it("R1 · bỏ code fence ```json [H1-R06]", () => {
    const raw = `\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``;
    expect(parseDecision(raw)).toEqual({ ok: true, decision: ANSWER });
  });

  it("R1 · khoảng trắng/xuống dòng đầu-cuối [H1-R06]", () => {
    const raw = `\n\n   ${JSON.stringify(DELEGATE, null, 2)}  \n\t`;
    expect(parseDecision(raw)).toEqual({ ok: true, decision: DELEGATE });
  });

  it("R1 · chữ trước `{` và sau `}` → ok [H1-R06]", () => {
    const raw = `Đây là quyết định: ${JSON.stringify(ASK)} — hết.`;
    expect(parseDecision(raw)).toEqual({ ok: true, decision: ASK });
  });

  it("R1 · mảng [{…answer…}] → ok (luật `{` đầu → `}` cuối, Q-T5) [H1-R06]", () => {
    expect(parseDecision(`[${JSON.stringify(ANSWER)}]`)).toEqual({ ok: true, decision: ANSWER });
  });
});

describe("R2 · parseDecision hỏng [H1-R06]", () => {
  it("R2 · không phải JSON → not_json [H1-R06]", () => {
    const raws = ["", "xin chào", "{", '{"decision":"answer","text":"cắt cụt', '{"a":1}{"b":2}'];
    for (const raw of raws) expect(parseDecision(raw)).toEqual({ ok: false, reason: "not_json" });
  });

  it("R2 · decision lạ, thiếu task, thừa trường → schema [H1-R06]", () => {
    const bad = [
      { decision: "foo", text: "x" },
      { decision: "delegate", agent: "assistant" },
      { ...ANSWER, extra: 1 },
    ];
    for (const d of bad) {
      expect(parseDecision(JSON.stringify(d))).toEqual({ ok: false, reason: "schema" });
    }
  });

  it("R2 · agent sai key, task 8001 ký tự, 7 choices, answer rỗng → schema [H1-R06]", () => {
    const bad = [
      { ...DELEGATE, agent: "Bad_Key" },
      { ...DELEGATE, task: "a".repeat(8001) },
      { ...ASK, choices: ["1", "2", "3", "4", "5", "6", "7"] },
      { decision: "answer", text: "" },
    ];
    for (const d of bad) {
      expect(parseDecision(JSON.stringify(d))).toEqual({ ok: false, reason: "schema" });
    }
  });
});

describe("R3 · budgetExceeded [HUB-FR-21 · H1-R07]", () => {
  it("R3 · steps=4 < max=5, tokens < budget → false [HUB-FR-21]", () => {
    expect(budgetExceeded({ steps: 4, maxSteps: 5, tokens: 199_999, tokenBudget: 200_000 })).toBe(
      false,
    );
  });

  it("R3 · steps=5 = max → true [HUB-FR-21]", () => {
    expect(budgetExceeded({ steps: 5, maxSteps: 5, tokens: 0, tokenBudget: 200_000 })).toBe(true);
  });

  it("R3 · tokens = budget → true [HUB-FR-21]", () => {
    expect(budgetExceeded({ steps: 1, maxSteps: 5, tokens: 200_000, tokenBudget: 200_000 })).toBe(
      true,
    );
  });

  it("R3 · steps=0, tokens=0 → false [HUB-FR-21]", () => {
    expect(budgetExceeded({ steps: 0, maxSteps: 5, tokens: 0, tokenBudget: 200_000 })).toBe(false);
  });
});

describe("R4 · budgetOutcome [HUB-FR-21 · H1-R07]", () => {
  it("R4 · chưa có câu trả lời (vi/en) → fail BUDGET_EXCEEDED [HUB-FR-21]", () => {
    for (const locale of ["vi", "en"] as const) {
      expect(budgetOutcome(null, locale)).toEqual({ kind: "fail", code: "BUDGET_EXCEEDED" });
    }
  });

  it("R4 · đã có câu trả lời (vi) → finish, bắt đầu bằng câu trả lời + câu báo [HUB-FR-21]", () => {
    const out = budgetOutcome("abc", "vi");
    expect(out.kind).toBe("finish");
    const text = out.kind === "finish" ? out.text : "";
    expect(text.startsWith("abc")).toBe(true);
    expect(text).not.toBe("abc");
  });

  it("R4 · locale en → câu báo en khác vi [HUB-FR-21]", () => {
    const vi = budgetOutcome("abc", "vi");
    const en = budgetOutcome("abc", "en");
    expect(en.kind).toBe("finish");
    const enText = en.kind === "finish" ? en.text : "";
    const viText = vi.kind === "finish" ? vi.text : "";
    expect(enText.startsWith("abc")).toBe(true);
    expect(enText).not.toBe("abc");
    expect(enText).not.toBe(viText);
  });
});

describe("R5 · canPassThrough [HUB-FR-27 · H1-R08]", () => {
  const done: AgentResult = { status: "done", text: "Kết quả" };
  const partial: AgentResult = { status: "partial", text: "Một phần", missing: "Phần còn lại" };
  const needInput: AgentResult = { status: "need_input", question: "Chọn?", choices: ["A"] };

  it("R5 · done + 1 delegate + chưa partial → true [HUB-FR-27]", () => {
    expect(canPassThrough({ delegates: 1, hadPartial: false }, done)).toBe(true);
  });

  it("R5 · delegates=2 → false [HUB-FR-27]", () => {
    expect(canPassThrough({ delegates: 2, hadPartial: false }, done)).toBe(false);
  });

  it("R5 · đã có partial → false [HUB-FR-27]", () => {
    expect(canPassThrough({ delegates: 1, hadPartial: true }, done)).toBe(false);
  });

  it("R5 · kết quả partial / need_input → false [HUB-FR-27]", () => {
    expect(canPassThrough({ delegates: 1, hadPartial: false }, partial)).toBe(false);
    expect(canPassThrough({ delegates: 1, hadPartial: false }, needInput)).toBe(false);
  });

  it("R5 · delegates=0 → false [HUB-FR-27]", () => {
    expect(canPassThrough({ delegates: 0, hadPartial: false }, done)).toBe(false);
  });
});

describe("R6 · chunkText [H1-R09]", () => {
  const SENTENCE =
    "Hệ thống điều phối agent nhận tin nhắn, chọn agent phù hợp rồi trả lời người dùng theo từng phần nhỏ để hiển thị mượt mà.";

  it("R6 · nối lại == text, mỗi phần 1–40 ký tự, theo từ [H1-R09]", () => {
    const parts = expectChunks(SENTENCE);
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("R6 · đúng 40 ký tự → 1 phần [H1-R09]", () => {
    const text = "abcd efgh ijkl mnop qrst uvwx yzab cdefg";
    expect(cps(text)).toBe(40);
    expect(chunkText(text)).toEqual([text]);
  });

  it("R6 · từ 95 ký tự → cắt cứng ≤ 40 [H1-R09]", () => {
    const text = `mở đầu ${"x".repeat(95)} kết thúc`;
    const parts = expectChunks(text);
    expect(parts.length).toBeGreaterThanOrEqual(3);
  });

  it("R6 · dấu NFC và NFD giữ nguyên khi nối, đếm theo code point [H1-R09]", () => {
    for (const text of [SENTENCE.normalize("NFC"), SENTENCE.normalize("NFD")]) {
      expectChunks(text);
    }
  });

  it("R6 · emoji không bị cắt đôi (Q-T5) [H1-R09]", () => {
    const text = `${"😀".repeat(45)} ${"👍🏽".repeat(30)} xong`;
    expectChunks(text);
    expectChunks("😀".repeat(100));
  });

  it("R6 · xuống dòng kép, nhiều khoảng trắng được giữ [H1-R09]", () => {
    const text = "Đoạn một có vài từ.\n\nĐoạn hai   có   nhiều   khoảng   trắng.\n\n\nHết.";
    expectChunks(text);
  });

  it("R6 · max=5 → mỗi phần ≤ 5 ký tự [H1-R09]", () => {
    expectChunks("một hai ba bốn năm sáu bảy tám", 5);
  });

  it("R6 · chuỗi rỗng → [] [H1-R09]", () => {
    expect(chunkText("")).toEqual([]);
  });
});
