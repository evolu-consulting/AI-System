// studio-agents-list · GET /studio/api/agents đánh dấu đúng: agent đã gộp (`alias_of {id,key}`) và agent chạy nền (`surface`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { AG4, type Ctx, pa, startH4a } from "../H4a/_h4a";

let x: Ctx;
beforeAll(async () => {
  x = await startH4a();
}, 60_000);
afterAll(async () => {
  await x?.stop();
});

describe("studio-agents-list · cờ retired/background trong danh sách", () => {
  it("alias_of → {id,key} của agent thay thế; surface background; agent thường = chat, alias_of null", async () => {
    await x.sql`update hub.agents set alias_of = ${AG4.free} where id = ${AG4.off}`;
    await x.sql`update hub.agents set surface = 'background' where id = ${AG4.orchBeta}`;
    const r = await pa(x, "GET", "/agents");
    expect(r.status).toBe(200);
    const by = (k: string) =>
      r.json.items.find((i: { key: string }) => i.key === k) as Record<string, unknown>;
    expect(by("dang-tat")).toMatchObject({
      alias_of: { id: AG4.free, key: "tu-do" },
      surface: "chat",
    });
    expect(by("orch-beta4")).toMatchObject({ surface: "background", alias_of: null });
    expect(by("co-quyen")).toMatchObject({ surface: "chat", alias_of: null });
  });
});
