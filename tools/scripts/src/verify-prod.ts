// `bun run verify:prod [--json]` — smoke SAU deploy, CHỈ ĐỌC: VERSION, số migration đã áp (so với journal tại commit prod), health các host công khai,
// log lỗi 10 phút gần nhất (docker compose -p sohoptac2; đã che giá trị nhạy cảm). Thoát 0 = xanh, 1 = có vấn đề, 2 = không đọc được prod.

import { repoRoot } from "./lib/git";
import {
  compareMigrations,
  errorLogSummary,
  type Health,
  healthOk,
  journalCount,
  parseApplied,
  parseVersionLine,
  render,
} from "./verify.rules";
import { git, PROD_DIR, sshRead } from "./verify-lib";

const DOMAIN = "evoluconsulting.com";
const HOSTS = ["ai-admin", "ai", "app", "community"];
const PSQL = "docker compose -p sohoptac2 exec -T pg psql -U s2_owner -d ai_system -X -At";

// Chỉ đọc: head/psql select/logs. Chạy qua `bash -s`; không ghi file, không `up/down/exec` ngoài psql select.
const SCRIPT = `cd ${PROD_DIR} || exit 3
echo "VERSION:$(head -n 1 VERSION 2>/dev/null)"
for t in $(${PSQL} -c "select table_schema||'.'||table_name from information_schema.tables where table_name like '\\_\\_drizzle\\_migrations%' order by 1"); do
  echo "MIG:$t:$(${PSQL} -c "select count(*) from $t")"
done
echo "LOGS-BEGIN"
docker compose -p sohoptac2 logs --since 10m --no-color 2>&1 | grep -iE 'error|fatal|exception|unhandled|panic' | tail -n 300
`;

async function health(): Promise<Health[]> {
  return Promise.all(
    HOSTS.map(async (h) => {
      try {
        const r = await fetch(`https://${h}.${DOMAIN}`, {
          signal: AbortSignal.timeout(15_000),
          redirect: "follow",
        });
        return { host: h, status: r.status } as Health;
      } catch {
        return { host: h, status: "down" } as Health;
      }
    }),
  );
}

async function main(): Promise<number> {
  const json = process.argv.includes("--json");
  let out = "";
  try {
    out = sshRead(SCRIPT, 90_000);
  } catch (e) {
    console.log(
      json
        ? JSON.stringify({ ok: false, error: (e as Error).message })
        : `prod: ${(e as Error).message}`,
    );
    return 2;
  }
  const version = parseVersionLine(/^VERSION:(.*)$/m.exec(out)?.[1] ?? "");
  const root = repoRoot();
  const jc = (dir: string) =>
    version
      ? journalCount(
          git(root, ["show", `${version.commit}:packages/db/${dir}/meta/_journal.json`]).out,
        )
      : 0;
  const applied = parseApplied(out);
  const expected = Object.fromEntries(
    [
      "migrations",
      "migrations-hub",
      ...applied
        .map((a) => /pack_(.+)$/.exec(a.table)?.[1])
        .filter(Boolean)
        .map((k) => `migrations-pack-${String(k).replaceAll("_", "-")}`),
    ].map((d) => [d, jc(d) || undefined]),
  );
  const mig = compareMigrations(applied, expected);
  const logs = errorLogSummary(out.split("LOGS-BEGIN")[1] ?? "");
  const hs = await health();
  const bad = [!version, ...mig.map((m) => !m.ok), ...hs.map((h) => !healthOk(h))].filter(
    Boolean,
  ).length;
  const lines = [
    `prod: VERSION ${version ? `${version.commit} (${version.ref})` : "?? không đọc được"}`,
    `migration: ${mig.map((m) => `${m.table.split(".").pop()?.replace("__drizzle_migrations", "main") || "main"}=${m.applied}${m.expected === null ? "" : m.ok ? "✓" : `≠${m.expected}`}`).join(" ")}`,
    `health: ${hs.map((h) => `${h.host}=${h.status}`).join(" ")}`,
    `log lỗi 10 phút: ${logs.total}${
      logs.total
        ? ` (${Object.entries(logs.byService)
            .map(([k, v]) => `${k}:${v}`)
            .join(", ")})`
        : ""
    }`,
    ...logs.samples.slice(0, 3).map((s) => `  ${s}`),
    bad ? `KẾT LUẬN: ${bad} mục lệch` : "KẾT LUẬN: xanh",
  ];
  console.log(render(json, { ok: bad === 0, version, migrations: mig, health: hs, logs }, lines));
  return bad ? 1 : 0;
}

process.exit(await main());
