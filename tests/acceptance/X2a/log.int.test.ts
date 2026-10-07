// HUB-NFR-04 · HUB-FR-96 · X2a-AC16 · không log nội dung tin phòng (test-plan X2a §5.2 L01–L02; spec R24, plan-db §5 "Lỗi
// Redis: log warn ustream-publish-failed {room_id, n}"). Bắt log qua `setSink` (mẫu H1 `log.int.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  api,
  type Ctx,
  captureLogs,
  cm,
  type HubX2a,
  mkGroup,
  P,
  startHubX2a,
  startX2a,
} from "./_x2a";

let c: Ctx & { stop: () => Promise<void> };
let logs: ReturnType<typeof captureLogs>;
let broken: HubX2a | undefined;
beforeAll(async () => {
  c = await startX2a();
  logs = captureLogs();
}, 60_000);
afterAll(async () => {
  logs?.restore();
  await broken?.stop().catch(() => undefined);
  await c?.stop();
});

const MARK = "QC-X2A-NOLOG-7f3a";

describe("L01–L02 · log không chứa nội dung tin [X2a-R24 · X2a-AC16]", () => {
  it("HUB-NFR-04 · L01 · gửi/đọc tin có dấu QC-X2A-NOLOG-7f3a ⇒ 201; không dòng log nào chứa dấu [X2a-R24 · X2a-AC16]", async () => {
    const a = await c.tok("lan");
    const g = await mkGroup(c.hub, a, [P.hoa.id], "Nhóm L01");
    const from = logs.lines.length;
    const r = await api(c.hub, a, "POST", `/rooms/${g.id}/messages`, {
      content: `Bí mật ${MARK}`,
      client_msg_id: cm(),
    });
    expect(r.status).toBe(201);
    expect((await api(c.hub, await c.tok("hoa"), "GET", `/rooms/${g.id}/messages`)).status).toBe(
      200,
    );
    for (const l of logs.lines.slice(from)) expect(l).not.toContain(MARK);
  });

  it("HUB-NFR-04 · L02 · Redis của hub bị ngắt: gửi vẫn 201; log warn ustream-publish-failed có room_id, không chứa nội dung [X2a-R21 · R24]", async () => {
    broken = await startHubX2a(c.k, { instanceId: "qc-x2a-broken" });
    const a = await c.tok("lan");
    const g = await mkGroup(broken, a, [P.hoa.id], "Nhóm L02");
    broken.redis.disconnect();
    const from = logs.lines.length;
    const r = await api(broken, a, "POST", `/rooms/${g.id}/messages`, {
      content: `Redis lỗi ${MARK}`,
      client_msg_id: cm(),
    });
    expect(r.status).toBe(201);
    const mine = logs.lines.slice(from);
    const warn = mine.filter((l) => l.includes("ustream-publish-failed"));
    expect(warn.length).toBeGreaterThan(0);
    expect(warn.some((l) => l.includes(g.id))).toBe(true);
    for (const l of mine) expect(l).not.toContain(MARK);
  });
});
