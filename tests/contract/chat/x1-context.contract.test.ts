// X1-AC03 · HUB-FR-11 · E12 `POST /conversations/:id/messages` nhận `context` (selection, page_url, page_text) theo
// `SendMessageRequestSchema` (test-plan X1 §2 AC03 C). Hợp lệ ⇒ 200 `text/event-stream` như C1 (stream tới sự kiện cuối);
// sai ⇒ 400 VALIDATION_ERROR JSON. Chạy được với mock trong tiến trình và Hub thật (`HUB_URL`).
import { describe, expect, it } from "bun:test";
import {
  MESSAGE_PAGE_TEXT_MAX,
  MESSAGE_PAGE_URL_MAX,
  MESSAGE_SELECTION_MAX,
} from "@ai/contracts/chat";
import {
  call,
  expectChatError,
  expectInvariants,
  lazySession,
  newConv,
  openStream,
  terminal,
  titles,
} from "./_client";
import { USERS } from "./_env";

const lan = lazySession(USERS.a);
const title = titles("X1 ");
const path = (convId: string) => `/conversations/${convId}/messages`;

describe("X1-AC03 · E12 với context", () => {
  it("X1-AC03 · context đủ 3 trường hợp lệ → 200 text/event-stream, stream kết thúc bằng sự kiện cuối, header X-Run-Id", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Context đủ"));
    const res = await call("POST", path(conv.id), {
      token: access,
      body: {
        content: "Tóm tắt trang này",
        context: { selection: "a", page_url: "https://a.test/p", page_text: "t" },
      },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text/event-stream");
    expect(res.headers.get("X-Run-Id") ?? "").not.toBe("");
    const events = await openStream(res).rest();
    expect(terminal(events)).toBeDefined();
    expectInvariants(events);
  });

  it("X1-AC03 · context chỉ selection / chỉ page_url http:// / context rỗng {} → 200 SSE", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Context một phần"));
    for (const context of [{ selection: "chỉ chọn" }, { page_url: "http://a.test" }, {}]) {
      const res = await call("POST", path(conv.id), {
        token: access,
        body: { content: "Hỏi", context },
      });
      expect([JSON.stringify(context), res.status]).toEqual([JSON.stringify(context), 200]);
      expect(terminal(await openStream(res).rest())).toBeDefined();
    }
  });

  it("X1-AC03 · page_url không http(s) / selection rỗng / page_text rỗng / quá giới hạn / khoá lạ trong context → 400 VALIDATION_ERROR (JSON, không SSE)", async () => {
    const { access } = await lan();
    const conv = await newConv(access, title("Context sai"));
    const bad = [
      { page_url: "ftp://a.test/p" },
      { page_url: "javascript:alert(1)" },
      { selection: "" },
      { page_text: "" },
      { selection: "s".repeat(MESSAGE_SELECTION_MAX + 1) },
      { page_url: `https://a.test/${"p".repeat(MESSAGE_PAGE_URL_MAX)}` },
      { page_text: "t".repeat(MESSAGE_PAGE_TEXT_MAX + 1) },
      { selection: "a", la: 1 },
    ];
    for (const context of bad) {
      const res = await call("POST", path(conv.id), {
        token: access,
        body: { content: "Hỏi", context },
      });
      expect(res.headers.get("content-type") ?? "").not.toContain("text/event-stream");
      await expectChatError(
        res,
        "VALIDATION_ERROR",
        `E12 context ${JSON.stringify(context).slice(0, 40)}`,
      );
    }
  });
});
