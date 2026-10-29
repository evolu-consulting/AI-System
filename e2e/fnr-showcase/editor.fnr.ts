// CR-103 · e2e editor quy trình (admin-web `/processes/:id`) cho node registry: đổi loại node (Ghi giá trị / Nếu / agent…), chặn đổi
// theo `field_ref`, kéo node sang bước khác, If phải đứng riêng, If không trỏ tới bước có Hành động thật. Dùng stack của
// `playwright.fnr.config.ts` (Hub thật + Runtime giả + admin-web). Mỗi ca tự dựng def riêng qua API (key ngẫu nhiên) ⇒ không phụ thuộc thứ tự.
import { expect, type Page, test } from "@playwright/test";
import { PA_E2E } from "../P-a/_pa-data";
import { ADMIN_URL, adminLogin, hub, rtReset, settle, tok as tokOf } from "../P-a/_pa-support";

test.afterEach(() => settle());

const tok = (_w: "Adm") => tokOf("Adm");

// biome-ignore lint/suspicious/noExplicitAny: json theo contract
type Json = any;
const FNR_GROUP = "f4a00000-0000-4000-8000-000000000001"; // `_seed.ts` (Pháp chế flow mẫu)
const uniq = (p: string) =>
  `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

type F = { key: string; type: "number" | "string" | "date"; required: boolean };
const num = (key: string): F => ({ key, type: "number", required: true });
const str = (key: string): F => ({ key, type: "string", required: true });
const setEx = (key: string, value: string | number) => ({
  kind: "set",
  values: [{ key, from: { const: value } }],
});
const agentEx = { kind: "agent", agent_id: PA_E2E.agentRead };
const review = (group_id = FNR_GROUP) => ({
  kind: "review",
  group_id,
  back_to_steps: [],
  remind_every_h: null,
  escalate: null,
  branch: [],
  exclude_starter: false,
});
const auto = { kind: "auto", branch: [] };

function mkStage(
  key: string,
  name: string,
  step: number,
  executor: Json,
  fields: F[],
  o: { after?: Json; real?: boolean } = {},
): Json {
  const sections = executor.kind === "set" ? ["Kết quả"] : ["Kết quả"];
  return {
    key,
    name,
    step,
    executor,
    instruction: executor.kind === "agent" ? `Thực hiện ${name}.` : "",
    output: {
      filename: `${key}.md`,
      template: `# ${name}\n\n## Kết quả\n`,
      required_sections: sections,
      fields,
    },
    after: o.after ?? auto,
    real_action: o.real ?? false,
    answerer: { kind: "starter" },
    timeout_s: 600,
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

const AMOUNT_INPUT = [{ key: "amount", label: "Số tiền", type: "number", required: true }];

/** Tạo def qua Hub (Adm); trả `{ id, key, name }`. */
async function createDef(
  prefix: string,
  stages: Json[],
  inputs: Json[] = [],
  base: Json = {},
): Promise<{ id: string; key: string; name: string }> {
  const key = uniq(prefix);
  const name = `FNR ${key}`;
  const body = {
    key,
    name,
    description: "e2e editor CR-103",
    input_hint: "",
    run_group_ids: [],
    token_budget: null,
    enabled: true,
    sources: [],
    ...base,
    inputs,
    stages,
  };
  const r = await hub(await tok("Adm"), "POST", "/process-defs", body);
  expect(r.status, `POST /process-defs ${JSON.stringify(r.json).slice(0, 400)}`).toBeLessThan(300);
  return { id: r.json.id as string, key, name };
}
const getDef = async (id: string): Promise<Json> => {
  const r = await hub(await tok("Adm"), "GET", `/process-defs/${id}`);
  expect(r.status, `GET /process-defs/${id}: ${JSON.stringify(r.json).slice(0, 300)}`).toBe(200);
  return r.json;
};

async function openEditor(p: Page, id: string, login = true): Promise<void> {
  if (login) await adminLogin(p);
  await p.goto(`${ADMIN_URL}/processes/${id}`);
  await expect(canvas(p)).toBeVisible();
}
const canvas = (p: Page) => p.getByRole("application", { name: "Canvas quy trình" });
const panel = (p: Page) => p.getByRole("complementary", { name: "Chi tiết giai đoạn" });
const node = (p: Page, name: string) =>
  canvas(p).getByRole("button", { name: new RegExp(`^Giai đoạn \\d+: ${name}`) });
const stepSpin = (p: Page) => panel(p).getByRole("spinbutton", { name: "Chạy ở bước" });
const execBox = (p: Page) => panel(p).getByRole("combobox", { name: "Người thực hiện" });
async function save(p: Page): Promise<{ status: number; json: Json }> {
  const put = p.waitForResponse(
    (r) => r.request().method() === "PUT" && /\/process-defs\//.test(r.url()),
  );
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  const r = await put;
  return { status: r.status(), json: await r.json().catch(() => null) };
}

test("CR-103 · editor · A · đổi node Hoàn tất từ Ghi giá trị sang agent ⇒ Lưu 200 ⇒ tải lại còn ⇒ chạy 50tr: stage chạy bằng agent và run xong", async ({
  page: p,
}) => {
  await adminLogin(p);
  // bản sao flow mẫu (seed `_seed.ts`)
  const t = await tok("Adm");
  const list = await hub(t, "GET", "/process-defs?include_templates=false&limit=100");
  const row = ((list.json?.items ?? []) as Json[]).find(
    (d) => d.key === "flow-showcase" || /mẫu/.test(d.name),
  );
  expect(row, "def flow mẫu đã seed").toBeTruthy();
  const src = (await hub(t, "GET", `/process-defs/${row.id}`)).json;
  const copy = await createDef("fnr-ed-a", src.stages, src.inputs, {
    description: src.description,
    input_hint: src.input_hint,
    run_group_ids: src.run_group_ids,
  });

  await openEditor(p, copy.id, false);
  await node(p, "Hoàn tất").click();
  await expect(execBox(p)).toContainText("Ghi giá trị");
  await execBox(p).click();
  await p.getByRole("option", { name: "Ghi sổ HĐ" }).click();
  await expect(execBox(p)).toContainText("Ghi sổ HĐ");
  // trường `ket_qua` (bắt buộc) do node Ghi giá trị khai báo được giữ nguyên khi đổi; agent giả không sinh trường có cấu trúc ⇒ bỏ trường
  await panel(p).getByRole("button", { name: "Xoá trường 1" }).click();
  const r = await save(p);
  expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);

  await p.reload();
  await node(p, "Hoàn tất").click();
  await expect(execBox(p)).toContainText("Ghi sổ HĐ");
  const saved = await getDef(copy.id);
  const last = saved.stages.find((s: Json) => s.key === "hoan-tat");
  expect(last.executor).toMatchObject({ kind: "agent", agent_id: PA_E2E.agentPost });

  // chạy 50 triệu + "mua sắm" ⇒ nhánh else ⇒ "Hoàn tất" (stage_idx 5) chạy bằng Runtime
  await rtReset();
  const start = await hub(t, "POST", `/process-defs/${copy.id}/run`, {
    input: "",
    inputs: [
      { type: "number", key: "amount", value: "50000000" },
      { type: "text", key: "purpose", text: "mua sắm" },
    ],
  });
  expect(start.status, JSON.stringify(start.json).slice(0, 300)).toBeLessThan(300);
  const runId = start.json.id as string;
  let lastView = "";
  const view = async (): Promise<Json> => {
    const r = await hub(t, "GET", `/process-runs/${runId}`);
    if (r.json?.status === "needs_decision")
      throw new Error(
        `needs_decision: ${JSON.stringify(r.json?.decision)} stages=${JSON.stringify(r.json?.stages?.[5])}`,
      );
    lastView = `${r.status} ${r.json?.status} ${JSON.stringify((r.json?.stages ?? []).map((s: Json) => [s.idx, s.executor?.kind, s.status]))} ${JSON.stringify(r.json?.decision ?? null)}`;
    return r.json;
  };
  await expect
    .poll(
      async () => {
        const v = await view();
        for (const task of (v.my_tasks ?? []) as Json[])
          if (task.can_act !== false)
            await hub(t, "POST", `/review-tasks/${task.id}/decision`, { result: "pass" });
        return v.status;
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toBe("done")
    .catch((e) => {
      throw new Error(`${e.message}\nlast run view: ${lastView}`);
    });
  const v = await view();
  expect(v.stages[5].executor.kind).toBe("agent");
  expect(v.stages[5].status).toBe("done");
  expect(v.stages[5].outputs.length, "agent sinh output").toBeGreaterThan(0);
  expect(v.stages[4].status).toBe("skipped");
});

test("CR-103 · editor · B · đổi node bị chặn khi bước sau dùng trường: loại không có trường bị vô hiệu kèm lý do, loại khác họ còn trường vẫn chọn được", async ({
  page: p,
}) => {
  const d = await createDef(
    "fnr-ed-b",
    [
      mkStage("thu-thap", "Thu thập", 0, setEx("amount", 7), [num("amount")]),
      mkStage(
        "kiem-tra",
        "Kiểm tra",
        1,
        {
          kind: "if",
          when: {
            op: "and",
            conds: [
              {
                from: { kind: "field", stage_key: "thu-thap", field: "amount" },
                op: "gt",
                value: 10,
              },
            ],
          },
          then_step: 2,
          else_step: 3,
        },
        [],
      ),
      mkStage("dung", "Nhánh Đúng", 2, setEx("kq", "đúng"), [str("kq")]),
      mkStage("sai", "Nhánh Sai", 3, setEx("kq", "sai"), [str("kq")]),
    ],
    AMOUNT_INPUT,
  );
  await openEditor(p, d.id);
  await node(p, "Thu thập").click();
  await execBox(p).click();
  const reason = /Giai đoạn kiem-tra còn dùng trường “amount” của giai đoạn này\./;
  for (const none of ["Chờ tới ngày", "Nếu (rẽ Đúng/Sai)", "Áp bản sửa"]) {
    const o = p.getByRole("option", { name: none });
    await expect(o, `${none} bị khoá`).toHaveAttribute("aria-disabled", "true");
    await expect(o).toHaveAttribute("title", reason);
  }
  // khác họ nhưng vẫn có trường (agent, tool) ⇒ chọn được
  for (const ok of ["Đọc HĐ", "Gọi tool"])
    await expect(p.getByRole("option", { name: ok }), `${ok} chọn được`).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  // đổi sang agent: cho phép (cross-family)
  await p.getByRole("option", { name: "Đọc HĐ" }).click();
  await expect(execBox(p)).toContainText("Đọc HĐ");
});

test("CR-103 · editor · C · kéo node sang cột bước khác ⇒ bước đổi ⇒ Lưu ⇒ tải lại vẫn ở bước đó", async ({
  page: p,
}) => {
  const d = await createDef("fnr-ed-c", [
    mkStage("mot", "Mở đầu", 0, setEx("a", "mot"), [str("a")]),
    mkStage("hai", "Giữa", 1, setEx("b", "hai"), [str("b")]),
    mkStage("ba", "Cuối", 2, setEx("c", "ba"), [str("c")]),
  ]);
  await openEditor(p, d.id);
  const src = node(p, "Cuối");
  const dst = node(p, "Giữa");
  await src.scrollIntoViewIfNeeded();
  const a = await src.boundingBox();
  const b = await dst.boundingBox();
  expect(a && b, "toạ độ node").toBeTruthy();
  if (!a || !b) return;
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await p.mouse.down();
  await p.mouse.move(b.x + b.width / 2, b.y + b.height + 40, { steps: 12 });
  await p.mouse.up();
  await src.click();
  await expect(stepSpin(p)).toHaveValue("2");
  const r = await save(p);
  expect(r.status, JSON.stringify(r.json).slice(0, 300)).toBe(200);
  await p.reload();
  await node(p, "Cuối").click();
  await expect(stepSpin(p)).toHaveValue("2");
  const saved = await getDef(d.id);
  expect(saved.stages.find((s: Json) => s.key === "ba").step).toBe(1);
});

test("CR-103 · editor · D · đưa giai đoạn khác vào bước của node Nếu ⇒ Lưu bị từ chối với thông báo IF_INVALID, không lưu gì", async ({
  page: p,
}) => {
  const d = await createDef(
    "fnr-ed-d",
    [
      mkStage("nhap", "Nhập", 0, setEx("amount", 5), [num("amount")]),
      mkStage(
        "ktra",
        "Kiểm tra",
        1,
        {
          kind: "if",
          when: {
            op: "and",
            conds: [
              {
                from: { kind: "field", stage_key: "nhap", field: "amount" },
                op: "gt",
                value: 10,
              },
            ],
          },
          then_step: 2,
          else_step: null,
        },
        [],
      ),
      mkStage("dich", "Đích", 2, setEx("kq", "x"), [str("kq")]),
      mkStage("phu", "Phụ", 3, setEx("kq", "y"), [str("kq")]),
    ],
    AMOUNT_INPUT,
  );
  await openEditor(p, d.id);
  await node(p, "Phụ").click();
  // đặt "Phụ" vào bước 2 (bước của node Nếu): cùng thao tác chuyển bước như kéo sang cột đó
  await stepSpin(p).fill("2");
  await stepSpin(p).blur();
  const r = await save(p).catch(() => null);
  const msg = "Điều kiện Nếu chưa hợp lệ";
  await expect(p.getByRole("alert").filter({ hasText: msg }).first()).toBeVisible();
  if (r) expect(r.status).toBeGreaterThanOrEqual(400);
  const saved = await getDef(d.id);
  expect(saved.stages.find((s: Json) => s.key === "phu").step).toBe(3);
});

test("CR-103 · editor · E · node Nếu trỏ tới bước có Hành động thật ⇒ Lưu bị chặn với thông báo lỗi, def không đổi", async ({
  page: p,
}) => {
  const d = await createDef(
    "fnr-ed-e",
    [
      mkStage("duyet-a", "Duyệt A", 0, agentEx, [], { after: review() }),
      mkStage("duyet-b", "Duyệt B", 1, agentEx, [], { after: review() }),
      mkStage("thuc-hien", "Thực hiện", 2, agentEx, [], { real: true }),
    ],
    AMOUNT_INPUT,
  );
  await openEditor(p, d.id);
  await node(p, "Duyệt B").click();
  await execBox(p).click();
  await p.getByRole("option", { name: "Nếu (rẽ Đúng/Sai)" }).click();
  const ifx = panel(p).getByTestId("stage-if");
  await expect(ifx).toBeVisible();
  await ifx.getByRole("combobox", { name: "Nếu" }).first().click();
  await p.getByRole("option", { name: /^amount/ }).click();
  await ifx
    .getByRole("textbox", { name: "Giá trị" })
    .or(ifx.getByLabel("Giá trị"))
    .first()
    .fill("1");
  await ifx.getByRole("combobox", { name: "Đúng thì tới bước" }).click();
  await p.getByRole("option", { name: "Bước 3" }).click();
  const puts: string[] = [];
  p.on("request", (q) => q.method() === "PUT" && puts.push(q.url()));
  await p.getByRole("button", { name: "Lưu", exact: true }).click();
  // lỗi hiện ngay trong khối "Nếu" (chặn ở client, không gửi PUT)
  await expect(ifx.getByText(/Điều kiện Nếu chưa hợp lệ/).first()).toBeVisible();
  expect(puts, "không gửi PUT").toEqual([]);
  const saved = await getDef(d.id);
  expect(saved.stages.find((s: Json) => s.key === "duyet-b").executor.kind).toBe("agent");
});
