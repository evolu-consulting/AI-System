// HUB-FR-44 · X2b2 D8 · RV-7 · `filesBody`: D8 400 (path `attachment_ids`), chuẩn hoá chữ thường, trùng sau chuẩn hoá 400.
import { describe, expect, it } from "bun:test";
import type { SendRoomMessageRequest } from "@ai/contracts/chat";
import { filesBody } from "./message-files";

const ID = "A2B20000-0000-4000-8000-0000000000AA";
const base = { content: "x", client_msg_id: "a2b20000-0000-4000-8000-000000000001" };
const body = (p: Partial<SendRoomMessageRequest>): SendRoomMessageRequest => ({ ...base, ...p });
const issueOf = (f: () => unknown): unknown => {
  try {
    f();
  } catch (e) {
    return (e as { details?: { issues?: unknown[] } }).details?.issues?.[0];
  }
  return null;
};

describe("filesBody [X2b2 D8, RV-7]", () => {
  it("HUB-FR-44 · không id ⇒ trả nguyên body (kể cả `!…` + engine bật)", () => {
    const b = body({ content: "!hoa-don x" });
    expect(filesBody(b, true)).toBe(b);
  });

  it("HUB-FR-44 · D8 · `!hoa-don` timeline + engine bật + id ⇒ 400 path attachment_ids `unsupported`", () => {
    const issue = issueOf(() =>
      filesBody(body({ content: "!hoa-don x", attachment_ids: [ID] }), true),
    );
    expect(issue).toEqual({ path: ["attachment_ids"], code: "custom", message: "unsupported" });
  });

  it("HUB-FR-44 · engine tắt / có flow_id ⇒ cho phép, id chữ thường", () => {
    const off = filesBody(body({ content: "!hoa-don x", attachment_ids: [ID] }), false);
    expect(off.attachment_ids).toEqual([ID.toLowerCase()]);
    const flow = "a2b20000-0000-4000-8000-000000000002";
    const inThread = filesBody(body({ content: "!x", flow_id: flow, attachment_ids: [ID] }), true);
    expect(inThread.attachment_ids).toEqual([ID.toLowerCase()]);
  });

  it("HUB-FR-44 · RV-7 · trùng khác hoa/thường ⇒ 400 `duplicate`", () => {
    const issue = issueOf(() => filesBody(body({ attachment_ids: [ID, ID.toLowerCase()] }), false));
    expect(issue).toEqual({ path: ["attachment_ids"], code: "custom", message: "duplicate" });
  });
});
