// CR-055 · ADM-FR-20 · ADM-FR-30 · ADM-BR-10 (đã đổi) · command được phép "chưa gắn feature": tạo/sửa với
// feature_ids [] → 201/200; xoá feature có command độc quyền → 204, command còn với feature_ids []; core vẫn
// CORE_FEATURE_PROTECTED; tab "Ai dùng được" của command chưa gắn feature rỗng.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { CommandSchema } from "@ai/contracts";
import { ALL_CATALOG, ID } from "../M2/_data";
import { createM2Env, expectErr, type M2Env, type Res } from "../M2/_fixtures";

let env: M2Env;
beforeAll(async () => {
  env = await createM2Env({ catalog: ALL_CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(ALL_CATALOG);
});

const as = async (method: string, path: string, body?: unknown): Promise<Res> =>
  env.call(method, path, { token: await env.admin(), body });
const links = async (cid: string): Promise<number> =>
  (
    await env.owner`select count(*)::int as n from admin.feature_commands where command_id = ${cid}`
  )[0]?.n as number;
const newCommand = (over: Record<string, unknown> = {}) => ({
  name: "khong-feature",
  description: { vi: "Command chưa gắn feature" },
  workflow_id: ID.workflow.translate,
  args: [
    { name: "lang", description: { vi: "Ngôn ngữ" } },
    { name: "text", description: { vi: "Văn bản" }, rest: true },
  ],
  input_map: {
    source_text: { source: "arg", value: "text" },
    target_lang: { source: "arg", value: "lang" },
  },
  output: { field: "text", render: "markdown" },
  ...over,
});

describe("CR-055 · command chưa gắn feature", () => {
  it("CR-055 · POST feature_ids [] → 201, CommandSchema hợp lệ, feature_ids [] và features []; GET + danh sách trả features []", async () => {
    const res = await as("POST", "/admin/commands", newCommand({ feature_ids: [] }));
    expect(res.status).toBe(201);
    const c = CommandSchema.parse(res.json);
    expect(c.feature_ids).toEqual([]);
    expect(c.features).toEqual([]);
    expect(await links(c.id)).toBe(0);
    const got = await as("GET", `/admin/commands/${c.id}`);
    expect(got.json.feature_ids).toEqual([]);
    const list = await as("GET", "/admin/commands?q=khong-feature");
    expect(list.json.items.map((i: { features: unknown[] }) => i.features)).toEqual([[]]);
  });

  it("CR-055 · POST không gửi feature_ids → vẫn mặc định core (không đổi hành vi cũ)", async () => {
    const res = await as("POST", "/admin/commands", newCommand());
    expect(res.status).toBe(201);
    expect(res.json.feature_ids).toEqual([await env.coreId()]);
  });

  it("CR-055 · PATCH feature_ids [] → 200, bỏ hết hàng feature_commands; PATCH lại [core] → gắn lại", async () => {
    const p = await as("PATCH", `/admin/commands/${ID.command.dich}`, {
      version: 1,
      feature_ids: [],
    });
    expect(p.status).toBe(200);
    expect(p.json.feature_ids).toEqual([]);
    expect(await links(ID.command.dich)).toBe(0);
    const core = await env.coreId();
    const back = await as("PATCH", `/admin/commands/${ID.command.dich}`, {
      version: p.json.version,
      feature_ids: [core],
    });
    expect(back.status).toBe(200);
    expect(back.json.feature_ids).toEqual([core]);
  });

  it("CR-055 · tab 'Ai dùng được' của command chưa gắn feature → không tenant nào", async () => {
    await as("PATCH", `/admin/commands/${ID.command.trNhanh}`, { version: 1, feature_ids: [] });
    const a = await as("GET", `/admin/commands/${ID.command.trNhanh}/access`);
    expect(a.status).toBe(200);
    expect(a.json.items).toEqual([]);
    expect(a.json.total).toBe(0);
  });
});

describe("CR-055 · xoá / sửa feature làm command mồ côi", () => {
  it("CR-055 · DELETE feature có command độc quyền (ke-toan ⊃ kiemtra-hoadon) → 204; command còn, feature_ids []", async () => {
    const del = await as("DELETE", `/admin/features/${ID.feature.keToan}`);
    expect(del.status).toBe(204);
    const c = await as("GET", `/admin/commands/${ID.command.kiemtraHoadon}`);
    expect(c.status).toBe(200);
    expect(c.json.feature_ids).toEqual([]);
    expect(c.json.features).toEqual([]);
  });

  it("CR-055 · PATCH feature bỏ command độc quyền → 200; command còn với feature_ids []", async () => {
    const res = await as("PATCH", `/admin/features/${ID.feature.keToan}`, {
      version: 1,
      command_ids: [],
    });
    expect(res.status).toBe(200);
    expect(res.json.commands).toEqual([]);
    expect(await links(ID.command.kiemtraHoadon)).toBe(0);
  });

  it("CR-055 · core vẫn không xoá được → 409 CORE_FEATURE_PROTECTED", async () => {
    expectErr(
      await as("DELETE", `/admin/features/${await env.coreId()}`),
      "CORE_FEATURE_PROTECTED",
    );
  });
});
