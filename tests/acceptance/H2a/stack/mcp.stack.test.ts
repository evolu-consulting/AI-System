// HUB-FR-50 · WRK-FR-13 · AC-H12 · HUB-H2a-AC-05 · H2a-R18–R20 · test-plan H2a cases §5 S02: stack thật — agent `hoadon`
// (fake-cli) `#fake:mcp-list` qua `/mcp` Hub thật: `done` chứa tên tool (chỉ workflow bật) + mô tả; sửa mô tả ở Admin →
// `tools/list` thấy mô tả mới ≤ 5 s; token job (đọc từ file MCP 0600 trong container lúc chạy) → 401 sau khi run xong.
// Chạy: bun run test:h2a:stack
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { type Json, waitFor } from "../../H1/_fixtures";
import { deltaText, insertConv, send } from "../../H1/_hub";
import { catalogChange, WF } from "../_h2a";
import { mcp } from "../_runtime2";
import { bootStackH2a, type RuntimeBox, type StackH2a } from "./_stack";

const RT = "qc-h2a-stack-mcp";
const NEW_DESC = "Mô tả mới S02 · kiểm tra hoá đơn theo mã";
let s: StackH2a;
let rt: RuntimeBox;
beforeAll(async () => {
  s = await bootStackH2a(RT);
  rt = await s.runtime(`${RT}-1`, "fake-cli");
}, 180_000);
afterAll(async () => {
  await s?.stop();
});

/** Token Bearer trong file cấu hình MCP (`AGENT_RT_WORK_DIR/.mcp/<job_id>.json`, plan-runtime §4.2) lúc job chạy. */
async function tokenFromFile(): Promise<string> {
  const raw = await waitFor(
    async () => rt.exec("cat /tmp/qc-work/.mcp/*.json 2>/dev/null"),
    (t) => t.includes("Authorization"),
    30_000,
  );
  expect(raw).toContain("Authorization");
  const cfg: Json = JSON.parse(raw);
  return String(cfg?.mcpServers?.hub?.headers?.Authorization ?? "").replace(/^Bearer\s+/, "");
}

const toolsOf = async (token: string): Promise<Json[]> =>
  (await mcp(s.hub, token, "tools/list")).json?.result?.tools ?? [];

describe("S02 · MCP thật: tools/list, mô tả mới ≤ 5 s, token hết hạn [AC-H12 · HUB-H2a-AC-05]", () => {
  it("HUB-FR-50 · S02 · #fake:mcp-list → tên + mô tả; sửa Admin → mô tả mới ≤ 5 s; token sau run → 401 [AC-H12 · AC-05]", async () => {
    const conv = await insertConv(s.sql, "lan", "a2a30000-0000-4000-8000-000000000201");
    const token = await s.token("lan");
    const run = await send(
      s.hub,
      token,
      conv,
      "#fake:delegate=hoadon #fake:mcp-list #fake:sleep=15",
    );
    expect(run.status).toBe(200);
    const jobToken = await tokenFromFile();
    expect(jobToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const before = await toolsOf(jobToken);
    expect(before.map((t) => t?.name)).toEqual(["check-invoice"]);

    const t0 = Date.now();
    await catalogChange(
      s.sql,
      (tx) =>
        tx`update admin.workflows set description = ${NEW_DESC}, updated_at = now() where id = ${WF.checkInvoice}`,
    );
    const after = await waitFor(
      () => toolsOf(jobToken),
      (ts) => ts[0]?.description === NEW_DESC,
      5_000,
    );
    expect(after[0]?.description).toBe(NEW_DESC);
    expect(Date.now() - t0).toBeLessThanOrEqual(5_000);

    const end = await run.terminal(60_000);
    run.close();
    expect(end?.event).toBe("run.finished");
    expect(deltaText(run.events)).toContain("check-invoice");
    expect((await mcp(s.hub, jobToken, "tools/list")).status).toBe(401);

    const again = await send(s.hub, token, conv, "#fake:delegate=hoadon #fake:mcp-list");
    const end2 = await again.terminal(60_000);
    again.close();
    expect(end2?.event).toBe("run.finished");
    expect(deltaText(again.events)).toContain(NEW_DESC);
  }, 200_000);
});
