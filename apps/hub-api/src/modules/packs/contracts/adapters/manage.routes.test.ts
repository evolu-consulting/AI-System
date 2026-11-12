// CR-127 K4 · BR-38/74: "Mở lại hợp đồng" đã gỡ khỏi server — `POST /contracts/:id/reopen` không còn route ⇒ 404 (trước cả guard/đọc thân).
import { describe, expect, it } from "bun:test";
import { manageRoutes } from "./manage.routes";

const noop = async () => {
  throw new Error("không được gọi");
};

describe("manageRoutes · gỡ Mở lại", () => {
  it("POST /contracts/:id/reopen ⇒ 404, không chạm use case nào", async () => {
    const r = manageRoutes(
      {} as never,
      {
        history: noop,
        assignees: noop,
        assign: noop,
        commission: noop,
        summarize: noop,
      } as never,
    );
    const res = await r.request("/contracts/c0000000-0000-4000-8000-000000000001/reopen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "AI đọc sai số tiền" }),
    });
    expect(res.status).toBe(404);
  });
});
