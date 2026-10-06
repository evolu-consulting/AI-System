import { describe, expect, it } from "bun:test";
import { downloadAttachment } from "./download";

describe("downloadAttachment", () => {
  it("fetch kèm Authorization, click `<a download>` rồi thu hồi object URL", async () => {
    const calls: string[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    const saved = { fetch: g.fetch, document: g.document };
    const a = {
      click: () => calls.push("click"),
      remove: () => calls.push("remove"),
      style: {},
    } as Record<string, unknown>;
    g.document = { createElement: () => a, body: { append: () => calls.push("append") } };
    g.fetch = async (url: string) => {
      calls.push(`fetch:${url}`);
      return new Response("x");
    };
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => "blob:1";
    URL.revokeObjectURL = (u: string) => void calls.push(`revoke:${u}`);
    try {
      await downloadAttachment("id1", "a.txt");
      await new Promise((r) => setTimeout(r, 1100)); // URL thu hồi trễ 1 giây
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      Object.assign(g, saved);
    }
    expect(a.download).toBe("a.txt");
    expect(calls).toEqual([
      "fetch:/attachments/id1/content",
      "append",
      "click",
      "remove",
      "revoke:blob:1",
    ]);
  });
});
