// `bun run verify:predeploy [--ref platform/gd0] [--json]` — CHỈ ĐỌC: dòng đầu VERSION trên prod (ssh, như deploy.ps1), commit đó có là tổ tiên
// của ref không, migration mới/mất (admin/hub/pack) giữa hai bản, biến mới trong env.template. Thoát 0 = có thể deploy, 1 = dừng, 2 = không đọc được prod.

import { runEnvContract } from "./env-contract";
import { repoRoot } from "./lib/git";
import {
  listMigrationsByStatus,
  newEnvVars,
  type Predeploy,
  parseVersionLine,
  predeployVerdict,
  render,
} from "./verify.rules";
import { git, opt, PROD_DIR, sshRead } from "./verify-lib";

const ENV = "deploy/prod-sohoptac2/env.template";
const MIG_PATHS = [
  "packages/db/migrations",
  "packages/db/migrations-hub",
  "packages/db/migrations-pack-*",
];

function main(): number {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const ref = opt(argv, "ref") ?? "platform/gd0";
  const root = repoRoot();
  const head = git(root, ["rev-parse", "--short", ref]);
  if (!head.ok) return fail(json, `ref không có: ${ref}`);
  let line = "";
  try {
    line = sshRead(`head -n 1 ${PROD_DIR}/VERSION 2>/dev/null || true`).split(/\r?\n/)[0] ?? "";
  } catch (e) {
    return fail(json, `không đọc được VERSION prod: ${(e as Error).message}`);
  }
  const prod = parseVersionLine(line);
  const known = prod ? git(root, ["cat-file", "-e", `${prod.commit}^{commit}`]).ok : false;
  const ancestor =
    !prod || !known
      ? null
      : git(root, ["merge-base", "--is-ancestor", prod.commit, ref]).code === 0;
  const diff = (f: "A" | "D") =>
    listMigrationsByStatus(
      known && prod
        ? git(root, [
            "diff",
            "--name-status",
            `--diff-filter=${f}`,
            prod.commit,
            ref,
            "--",
            ...MIG_PATHS,
          ]).out
        : "",
      f,
    );
  const show = (c: string) => git(root, ["show", `${c}:${ENV}`]).out;
  const p: Predeploy = {
    prod,
    ancestor,
    added: diff("A"),
    lost: diff("D"),
    envNew: known && prod ? newEnvVars(show(prod.commit), show(ref)) : [],
  };
  const v = predeployVerdict(`${head.out.trim()} (${ref})`, p);
  // Hợp đồng env của kit (thiếu ⇒ cảnh báo, chưa chặn: prod còn thiếu HUB_NOTIFY_MODE/HUB_SMTP_*; bật chặn khi đã bù).
  const ec = runEnvContract(root);
  if (!ec.ok)
    v.lines.push("cảnh báo env-contract:", ...ec.lines.filter((l) => l.startsWith("THIẾU")));
  console.log(
    render(json, { ref, ...p, ok: v.ok, verdict: v.lines }, [
      v.ok ? "predeploy: OK" : "predeploy: DỪNG",
      ...v.lines,
    ]),
  );
  return v.ok ? 0 : 1;
}

function fail(json: boolean, msg: string): number {
  console.log(json ? JSON.stringify({ ok: false, error: msg }) : `predeploy: ${msg}`);
  return 2;
}

process.exit(main());
