// M2-chat · luật thuần khoang trợ lý: tin gửi Hub (tag agent dùng chung, flow, trang), áp sự kiện SSE, tiêu đề, câu lỗi.
import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "@ai/contracts/chat";
import {
  ASSISTANT_AGENT,
  applyEvent,
  assistantAgent,
  buildRequest,
  dockContext,
  errorText,
  type Msg,
  titleOf,
} from "./chat.rules";

const ev = (e: unknown) => e as ChatEvent;
const R = "01900000-0000-7000-8000-000000000001";

describe("M2-chat · chat.rules", () => {
  test("tin đầu: tag @assistant + trang; tin sau: cùng flow", () => {
    expect(buildRequest("  HĐ nào sắp hết hạn? ", null, "http://x/contracts")).toEqual({
      content: `@${ASSISTANT_AGENT} HĐ nào sắp hết hạn?`,
      context: { page_url: "http://x/contracts" },
    });
    expect(buildRequest("tiếp", R, null)).toEqual({ content: "@assistant tiếp", flow_id: R });
  });

  test("one-agent · ngữ cảnh dock: HĐ (uuid), đối tác (?party=), màn hình khác; id sai dạng bỏ", () => {
    expect(dockContext(`/contracts/${R}`, "")).toEqual({
      surface: "contracts",
      route: `/contracts/${R}`,
      entity: { kind: "contract", id: R },
    });
    expect(dockContext("/partners", "?party=mst%3A0101&tab=review")).toEqual({
      surface: "contracts",
      route: "/partners",
      entity: { kind: "partner", id: "mst:0101" },
    });
    expect(dockContext("/contracts/new", "")).toEqual({
      surface: "contracts",
      route: "/contracts/new",
    });
    expect(buildRequest("x", null, null, { surface: "contracts", route: "/my-work" })).toEqual({
      content: "@assistant x",
      context: { surface: "contracts", route: "/my-work" },
    });
  });

  test("delta ghép, step hiện nhãn, run.finished thay bằng content đủ và tắt chờ", () => {
    let m: Msg = { role: "assistant", text: "", pending: true };
    m = applyEvent(
      m,
      ev({ id: 1, event: "step.started", data: { step_id: "s1", label: "Đang tra" } }),
    );
    expect(m.step).toBe("Đang tra");
    m = applyEvent(m, ev({ id: 2, event: "delta", data: { text: "Có " } }));
    m = applyEvent(m, ev({ id: 3, event: "delta", data: { text: "2 HĐ" } }));
    expect(m.text).toBe("Có 2 HĐ");
    m = applyEvent(
      m,
      ev({
        id: 4,
        event: "run.finished",
        data: { run_id: R, message_id: R, content: "Có 2 HĐ.", ms: 5 },
      }),
    );
    expect(m).toEqual({ role: "assistant", text: "Có 2 HĐ.", pending: false, step: undefined });
  });
});

describe("M2-chat · chat.rules (lỗi, cờ, tiêu đề)", () => {
  test("run.failed ⇒ lỗi, tắt chờ; ask ⇒ câu hỏi lại vào chữ", () => {
    const base: Msg = { role: "assistant", text: "", pending: true };
    const f = applyEvent(
      base,
      ev({
        id: 1,
        event: "run.failed",
        data: { run_id: R, message_id: R, code: "TIMEOUT", message: "Hết giờ", hint: "" },
      }),
    );
    expect(f).toMatchObject({ pending: false, error: "Hết giờ" });
    const a = applyEvent(
      base,
      ev({ id: 1, event: "ask", data: { question: "Năm nào?", choices: [] } }),
    );
    expect(a.text).toBe("Năm nào?");
  });

  test("cờ PUBLIC_ASSISTANT_AGENT chọn agent; vắng/sai dạng ⇒ assistant", () => {
    expect(assistantAgent({ PUBLIC_ASSISTANT_AGENT: "mgmt-assistant-dify" })).toBe(
      "mgmt-assistant-dify",
    );
    expect(assistantAgent({ PUBLIC_ASSISTANT_AGENT: "@evil x" })).toBe("assistant");
    expect(assistantAgent(undefined)).toBe("assistant");
  });

  test("tiêu đề một dòng ≤ 80; câu lỗi theo mã", () => {
    expect(titleOf("a\n b")).toBe("a b");
    expect(titleOf("x".repeat(200))).toHaveLength(80);
    const t = (k: string) => k;
    expect(errorText("AGENT_NOT_FOUND", t)).toBe("contracts.assistant.errForbidden");
    expect(errorText("FLOW_BUSY", t)).toBe("contracts.assistant.errBusy");
    expect(errorText(undefined, t)).toBe("contracts.assistant.errGeneric");
  });
});
