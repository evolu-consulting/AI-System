// CR-121 F-5 · lỗi e2e cr121-d6b-notify ca 3: chuông "Đã duyệt xong hợp đồng · hop-dong-…" — input run chụp lúc MỞ run (HĐ còn tên
// file, chưa có số). Sửa (a): gói cập nhật input run sau "Xác nhận và lưu" qua `PackRunsPort.updateInputs` (CAS theo version HĐ).
// Hub THẬT (khuôn P-d + cầu packRuns): mở run với tên file ⇒ cập nhật v2 ⇒ bản cũ v1 / lặp v2 / sai bản ghi bị từ chối ⇒ Đạt bước
// duyệt ⇒ Thông báo dùng số + tên đã xác nhận.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import { type CtxPd, defBody, G1, type Json, PA, startPd, T, waitStatus } from "../P-d/_support/pd";

const KEY = "cr121-f5-vars";
const REC = "cf5f0000-0000-4000-8000-000000000005";
const who = (p: { id: string; role: string }): PackRunCaller => ({
  userId: p.id,
  tenantId: T.acme,
  role: p.role,
});
const A = who(PA.A);
const ADM = who(PA.Adm);
const ACTOR = who(PA.T); // cuc — thành viên Kế toán (G1)

const stage = (key: string, step: number, executor: Json, extra: Json = {}): Json => ({
  key,
  name: `Bước ${key}`,
  step,
  executor,
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: `# ${key}\n\n## Kết quả\n`,
    required_sections: ["Kết quả"],
    fields: [],
  },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 60,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
  ...extra,
});
const STAGES = [
  {
    ...stage(
      "s0",
      0,
      { kind: "set", values: [{ key: "v", from: { const: "x" } }] },
      {
        after: { kind: "review", group_id: G1, back_to_steps: [] },
      },
    ),
    output: {
      filename: "s0.md",
      template: "# s0\n\n## Kết quả\n",
      required_sections: ["Kết quả"],
      fields: [{ key: "v", type: "string", required: true }],
    },
  },
  stage("bao", 1, {
    kind: "notify",
    to: [{ who: "starter" }],
    channels: ["bell"],
    title: "Đã duyệt HĐ {contract-number} · {contract-title}",
    body: "",
  }),
];
const INPUTS = [
  { key: "contract-id", label: "HĐ", type: "text", required: true },
  { key: "contract-number", label: "Số HĐ", type: "text", required: false },
  { key: "contract-title", label: "Tên HĐ", type: "text", required: false },
];

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  port = bridge.port;
}, 90_000);
afterAll(async () => {
  if (c) await c.stop();
});

describe("CR-121 F-5 · input run theo HĐ đã xác nhận [R1]", () => {
  it("mở run với tên file ⇒ cập nhật v2 sau xác nhận ⇒ Thông báo dùng số + tên đã xác nhận, v1 cũ / lặp / sai bản ghi bị từ chối", async () => {
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, STAGES, { inputs: INPUTS }), 1)).toBe(
      "created",
    );
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ",
      inputs: [
        { type: "text", key: "contract-id", text: REC },
        { type: "text", key: "contract-title", text: "hop-dong-x.pdf" },
      ],
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await waitStatus(c.sql, s.runId, "waiting_review");
    const ref = { tenantId: T.acme, runId: s.runId, pack: "contracts", recordId: REC };
    const patch = [
      { type: "text" as const, key: "contract-number", text: "HD-09" },
      { type: "text" as const, key: "contract-title", text: "Mua máy chủ" },
    ];
    expect(await port.updateInputs({ ...ref, version: 2 }, patch)).toBe(true);
    const stale = [{ type: "text" as const, key: "contract-title", text: "bản cũ" }];
    expect(await port.updateInputs({ ...ref, version: 1 }, stale)).toBe(false);
    expect(await port.updateInputs({ ...ref, version: 2 }, stale)).toBe(false);
    const other = { ...ref, recordId: "cf5f0000-0000-4000-8000-0000000000ff" };
    expect(await port.updateInputs({ ...other, version: 9 }, stale)).toBe(false);
    expect(await port.act(ACTOR, s.runId, { stage: "s0" }, { result: "pass" })).toBe("ok");
    await waitStatus(c.sql, s.runId, "done");
    const notes = await c.sql<Json[]>`select user_id::text as u, title from hub.notifications
      where dedup_key like ${`pn:${s.runId}:%`}`;
    expect(notes).toEqual([{ u: PA.A.id, title: "Đã duyệt HĐ HD-09 · Mua máy chủ" }]);
    // Run đã kết thúc ⇒ không cập nhật nữa.
    expect(await port.updateInputs({ ...ref, version: 3 }, patch)).toBe(false);
  }, 60_000);
});
