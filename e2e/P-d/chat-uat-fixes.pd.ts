// HUB-FR-146 · P-d2 · e2e cho 3 lỗi UAT (REPORT 2026-10-18-pd2): B-D2-1 (ô Số sai ⇒ câu i18n, không bong bóng gốc),
// B-D2-3 (danh sách Lượt chạy admin: run đang thử lại ⇒ "Đang chạy"), B-D2-4 (trang run người khởi tạo có "Đã chuyển cấp").
// Trạng thái dựng bằng SQL (`_pd-support`), không chờ giờ thật.
import { expect, test } from "@playwright/test";
import { roomComposer } from "../chat/_x2a-support";
import { PA_E2E } from "../P-a/_pa-data";
import { ACME } from "../P-a/_pa-support";
import { mkRoom, seedEscalated, seedPd, settle, users, withSql } from "./_pd-support";

test.beforeAll(() => seedPd());
test.afterEach(() => settle());

const NUM_DEF = "d1e20000-0000-4000-8000-0000000000a1";

async function seedNumDef(): Promise<void> {
  const stages = [
    {
      key: "s0",
      name: "Bước một",
      step: 0,
      executor: { kind: "agent", agent_id: PA_E2E.agentRead },
      instruction: "Thực hiện.",
      output: {
        filename: "s0.md",
        template: "## Kết quả\n",
        required_sections: ["Kết quả"],
        fields: [],
      },
      after: { kind: "auto" },
      real_action: false,
      answerer: { kind: "starter" },
      timeout_s: 1800,
      token_budget: null,
      sources: [],
      must_know: [],
    },
  ];
  const inputs = [{ key: "so-tien", type: "number", label: "Số tiền", required: true }];
  await withSql(async (sql) => {
    await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
        token_budget, enabled, version, sources, inputs)
      values (${NUM_DEF}, ${ACME}, 'pd-num-input', 'Nhập số E2E', 'Quy trình e2e ô Số.', 'Mã', ${`{${PA_E2E.gRun}}`}::uuid[],
        ${sql.json(stages as never)}, null, true, 1, ${sql.json([])}, ${sql.json(inputs as never)})
      on conflict (id) do update set stages = excluded.stages, inputs = excluded.inputs,
        version = hub.process_defs.version + 1`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}

test("HUB-FR-146 · B-D2-1 · ô Số gõ sai '1e' ⇒ câu 'Nhập một số hợp lệ.' (không bong bóng gốc), nút khoá; sửa lại ⇒ hết lỗi", async ({
  browser,
}) => {
  await seedNumDef();
  const room = await mkRoom("EPD2B1");
  const u = await users(browser, "A");
  const p = u.A;
  try {
    // Hub nạp def mới theo `hub_config_version`: chờ tới khi picker thấy def (tín hiệu, không ngủ), tải lại phòng nếu chưa.
    await expect(async () => {
      await p.goto(`/rooms/${room.id}`);
      await p.getByRole("button", { name: "Quy trình", exact: true }).click();
      await p
        .getByRole("listbox", { name: "Quy trình" })
        .getByRole("option")
        .filter({ hasText: "!pd-num-input" })
        .click({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(roomComposer(p, "nhóm")).toHaveValue("!pd-num-input ");
    await p.getByRole("button", { name: "Gửi", exact: true }).click();
    const f = p.getByRole("dialog", { name: "Thông tin cho quy trình Nhập số E2E" });
    const num = f.getByLabel("Số tiền");
    await num.fill("1e");
    await expect(f.getByRole("alert")).toHaveText("Nhập một số hợp lệ.");
    await expect(f.getByRole("button", { name: "Bắt đầu quy trình", exact: true })).toBeDisabled();
    await num.fill("25000000");
    await expect(f.getByRole("alert")).toHaveCount(0);
    await expect(f.getByRole("button", { name: "Bắt đầu quy trình", exact: true })).toBeEnabled();
  } finally {
    await u.close();
  }
});

test("HUB-FR-146 · B-D2-4 · người khởi tạo mở /runs/<id> sau chuyển cấp ⇒ 'Đã chuyển cấp' + 'Đang chờ … (đã chuyển cấp) kiểm'", async ({
  browser,
}) => {
  const room = await mkRoom("EPD2B4");
  const r = await seedEscalated(room.id);
  expect(r.ready).toBe(true);
  const u = await users(browser, "A");
  try {
    await u.A.goto(`/runs/${r.runId}`);
    await expect(u.A.getByText("Đã chuyển cấp", { exact: true })).toBeVisible();
    await expect(u.A.getByRole("status").filter({ hasText: "(đã chuyển cấp)" })).toBeVisible();
  } finally {
    await u.close();
  }
});
