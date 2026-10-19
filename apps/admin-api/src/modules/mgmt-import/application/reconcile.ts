// I1 · đối soát sau khi ghi: số hàng (ở báo cáo bảng), tổng tiền theo tenant (nguồn độc lập ↔ kế hoạch ↔ đích, phải khớp
// TUYỆT ĐỐI), file (đếm + sha256 nguồn ↔ bytes đọc lại ở kho đích), sha256 văn bản đã ký, mẫu so từng trường, và luật thấy:
// mỗi user nhập thấy ĐÚNG tập HĐ đã thấy ở mgmt-app (mgmt `orgs.Ctx.sees` ↔ RLS thật của gói với `app.user_id`).
import type { Snapshot } from "../domain/context";
import { targetId } from "../domain/ids.rules";
import type { Membership } from "../domain/map-identity.rules";
import type { MoneyKey, Plan, TableName } from "../domain/plan";
import { diffFields, type FieldDiff, mgmtVisible, sourceMoney } from "../domain/reconcile.rules";
import { isObj } from "../domain/values.rules";
import type { ImportDeps, ImportOpts } from "./import.usecase";

type MoneyLine = { source: string; planned: string; target: string; ok: boolean };
export type ReconcileReport = {
  money: Record<string, Partial<Record<MoneyKey, MoneyLine>>>;
  money_ok: boolean;
  files: { jobs: number; found: number; stored: number; checksum_ok: number };
  signed_sha: { source: number; target: number; ok: boolean };
  diffs: FieldDiff[];
  diffs_checked: number;
  visibility: {
    users: number;
    match: number;
    inactive_skipped: number;
    mismatches: { email: string; missing: number; extra: number }[];
  };
};

const ids = (plan: Plan, tid: string): Partial<Record<TableName, string[]>> => {
  const t = plan.tenants.get(tid);
  const out: Partial<Record<TableName, string[]>> = {};
  for (const [k, rows] of Object.entries(t?.rows ?? {}))
    out[k as TableName] = (rows ?? []).filter((r) => r.id).map((r) => String(r.id));
  return out;
};

async function money(
  d: ImportDeps,
  s: Snapshot,
  plan: Plan,
): Promise<Pick<ReconcileReport, "money" | "money_ok">> {
  const orgs = [...plan.tenants.values()].map((t) => t.orgId);
  const src = sourceMoney(s, orgs);
  const out: ReconcileReport["money"] = {};
  let ok = true;
  for (const t of plan.tenants.values()) {
    const tgt = await d.target.money(t.tenantId, ids(plan, t.tenantId));
    const line: Partial<Record<MoneyKey, MoneyLine>> = {};
    for (const k of Object.keys(tgt) as MoneyKey[]) {
      const a = src.get(t.orgId)?.[k] ?? 0n;
      const b = t.money[k] ?? 0n;
      const c = tgt[k] ?? 0n;
      line[k] = {
        source: a.toString(),
        planned: b.toString(),
        target: c.toString(),
        ok: a === b && b === c,
      };
      ok &&= a === b && b === c;
    }
    out[t.orgId] = line;
  }
  return { money: out, money_ok: ok };
}

async function files(
  d: ImportDeps,
  plan: Plan,
  shas: Map<string, string>,
): Promise<ReconcileReport["files"]> {
  let stored = 0;
  let good = 0;
  for (const t of plan.tenants.values()) {
    const want = [...shas.keys()];
    for (const r of await d.target.readBack(t.tenantId, "contracts.files", want)) {
      stored++;
      const bytes = d.files.sink ? await d.files.sink.readBack(String(r.file_id)) : null;
      const sha = bytes ? new Bun.CryptoHasher("sha256").update(bytes).digest("hex") : null;
      if (sha && sha === shas.get(String(r.id))) good++;
    }
  }
  return {
    jobs: shas.size + plan.issues.filter((i) => i.code === "FILE_MISSING").length,
    found: shas.size,
    stored,
    checksum_ok: good,
  };
}

async function signedSha(
  d: ImportDeps,
  s: Snapshot,
  plan: Plan,
): Promise<ReconcileReport["signed_sha"]> {
  const source = new Set((s.docs.signed_docs ?? []).map((x) => `${x.src.org_id}|${x.src.sha256}`))
    .size;
  let target = 0;
  for (const t of plan.tenants.values()) {
    const want = (t.rows["contracts.cks_signed_docs"] ?? []).map((r) => String(r.id));
    target += new Set(
      (await d.target.readBack(t.tenantId, "contracts.cks_signed_docs", want)).map((r) => r.sha256),
    ).size;
  }
  return { source, target, ok: source === target };
}

const fv = (src: Record<string, unknown>, k: string): unknown =>
  isObj(src.fields) && isObj(src.fields[k]) ? src.fields[k].value : null;

async function diffs(
  d: ImportDeps,
  o: ImportOpts,
  s: Snapshot,
  plan: Plan,
): Promise<{ diffs: FieldDiff[]; checked: number }> {
  const out: FieldDiff[] = [];
  let checked = 0;
  for (const t of plan.tenants.values()) {
    const sample = (s.docs.contracts ?? [])
      .filter((c) => c.src.org_id === t.orgId)
      .slice(0, o.diffSample);
    const back = new Map(
      (
        await d.target.readBack(
          t.tenantId,
          "contracts.contracts",
          sample.map((c) => targetId(o.source, "contract", c.id)),
        )
      ).map((r) => [r.id, r]),
    );
    for (const c of sample) {
      const r = back.get(targetId(o.source, "contract", c.id)) ?? {};
      checked++;
      out.push(
        ...diffFields("contract", c.id, [
          ["title", c.src.title, r.title],
          ["number", fv(c.src, "number"), r.number],
          ["total_value", fv(c.src, "total_value"), r.value],
          ["end_date", fv(c.src, "end_date"), r.end_date],
          ["direction", c.src.direction, r.direction],
          ["status", c.src.status, r.status],
          ["supplier_name", fv(c.src, "supplier_name"), r.seller],
          ["buyer_name", fv(c.src, "buyer_name"), r.buyer],
        ]),
      );
    }
    const obs = (s.docs.obligations ?? [])
      .filter((x) => x.src.org_id === t.orgId)
      .slice(0, o.diffSample);
    const ob = new Map(
      (
        await d.target.readBack(
          t.tenantId,
          "contracts.obligations",
          obs.map((x) => targetId(o.source, "obligation", x.id)),
        )
      ).map((r) => [r.id, r]),
    );
    for (const x of obs) {
      const r = ob.get(targetId(o.source, "obligation", x.id)) ?? {};
      checked++;
      out.push(
        ...diffFields("obligation", x.id, [
          ["amount", x.src.amount, r.amount],
          ["due_date", x.src.due_date, r.due_date],
          ["status", x.src.status, r.status],
          ["direction", x.src.direction, r.direction],
        ]),
      );
    }
  }
  return { diffs: out, checked };
}

/** Lệch giữa tập mong đợi và tập thấy thật (chỉ tính HĐ do lần nhập này tạo). */
function compareSets(
  exp: Set<string>,
  seen: Set<string>,
  imported: Set<string>,
): { missing: number; extra: number } {
  const got = new Set([...seen].filter((id) => imported.has(id)));
  return {
    missing: [...exp].filter((x) => !got.has(x)).length,
    extra: [...got].filter((x) => !exp.has(x)).length,
  };
}

/** Email có membership active (mgmt-app chỉ cho membership active vào app). */
const activeOf = (s: Snapshot): Set<string> =>
  new Set(
    (s.docs.memberships ?? [])
      .filter((m) => m.src.status === "active")
      .map((m) => String(m.src.email ?? m.id).toLowerCase()),
  );

async function visibility(
  d: ImportDeps,
  o: ImportOpts,
  s: Snapshot,
  plan: Plan,
  members: Map<string, Membership>,
  userOf: Map<string, string>,
): Promise<ReconcileReport["visibility"]> {
  const res: ReconcileReport["visibility"] = {
    users: 0,
    match: 0,
    inactive_skipped: 0,
    mismatches: [],
  };
  const statusOf = activeOf(s);
  for (const t of plan.tenants.values()) {
    const imported = new Set((t.rows["contracts.contracts"] ?? []).map((r) => String(r.id)));
    for (const m of members.values()) {
      if (m.orgId !== t.orgId) continue;
      const uid = userOf.get(`${t.tenantId}|${m.email}`);
      const want = mgmtVisible(s, members, m.email, statusOf.has(m.email));
      if (!uid || !want) {
        res.inactive_skipped++;
        continue;
      }
      res.users++;
      const exp = new Set([...want].map((id) => targetId(o.source, "contract", id)));
      const diff = compareSets(exp, await d.visible(t.tenantId, uid), imported);
      if (diff.missing + diff.extra === 0) res.match++;
      else res.mismatches.push({ email: m.email, ...diff });
    }
  }
  return res;
}

export async function reconcile(
  d: ImportDeps,
  o: ImportOpts,
  s: Snapshot,
  plan: Plan,
  members: Map<string, Membership>,
  userOf: Map<string, string>,
  shas: Map<string, string>,
): Promise<ReconcileReport> {
  const m = await money(d, s, plan);
  const df = await diffs(d, o, s, plan);
  return {
    ...m,
    files: await files(d, plan, shas),
    signed_sha: await signedSha(d, s, plan),
    diffs: df.diffs,
    diffs_checked: df.checked,
    visibility: await visibility(d, o, s, plan, members, userOf),
  };
}
