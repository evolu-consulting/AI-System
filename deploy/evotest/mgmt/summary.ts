// I1 · tóm tắt 3 báo cáo importer (dry-run, apply, chạy lại) của bản sao evotest-mgmt thành văn bản ngắn (số hàng mỗi bảng,
// tiền theo tenant, file/sha, mẫu lệch, luật thấy, vấn đề, thời gian). Chỉ đọc file JSON.
type T = { planned: number; inserted: number; existing: number };
type Rep = {
  ms: number;
  tables: Record<string, T>;
  read: Record<string, number>;
  no_tenant: Record<string, number>;
  skipped_tables: string[];
  issues_by_code: Record<string, number>;
  reconcile: null | {
    money_ok: boolean;
    money: Record<
      string,
      Record<string, { source: string; planned: string; target: string; ok: boolean }>
    >;
    files: unknown;
    signed_sha: unknown;
    diffs: unknown[];
    diffs_checked: number;
    visibility: { users: number; match: number; inactive_skipped: number; mismatches: unknown[] };
  };
};
const [dry, apply, rerun] = (await Promise.all(
  Bun.argv.slice(2).map((p) => Bun.file(p).json()),
)) as Rep[];
const out: string[] = [];
const sum = (r: Rep | undefined, k: keyof T) =>
  Object.values(r?.tables ?? {}).reduce((s, t) => s + t[k], 0);
out.push(`thời gian: dry ${dry?.ms} ms · apply ${apply?.ms} ms · chạy lại ${rerun?.ms} ms`);
out.push(
  `hàng: kế hoạch ${sum(apply, "planned")} · chèn lần 1 ${sum(apply, "inserted")} · chèn lần 2 ${sum(rerun, "inserted")} (idempotent ⇔ 0)`,
);
for (const [t, c] of Object.entries(apply?.tables ?? {}))
  out.push(
    `  ${t}: ${c.planned} kế hoạch / ${c.inserted} chèn / lần 2 chèn ${rerun?.tables[t]?.inserted ?? 0}`,
  );
out.push(`đọc nguồn: ${JSON.stringify(apply?.read)}`);
out.push(
  `không tenant: ${JSON.stringify(apply?.no_tenant)} · bỏ bảng: ${JSON.stringify(apply?.skipped_tables)}`,
);
out.push(`vấn đề: ${JSON.stringify(apply?.issues_by_code)}`);
const rec = apply?.reconcile;
out.push(`tiền khớp tuyệt đối: ${rec?.money_ok} (chạy lại: ${rerun?.reconcile?.money_ok})`);
for (const [org, m] of Object.entries(rec?.money ?? {}))
  for (const [k, v] of Object.entries(m))
    out.push(
      `  ${org.slice(0, 8)} ${k}: nguồn ${v.source} · đích ${v.target} ${v.ok ? "OK" : "LỆCH"}`,
    );
out.push(
  `file: ${JSON.stringify(rec?.files)} · văn bản ký sha: ${JSON.stringify(rec?.signed_sha)}`,
);
out.push(
  `so trường: ${rec?.diffs_checked} bản ghi, lệch ${rec?.diffs.length}: ${JSON.stringify(rec?.diffs.slice(0, 5))}`,
);
out.push(`luật thấy: ${JSON.stringify(rec?.visibility)}`);
// niti-onboard: `--into-tenant` ⇒ tenant đích + org bị loại
const x = apply as Rep & { into?: unknown; excluded?: unknown; source_orgs?: unknown };
if (x?.into) out.push(`into: ${JSON.stringify(x.into)} · loại: ${JSON.stringify(x.excluded)}`);
if (x?.source_orgs) out.push(`org nguồn: ${JSON.stringify(x.source_orgs)}`);
console.log(out.join("\n"));
