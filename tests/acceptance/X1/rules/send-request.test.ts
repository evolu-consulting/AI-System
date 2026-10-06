// X1-AC03 · HUB-FR-11 · `buildSendRequest` (plan-frontend §0 D4, §1.1b): body E12 có `context` khi có, bỏ trường rỗng,
// giữ thứ tự `attachment_ids`. Hàm thuần nạp động (P7) ⇒ đỏ "Cannot find module" tới khi F1 xong.
import { describe, expect, it } from "bun:test";
import { SendMessageRequestSchema } from "@ai/contracts/chat";
import { loadSendRequest } from "../_modules";

const ID = (n: number) => `01900000-0000-7000-8000-0000000a10${String(n).padStart(2, "0")}`;
const build = async (input: Record<string, unknown>) =>
  (await loadSendRequest()).buildSendRequest(input) as Record<string, unknown>;

describe("X1-AC03 · buildSendRequest", () => {
  it("X1-AC03 · đủ context (selection, page_url, page_text) ⇒ body có context nguyên văn, hợp lệ theo SendMessageRequestSchema", async () => {
    const context = { selection: "a", page_url: "https://a.test/p", page_text: "t" };
    const body = await build({ content: "x", context });
    expect(body).toEqual({ content: "x", context });
    expect(SendMessageRequestSchema.safeParse(body).success).toBe(true);
  });

  it("X1-AC03 · trường context rỗng bị bỏ; context rỗng hết ⇒ không có khoá context; attachmentIds [] ⇒ không có attachment_ids", async () => {
    const body = await build({
      content: "x",
      context: { selection: "", page_url: "", page_text: "" },
      attachmentIds: [],
    });
    expect(body).toEqual({ content: "x" });
    expect(Object.keys(body)).toEqual(["content"]);
    const part = await build({ content: "x", context: { selection: "a", page_url: "" } });
    expect(part).toEqual({ content: "x", context: { selection: "a" } });
    expect(SendMessageRequestSchema.safeParse(part).success).toBe(true);
  });

  it("X1-AC03 · flowId ⇒ flow_id; attachmentIds giữ đúng thứ tự chọn", async () => {
    const ids = [ID(3), ID(1), ID(2)];
    const body = await build({ content: "x", flowId: ID(9), attachmentIds: ids });
    expect(body.flow_id).toBe(ID(9));
    expect(body.attachment_ids).toEqual(ids);
    expect(SendMessageRequestSchema.safeParse(body).success).toBe(true);
  });

  it("X1-AC03 · không context ⇒ body chỉ content (giữ hành vi C1)", async () => {
    expect(await build({ content: "Xin chào" })).toEqual({ content: "Xin chào" });
  });
});
