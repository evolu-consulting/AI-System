// dlc-chat-review · GET /pack/dlc/runs/:id/steps/:step: plan đầy đủ cho người được đọc; run không thấy / không quyền ⇒ 404.
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackStepsView } from "../../kit/application/pack-runs.ports";
import type { DlcFlow } from "../application/ports";
import { dlcStepDetail } from "../domain/dlc-detail.rules";
import { type DlcReadDeps, dlcReadRoutes } from "./dlc.routes";

const RUN = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const T = "00000000-0000-4000-8000-0000000000c3";

const flow = {
  id: RUN,
  state: { planText: "# Plan đầy đủ", results: { qc: "QC chi tiết" } },
} as unknown as DlcFlow;
const view = (startedBy: string, canAct = false) =>
  ({
    run_id: RUN,
    status: "waiting_review",
    started_by: startedBy,
    steps: [{ task: canAct ? { id: "t", can_act: true } : null }],
  }) as unknown as PackStepsView;

function app(d: DlcReadDeps, role = "member") {
  const a = new Hono<{ Variables: { user: never } }>();
  a.use("*", async (c, next) => {
    c.set("user", { userId: ME, tenantId: T, role } as never);
    await next();
  });
  a.route("/pack/dlc", dlcReadRoutes(d) as never);
  a.onError((err, c) => c.json(mapError(err).body, mapError(err).status as never));
  return a;
}

const get = (a: ReturnType<typeof app>, step = "spec") =>
  a.request(`/pack/dlc/runs/${RUN}/steps/${step}`);

test("người bắt đầu run đọc được plan đầy đủ của bước spec", async () => {
  const r = await get(app({ stepsView: async () => view(ME), getFlow: async () => flow }));
  expect(r.status).toBe(200);
  expect(await r.json()).toEqual({ step: "spec", text: "# Plan đầy đủ" });
});

test("người quyết được task mở hoặc admin cũng đọc được, thành viên khác ⇒ 404", async () => {
  expect(
    (await get(app({ stepsView: async () => view(OTHER, true), getFlow: async () => flow })))
      .status,
  ).toBe(200);
  expect(
    (await get(app({ stepsView: async () => view(OTHER), getFlow: async () => flow }), "spec"))
      .status,
  ).toBe(404);
  const admin = app(
    { stepsView: async () => view(OTHER), getFlow: async () => flow },
    "tenant_admin",
  );
  expect((await get(admin, "qc")).status).toBe(200);
});

test("run không thấy (khác tenant / RLS) hoặc engine tắt ⇒ 404; khoá bước lạ ⇒ 404", async () => {
  expect((await get(app({ stepsView: async () => null, getFlow: async () => flow }))).status).toBe(
    404,
  );
  expect((await get(app({ getFlow: async () => flow }))).status).toBe(404);
  expect(
    (await get(app({ stepsView: async () => view(ME), getFlow: async () => flow }), "Bad_Step"))
      .status,
  ).toBe(404);
});

test("dlcStepDetail: spec ⇒ planText, bước khác ⇒ kết quả gần nhất, rỗng khi chưa có", () => {
  expect(dlcStepDetail(flow.state, "qc")).toBe("QC chi tiết");
  expect(dlcStepDetail({ report: "Báo cáo" }, "report")).toBe("Báo cáo");
  expect(dlcStepDetail({}, "build")).toBe("");
});
