/// <reference lib="dom" />
// UAT P-d2 · helper dùng chung: step() không dừng khi FAIL (ghi result.jsonl), shot() chụp vào thư mục evidence (PNG nén,
// ≤ 300 KB: lớn hơn ⇒ chuyển JPEG), seed UAT (tool thật qua Dify giả :5390), điều khiển Dify giả.
import { appendFileSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { encryptSecret, parseMasterKey } from "../../../../../../apps/admin-api/src/lib/secret-crypto";
import { PA_E2E } from "../../../../../../e2e/P-a/_pa-data";
import { ACME, withSql } from "../../../../../../e2e/P-a/_pa-support";
import { PD2_E2E, PD_E2E, seedPd, seedPd2Defs, seedPd2Tools } from "../../../../../../e2e/P-d/_pd-support";

export const EV = join(process.cwd(), "docs/specs/P-d-durable/evidence/2026-10-18-pd2");
mkdirSync(EV, { recursive: true });
export type R = { id: string; title: string; ok: boolean; note: string; shots: string[] };

export const shot = async (p: Page, name: string, full = false): Promise<string> => {
  const png = join(EV, `${name}.png`);
  await p.screenshot({ path: png, fullPage: full });
  if (statSync(png).size <= 300_000) return `${name}.png`;
  unlinkSync(png);
  const jpg = join(EV, `${name}.jpg`);
  await p.screenshot({ path: jpg, fullPage: full, type: "jpeg", quality: 70 });
  return `${name}.jpg`;
};

/** Chạy một bước; FAIL ⇒ chụp trang + ghi lỗi, KHÔNG ném (các bước sau vẫn chạy). */
export async function step(
  id: string,
  title: string,
  page: Page | undefined,
  fn: () => Promise<string | void>,
): Promise<boolean> {
  let r: R;
  try {
    const note = (await fn()) ?? "";
    r = { id, title, ok: true, note, shots: [] };
  } catch (e) {
    const msg = String((e as Error).message ?? e)
      .split("\n")
      .slice(0, 6)
      .join(" | ");
    const shots: string[] = [];
    if (page) {
      try {
        shots.push(await shot(page, `FAIL-${id}`));
      } catch {
        // trang đóng
      }
    }
    r = { id, title, ok: false, note: msg, shots };
  }
  appendFileSync(join(EV, "result.jsonl"), `${JSON.stringify(r)}\n`);
  console.log(`${r.ok ? "PASS" : "FAIL"} ${id} ${title} ${r.note}`);
  return r.ok;
}

export const note = (id: string, title: string, text: string): void => {
  appendFileSync(
    join(EV, "result.jsonl"),
    `${JSON.stringify({ id, title, ok: false, note: `NOTE/BLOCKED: ${text}`, shots: [] })}\n`,
  );
};

// ---------- Dify giả ----------
const DIFY = "http://127.0.0.1:5390";
export const difyQueue = (q: string[]) =>
  fetch(`${DIFY}/__q`, { method: "POST", body: JSON.stringify({ q }) });
export const difyReset = () => fetch(`${DIFY}/__reset`);
export const difyCalls = async (): Promise<number> => ((await (await fetch(`${DIFY}/__calls`)).json()) as { n: number }).n;

const sid = (n: number) => `d2a70000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const UAT = {
  secret: sid(1),
  defRun: sid(11), // uat-tool: tool → rẽ nhánh → bước 4 (gate Kế toán, quay lại bước 2)
  defSe: sid(12), // uat-se: tool side_effect real_action sau bước tự chạy (D2-49)
  defNum: sid(13), // uat-num: input Số
  defEsc: sid(15), // uat-esc: gate Kế toán nhắc 4h + chuyển cấp 24h tới nhóm Giám đốc
  defSe2: sid(14), // uat-se2: như uat-se nhưng bước trước có gate Kế toán (người Đạt)
} as const;

const stg = (key: string, name: string, step: number, o: Record<string, unknown> = {}) => ({
  key,
  name,
  step,
  executor: { kind: "agent", agent_id: PA_E2E.agentRead },
  instruction: `Thực hiện ${name}.`,
  output: { filename: `${key}.md`, template: "## Kết quả\n", required_sections: ["Kết quả"], fields: [] },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 60,
  token_budget: null,
  sources: [],
  must_know: [],
  ...o,
});
const toolEx = (tool: string) => ({
  kind: "tool",
  tool_key: tool,
  args: { tong_tien: { from: "input", key: "tong-tien" }, ma_kh: { from: "const", value: "KH1" } },
});
const toolOut = (key: string) => ({
  filename: `${key}.md`,
  template: "## Kết quả\n",
  required_sections: ["Kết quả"],
  fields: [
    { key: "so_hd", type: "text", required: false },
    { key: "tong", type: "number", required: false },
  ],
});
const INPUT_TONG = [{ key: "tong-tien", type: "number", label: "Tổng tiền", required: true }];

/** Seed đầy đủ cho UAT P-d2: P-d1 + công tắc tool + def seed P-d2 + tool THẬT (secret mã hoá đúng, base_url = Dify giả). */
export async function seedUat(): Promise<void> {
  await seedPd();
  await seedPd2Tools();
  await seedPd2Defs();
  // biome-ignore lint/style/noNonNullAssertion: env
  const key = parseMasterKey(process.env.SECRET_MASTER_KEY!);
  const sealed = encryptSecret(key, UAT.secret, "uat-dify-app-key");
  await withSql(async (sql) => {
    await sql`insert into admin.secrets (id, name, ciphertext, iv, key_version, last4)
      values (${UAT.secret}, 'UAT_PD2_KEY', ${Buffer.from(sealed.ciphertext)}, ${Buffer.from(sealed.iv)}, ${sealed.keyVersion}, 'uat1')
      on conflict (id) do update set ciphertext = excluded.ciphertext, iv = excluded.iv, key_version = excluded.key_version`;
    await sql`update admin.workflows set secret_id = ${UAT.secret}, base_url = 'http://127.0.0.1:5390/v1'
      where id in (${PD2_E2E.W.id}, ${PD2_E2E.WS.id})`;
    const defs = [
      {
        id: UAT.defRun,
        key: "uat-tool",
        name: "UAT Gọi tool",
        inputs: INPUT_TONG,
        stages: [
          stg("xhd", "Xuất hoá đơn", 0, {
            executor: toolEx("xuat-hoa-don"),
            output: toolOut("xhd"),
            after: { kind: "auto", branch: [{ field: "tong", op: "ge", value: 20000000, goto_step: 3 }] },
          }),
          stg("b1", "Bước hai", 1),
          stg("b2", "Bước ba", 2),
          stg("b3", "Bước bốn", 3, { after: { kind: "review", group_id: PA_E2E.gKeToan, back_to_steps: [1] } }),
        ],
      },
      {
        id: UAT.defSe,
        key: "uat-se",
        name: "UAT Tool tác dụng phụ",
        inputs: INPUT_TONG,
        stages: [
          stg("doc", "Đọc hồ sơ", 0),
          stg("ghi", "Ghi sổ", 1, { executor: toolEx("ghi-so"), output: toolOut("ghi"), real_action: true }),
        ],
      },
      {
        id: UAT.defSe2,
        key: "uat-se2",
        name: "UAT Tool phụ có người Đạt",
        inputs: INPUT_TONG,
        stages: [
          stg("doc", "Đọc hồ sơ", 0, { after: { kind: "review", group_id: PA_E2E.gKeToan } }),
          stg("ghi", "Ghi sổ", 1, { executor: toolEx("ghi-so"), output: toolOut("ghi"), real_action: true }),
        ],
      },
      {
        id: UAT.defEsc,
        key: "uat-esc",
        name: "UAT Chuyển cấp",
        inputs: INPUT_TONG,
        stages: [
          stg("doc", "Đọc hồ sơ", 0, {
            after: { kind: "review", group_id: PA_E2E.gKeToan, remind_every_h: 4, escalate: { after_h: 24, group_id: PD_E2E.gGD } },
          }),
          stg("xong", "Hoàn tất", 1),
        ],
      },
      {
        id: UAT.defNum,
        key: "uat-num",
        name: "UAT Nhập số",
        inputs: INPUT_TONG,
        stages: [stg("doc", "Đọc hồ sơ", 0)],
      },
    ];
    for (const d of defs)
      await sql`insert into hub.process_defs (id, tenant_id, key, name, description, input_hint, run_group_ids, stages,
          token_budget, enabled, version, sources, inputs)
        values (${d.id}, ${ACME}, ${d.key}, ${d.name}, ${`UAT P-d2 ${d.name}.`}, 'x', ${sql.array([PA_E2E.gRun])}::uuid[],
          ${sql.json(d.stages as never)}, null, true, 1, ${sql.json([])}, ${sql.json(d.inputs as never)})
        on conflict (id) do update set stages = excluded.stages, inputs = excluded.inputs, run_group_ids = excluded.run_group_ids,
          version = hub.process_defs.version + 1`;
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  });
}


