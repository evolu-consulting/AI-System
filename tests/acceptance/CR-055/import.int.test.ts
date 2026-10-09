// CR-055 · ADM-FR-54 · import (transfer) command mới không thuộc feature nào: dry-run không lỗi, áp dụng 200,
// command được tạo và không có hàng feature_commands (trước CR-055: COMMAND_NEEDS_FEATURE).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { createM3Env, importReq, type M3Env } from "../M4/_cd";
import { BAO_CAO_MOI, FILE_NAME, header, toYaml } from "../M4/_transfer-data";

let env: M3Env;
beforeAll(async () => {
  env = await createM3Env();
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset3();
});

const file = () => toYaml({ ...header(), commands: [{ ...BAO_CAO_MOI, workflow: "report-tax" }] });
const body = async () => ({
  file_name: FILE_NAME,
  content: file(),
  base_config_version: await env.cfg(),
});

describe("CR-055 · import command không feature", () => {
  it("CR-055 · dry-run: valid, không lỗi COMMAND_NEEDS_FEATURE; áp dụng → 200, command có, 0 hàng feature_commands", async () => {
    const dry = await importReq(env, await body(), "1");
    expect(dry.status).toBe(200);
    expect(dry.json.valid).toBe(true);
    expect(dry.json.errors).toEqual([]);
    const res = await importReq(env, await body(), "0");
    expect(res.status).toBe(200);
    const rows = await env.owner`select c.id, (select count(*)::int from admin.feature_commands fc
      where fc.command_id = c.id) as n from admin.commands c where c.name = 'bao-cao-moi'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.n).toBe(0);
  });
});
