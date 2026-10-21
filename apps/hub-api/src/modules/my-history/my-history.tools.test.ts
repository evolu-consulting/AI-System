// my-activity-rag · unit: dựng truy vấn của hai tool (deps giả) — tham số hợp kiểu `/mcp`, tsquery/vai/run loại trừ, cổng quyền
// gói trước khi gọi nguồn gói, lịch sử HĐ kèm tên người làm.
import { describe, expect, it } from "bun:test";
import type { ActivitySource } from "../packs/kit/application/activity.ports";
import type { ChatSearch } from "./my-history.repo";
import { type MyHistoryDeps, myHistoryTools } from "./my-history.tools";

const RUN = "7e5d0000-0000-4000-8000-0000000000aa";
const ctx = { tenantId: "t1", userId: "u1", runId: RUN };

function fakes(canRead: boolean) {
  const calls: { chat: Omit<ChatSearch, "months">[]; mine: number; record: number } = {
    chat: [],
    mine: 0,
    record: 0,
  };
  const src: ActivitySource = {
    pack: "contracts",
    mine: async () => {
      calls.mine++;
      return [];
    },
    record: async () => {
      calls.record++;
      return [
        {
          id: "c1",
          title: "HĐ",
          number: "2023/12-MP",
          events: [
            {
              at: "2026-10-01T00:00:00Z",
              object: "contract",
              action: "approved",
              actor_id: "u3",
              ref_id: "c1",
              name: "HĐ",
              number: "2023/12-MP",
              party: null,
            },
          ],
        },
      ];
    },
  };
  const deps: MyHistoryDeps = {
    now: () => new Date("2026-10-21T03:00:00Z"),
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
    chat: async (_w, q) => {
      calls.chat.push(q);
      return { months: 12, rows: [] };
    },
    audit: async () => [],
    names: async () => new Map([["u3", "Trưởng phòng"]]),
    sources: [src],
    canReadPack: async () => canRead,
  };
  const tools = myHistoryTools(deps);
  const tool = (n: string) => tools.find((t) => t.name === n) as (typeof tools)[number];
  return { calls, tool };
}

describe("my-history tools", () => {
  it("tham số chỉ dùng kiểu `/mcp` nhận (text/number/boolean/select); tool lõi chỉ đọc", () => {
    const { tool } = fakes(true);
    for (const n of ["my-activity", "my-chat-history"]) {
      const t = tool(n);
      expect(t.open && t.action === "read" && !t.side_effect).toBe(true);
      for (const p of t.params) expect(["text", "number", "boolean", "select"]).toContain(p.type);
    }
  });

  it("my-chat-history: từ khoá ⇒ tsquery, role user, loại run đang chạy (uuid), today theo múi tenant", async () => {
    const { calls, tool } = fakes(true);
    const out = await tool("my-chat-history").run(ctx, {
      query: "lần trước tôi hỏi về hạn mức",
      role: "user",
      from: "2026-10-21",
    });
    expect(calls.chat[0]).toMatchObject({
      tsq: "han & muc",
      roles: ["user"],
      excludeRun: RUN,
      from: "2026-10-21",
      to: null,
    });
    expect(out.window).toMatchObject({ today: "2026-10-21", time_zone: "Asia/Ho_Chi_Minh" });
    await tool("my-chat-history").run({ ...ctx, runId: "r1" }, {});
    expect(calls.chat[1]).toMatchObject({
      tsq: null,
      excludeRun: null,
      roles: ["user", "assistant"],
    });
  });

  it("my-activity: không đọc được gói ⇒ không gọi nguồn gói (mine lẫn record)", async () => {
    const { calls, tool } = fakes(false);
    await tool("my-activity").run(ctx, {});
    expect((await tool("my-activity").run(ctx, { contract: "2023/12-MP" })).found).toBe(false);
    expect(calls).toMatchObject({ mine: 0, record: 0 });
  });

  it("my-activity contract=số ⇒ lịch sử kèm tên người làm + link HĐ", async () => {
    const { tool } = fakes(true);
    const r = (await tool("my-activity").run(ctx, { contract: "2023/12-MP" })) as {
      records: { link: string; events: { by: string }[] }[];
    };
    expect(r.records[0]?.link).toBe("/contracts/c1");
    expect(r.records[0]?.events[0]?.by).toBe("Trưởng phòng");
  });
});
