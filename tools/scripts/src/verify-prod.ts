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
// CR-119: Community không còn host riêng (community.<d> đã gỡ) — nằm ở app.<d>/community/.
const TARGETS: ReadonlyArray<readonly [string, string]> = [
  ["ai-admin", `https://ai-admin.${DOMAIN}`],
  ["ai", `https://ai.${DOMAIN}`],
  ["app", `https://app.${DOMAIN}`],
  ["community", `https://app.${DOMAIN}/community/`],
];
// `</dev/null`: script đi qua stdin (`bash -s`) — `exec` không được nuốt phần còn lại của script (lỗi cũ: mọi dòng sau vòng MIG không chạy).
const PSQL =
  "docker compose -p sohoptac2 exec -T pg psql -U s2_owner -d ai_system -X -At </dev/null";

// Chỉ đọc: head/psql select/logs. Chạy qua `bash -s`; không ghi file, không `up/down/exec` ngoài psql select.
const SCRIPT = `cd ${PROD_DIR} || exit 3
echo "VERSION:$(head -n 1 VERSION 2>/dev/null)"
for t in $(${PSQL} -c "select table_schema||'.'||table_name from information_schema.tables where table_name like '\\_\\_drizzle\\_migrations%' order by 1"); do
  echo "MIG:$t:$(${PSQL} -c "select count(*) from $t")"
done
# Cấu hình prod ĐỒNG BỘ bản test (người dùng 2026-11-16). So mọi khoá cấu hình thường; bỏ bí mật + khoá theo môi trường. Chỉ in tên
# khoá + ok/lệch — KHÔNG in giá trị .env (CLAUDE.md §2). Ngoại lệ có chủ ý: APP_ENV, FILEBOX_ORG (nhãn kho), AI_SUB_MAX_CONCURRENCY
# (bản test dùng chung đăng nhập AI của prod ⇒ test 1 lượt để không giành lượt của prod), TRELLO_* (góp ý vào Trello chỉ ở prod — người dùng 2026-11-16).
STG=../sohoptac2-staging/.env
SKIP='PASSWORD|SECRET|TOKEN|KEY|_URL|DATABASE|HOST|ORIGIN|DOMAIN|COOKIE|JWT|PEPPER|SALT|CORS|PUBLIC|UID|PORT|PROJECT|_USER|DOCUSIGN|DIFY|DLC_|SEED|^S2_|^APP_ENV$|^FILEBOX_ORG$|^AI_SUB_MAX_CONCURRENCY$|^TRELLO_'
if [ -f "$STG" ]; then
  for k in $(grep -oE '^[A-Z][A-Z0-9_]*' .env | grep -vE "$SKIP" | sort -u); do
    [ "$(grep -m1 "^$k=" .env | cut -d= -f2-)" = "$(grep -m1 "^$k=" "$STG" | cut -d= -f2-)" ] && echo "CFG:$k:ok" || echo "CFG:$k:lệch"
  done
else echo "CFG:BAN_TEST_ENV:lệch"; fi
echo "LOGS-BEGIN"
docker compose -p sohoptac2 logs --since 10m --no-color 2>&1 | grep -iE 'error|fatal|exception|unhandled|panic' | tail -n 300
`;

async function health(): Promise<Health[]> {
  return Promise.all(
    TARGETS.map(async ([h, url]) => {
      try {
        const r = await fetch(url, {
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
  // 2026-11-16: prod còn HUB_PROCESS_ROUTES=admin, ESIGN_PROVIDERS có docusign sandbox, HUB_ATTACH_DRIVER khác bản test ⇒ so toàn bộ.
  const cfg = [...out.matchAll(/^CFG:(\w+):(\S+)$/gm)].map((m) => ({
    key: m[1],
    ok: m[2] === "ok",
  }));
  const bad = [
    !version,
    ...mig.map((m) => !m.ok),
    ...hs.map((h) => !healthOk(h)),
    ...cfg.map((c) => !c.ok),
  ].filter(Boolean).length;
  const lines = [
    `prod: VERSION ${version ? `${version.commit} (${version.ref})` : "?? không đọc được"}`,
    `migration: ${mig.map((m) => `${m.table.split(".").pop()?.replace("__drizzle_migrations", "main") || "main"}=${m.applied}${m.expected === null ? "" : m.ok ? "✓" : `≠${m.expected}`}`).join(" ")}`,
    `health: ${hs.map((h) => `${h.host}=${h.status}`).join(" ")}`,
    `cấu hình so với bản test: ${
      cfg.length
        ? cfg
            .filter((c) => !c.ok)
            .map((c) => `${c.key} LỆCH`)
            .join(" ") || `${cfg.length} khoá khớp`
        : "?? không đọc được"
    }`,
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
