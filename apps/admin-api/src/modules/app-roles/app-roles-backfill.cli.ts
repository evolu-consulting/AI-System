// CR-112 S6 · ADM-FR-83: CLI chuẩn hoá vai (dry-run mặc định; `--apply` mới ghi). Chạy bằng quyền chủ migration (DATABASE_URL):
//   bun run admin:roles-backfill [--tenant <key>] [--actor <uuid>] [--apply] [--out <file.json>]
//   prod: docker compose -p sohoptac2 run --rm -T tool apps/admin-api/src/modules/app-roles/app-roles-backfill.cli.ts [--tenant <key>]
// stdout = báo cáo JSON; stderr = tóm tắt dễ đọc từng tenant/gói/vai. Prod: luôn dry-run trước, chỉ `--apply` khi người dùng xác nhận.
import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { createDb } from "@ai/db";
import { type BackfillReport, runRolesBackfill, type TenantReport } from "./app-roles.backfill";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string): never => {
  process.stderr.write(`${JSON.stringify({ error })}\n`);
  process.exit(1);
};

const list = (sign: string, xs: string[]) => (xs.length ? ` ${sign}[${xs.join(",")}]` : "");

function roleLines(t: TenantReport): string[] {
  return t.packs.flatMap((p) =>
    p.roles
      .filter((x) => x.created || x.add.length + x.remove.length + x.agents_added > 0)
      .map(
        (x) =>
          `  ${p.pack}/${x.key} (${x.level}, ${x.members} người)${x.created ? " +vai" : ""}` +
          `${list("+", x.add)}${list("-", x.remove)}${x.agents_added ? ` +agent ${x.agents_added}` : ""}`,
      ),
  );
}

export function summaryLines(r: BackfillReport): string[] {
  const verb = r.mode === "apply" ? "đã" : "sẽ";
  const out: string[] = [];
  const line = (t: TenantReport) =>
    `[${t.tenant_key}] ${verb} tạo ${t.roles_created} vai · thêm ${t.grants_added} grant · gỡ ${t.grants_removed} grant · agent +${t.agent_grants_added}`;
  for (const t of r.tenants) {
    out.push(line(t), ...roleLines(t));
    for (const g of t.outside_roles)
      out.push(`  quyền ngoài vai (giữ nguyên): ${g.group_key} [${g.features.join(",")}]`);
    for (const a of t.above_ceiling)
      out.push(`  vai vượt trần: ${a.pack}/${a.key} (${a.level} > ${a.ceiling ?? "tắt"})`);
  }
  out.push(`${r.mode}: ${r.tenants.length} tenant · ${JSON.stringify(r.totals)}`);
  if (r.mode === "dry-run") out.push("chạy thử — không ghi gì (thêm --apply để ghi)");
  return out;
}

async function main(): Promise<void> {
  const { values: v } = parseArgs({
    options: {
      tenant: { type: "string" },
      actor: { type: "string" },
      apply: { type: "boolean", default: false },
      out: { type: "string" },
    },
  });
  if (v.actor !== undefined && !UUID.test(v.actor)) fail("ACTOR_INVALID");
  const url = process.env.DATABASE_URL ?? fail("MISSING_DATABASE_URL");
  const db = createDb(url, { max: 2 });
  try {
    const report = await runRolesBackfill(db, {
      apply: v.apply === true,
      tenantKey: v.tenant,
      actorId: v.actor ?? null,
    });
    for (const l of summaryLines(report)) process.stderr.write(`${l}\n`);
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (v.out) await writeFile(v.out, json, "utf8");
    process.stdout.write(json);
  } catch (err) {
    fail(
      err instanceof Error && err.message === "TENANT_NOT_FOUND" ? "TENANT_NOT_FOUND" : "FAILED",
    );
  } finally {
    await db.close();
  }
}

if (import.meta.main) await main();
