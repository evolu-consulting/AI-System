// CR-118 · deploy-kit: bất biến của kit prod (web gộp + 301 community) và kit UAT stg-cr118 (cô lập khỏi prod). Thuần: đọc file, không docker/mạng.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";

const root = repoRoot();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const PROD = "deploy/prod-sohoptac2";
const STG = "deploy/stg-cr118";

/** Khối `server { … listen <port>; … }` của nginx.conf (đếm ngoặc). */
function serverBlock(conf: string, port: number): string {
  const at = conf.indexOf(`listen ${port};`);
  if (at < 0) throw new Error(`không thấy listen ${port}`);
  const start = conf.lastIndexOf("server {", at);
  let depth = 0;
  for (let i = conf.indexOf("{", start); i < conf.length; i++) {
    if (conf[i] === "{") depth++;
    if (conf[i] === "}" && --depth === 0) return conf.slice(start, i + 1);
  }
  throw new Error("khối server không đóng");
}

describe("prod kit · web gộp", () => {
  const conf = read(`${PROD}/nginx.conf`);
  it("Dockerfile: build workspace-web (gộp), chat, admin, studio; KHÔNG build/copy community-web", () => {
    const d = read(`${PROD}/Dockerfile`);
    for (const w of ["workspace-web", "chat-web", "admin-web", "studio-web"])
      expect(d).toContain(`--cwd apps/${w} build`);
    expect(d).not.toMatch(/--cwd apps\/community-web build/);
    expect(d).not.toContain("/srv/community");
    expect(d).toContain("/srv/contracts");
  });
  it("host chính (8081): /me/stream → hub; SPA history fallback cho /community/*", () => {
    const b = serverBlock(conf, 8081);
    expect(b).toContain("location = /me/stream { proxy_pass $hub; }");
    expect(b).toContain("location / { try_files $uri $uri/ /index.html; }");
    expect(b).not.toMatch(/location[^{]*\/community/); // không route API trùng tiền tố SPA
  });
  it("CR-119 (2026-11-05): community.<d> bỏ hẳn — không còn server 8085, map 301, cổng 18435, proxy 30 ngày", () => {
    expect(conf).not.toMatch(/listen 8085/);
    expect(conf).not.toContain("s2_main_origin");
    expect(conf).not.toContain("X-S2-Main-Origin");
    const edge = read(`${PROD}/edge/sohoptac2.conf`);
    expect(edge).not.toMatch(/server_name[^\n]*community|__N_COMMUNITY__|__MAIN_|:8085/);
    const c = read(`${PROD}/docker-compose.yml`);
    expect(c).not.toContain("S2_PORT_COMMUNITY");
    expect(c).not.toContain(":8085");
    expect(read(`${PROD}/env.template`)).not.toContain("S2_PORT_COMMUNITY");
    expect(read(`${PROD}/edge-lib.sh`)).not.toMatch(/__N_COMMUNITY__|__MAIN_|community\) p=/);
    const g = read(`${PROD}/gen-env.sh`);
    expect(g).not.toMatch(/P_COMMUNITY|T_CM|P_CM|community-test|community\.\$D/);
    expect(read(`${PROD}/enable-domain.sh`)).not.toContain("community-test");
  });
  it("compose prod + gen-env: COMMUNITY_WEB_URL / catalog community = <SHT>/community", () => {
    const c = read(`${PROD}/docker-compose.yml`);
    expect(c).toContain(
      "COMMUNITY_WEB_URL: ${S2_PUBLIC_COMMUNITY_URL:-http://localhost:18431/community}",
    );
    expect(c).toContain(
      "APP_URL_COMMUNITY: ${S2_PUBLIC_COMMUNITY_URL:-http://localhost:18431/community}",
    );
    const g = read(`${PROD}/gen-env.sh`);
    expect(g).toContain('U_CM="$U_C/community"');
    expect(g).toContain("S2_PUBLIC_COMMUNITY_URL=http://localhost:$P_CONTRACTS/community");
    expect(g).not.toMatch(/U_CM="\$P_CM"|U_CM="\$T_CM"/);
  });
  it("edge: deploy.ps1 vẫn đóng gói đủ kit", () => {
    const d = read(`${PROD}/deploy.ps1`);
    for (const f of ["docker-compose.yml", "Dockerfile", "nginx.conf", "edge/sohoptac2.conf"])
      expect(d).toContain(`"${f}"`);
  });
});

describe("stg-cr118 · cô lập khỏi prod", () => {
  type Svc = {
    image?: string;
    ports?: string[];
    volumes?: string[];
    build?: { args?: Record<string, string> };
  };
  const doc = Bun.YAML.parse(read(`${STG}/docker-compose.yml`)) as {
    name: string;
    services: Record<string, Svc>;
    volumes?: unknown;
  };
  it("project sohoptac2-cr118; image app/web/tool = :cr118, không :latest (trừ filebox/runtime dùng lại)", () => {
    expect(doc.name).toBe("sohoptac2-cr118");
    for (const s of ["admin-api", "hub-api", "tool"])
      expect(doc.services[s]?.image).toBe("sohoptac2-app:cr118");
    expect(doc.services.web?.image).toBe("sohoptac2-web:cr118");
    for (const [n, s] of Object.entries(doc.services))
      if (s.image?.startsWith("sohoptac2-app") || s.image?.startsWith("sohoptac2-web"))
        expect(s.image, n).toMatch(/:cr118$/);
  });
  it("cổng web = 127.0.0.1:${S2_PORT_*} → 8081..8084; gen-env đặt 2853x; không có cổng ngoài 127.0.0.1", () => {
    const ports = doc.services.web?.ports ?? [];
    expect(ports).toHaveLength(4);
    for (const p of ports) expect(p).toStartWith("127.0.0.1:${S2_PORT_");
    const g = read(`${STG}/gen-env.sh`);
    expect(g).toContain("PC=28531; PA=28532; PCH=28533; PH=28534");
    expect(g).not.toMatch(/\b184\d\d\b|\b284\d\d\b/);
    for (const s of Object.values(doc.services))
      for (const p of s.ports ?? []) expect(p).not.toMatch(/^\d+:/);
  });
  it("không volume tên (dữ liệu tmpfs), không mount claude-home / thư mục prod; mount chỉ trong kit", () => {
    expect(doc.volumes).toBeUndefined();
    for (const [n, s] of Object.entries(doc.services))
      for (const v of s.volumes ?? []) {
        expect(v, n).toStartWith("./");
        expect(v, n).not.toContain("claude-home");
        expect(v, n).not.toContain("..");
      }
  });
  it("PUBLIC_* build toàn 127.0.0.1:2853x và community = <SHT>/community", () => {
    const a = doc.services["admin-api"]?.build?.args ?? {};
    for (const [k, v] of Object.entries(a))
      if (k.endsWith("_URL") && v) expect(v, k).toStartWith("http://127.0.0.1:${S2_PORT_");
    const c = read(`${STG}/docker-compose.yml`);
    expect(c).toContain("COMMUNITY_WEB_URL: ${S2_PUBLIC_COMMUNITY_URL}");
    expect(read(`${STG}/gen-env.sh`)).toContain("S2_PUBLIC_COMMUNITY_URL=$B:$PC/community");
  });
  it("gen-env không đọc bí mật prod; stg-seed chỉ chạy với 285xx", () => {
    const g = read(`${STG}/gen-env.sh`);
    expect(g).not.toMatch(/workspace\/sohoptac2\/\.env|ADMIN_CREDENTIALS|\.\.\/prod/);
    expect(g).toContain("openssl rand");
    expect(read(`${STG}/stg-seed.ts`)).toContain("285\\d\\d");
  });
  it("scripts: project/tag cố định, down chỉ xoá cr118, không prune/`-p sohoptac2 `", () => {
    const lib = read(`${STG}/lib.sh`);
    expect(lib).toContain("PROJECT=sohoptac2-cr118");
    expect(lib).toContain("IMG_APP=sohoptac2-app:cr118");
    expect(lib).toContain("IMG_WEB=sohoptac2-web:cr118");
    expect(lib).toContain("guard_tag");
    const all = ["lib.sh", "build.sh", "up.sh", "down.sh", "push.ps1"]
      .map((f) => read(`${STG}/${f}`))
      .join("\n");
    expect(all).not.toMatch(/\bprune\b/);
    expect(all).not.toMatch(/-p sohoptac2(-stg)?[ "]/);
    expect(all).not.toMatch(/sohoptac2-(app|web):latest/);
    const down = read(`${STG}/down.sh`);
    expect(down).toContain("down -v --remove-orphans");
    expect(down).toContain('docker rmi "$img"');
    expect(read(`${STG}/build.sh`)).toContain("dc build admin-api web");
    expect(read(`${STG}/up.sh`)).toContain(
      "--community-url http://127.0.0.1:28531/community --apply",
    );
  });
  const bash = Bun.which("bash");
  it.skipIf(!bash)("--dry-run: build/up/down in kế hoạch, thoát 0, không đụng docker", () => {
    for (const s of ["build.sh", "up.sh", "down.sh"]) {
      const p = Bun.spawnSync([bash as string, s, "--dry-run"], {
        cwd: join(root, STG),
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = p.stdout.toString();
      expect(p.exitCode, `${s}: ${p.stderr.toString()}`).toBe(0);
      expect(out).toContain("[dry-run]");
      expect(out).not.toContain(":latest");
    }
  });

  it("CR-119 (2026-11-05): app[-test].<d> là host web DUY NHẤT; không còn sohoptac[-test] / cờ S2_APP_HOST_LIVE; community bỏ hẳn", () => {
    const edge = read(`${PROD}/edge/sohoptac2.conf`);
    const lib = read(`${PROD}/edge-lib.sh`);
    const gen = read(`${PROD}/gen-env.sh`);
    expect(lib).toContain("app) p=app; t=app-test");
    expect(lib).toContain('s/__N_APP__/$(s2_names app "$2" "$3")/');
    expect(lib).not.toContain("contracts)");
    expect(lib).not.toContain("S2_APP_HOST_LIVE=");
    expect(edge).toContain("server_name __N_APP__;");
    expect(edge).not.toContain("__N_CONTRACTS__");
    expect(edge).not.toContain("__LEGACY_");
    expect(edge).not.toMatch(/sohoptac(-test)?\.__BASE__/);

    expect(gen).not.toMatch(/\$A\b|APP_HOST_LIVE"? "|P_APP|T_APP/); // chỉ còn lệnh xoá khoá cũ
    expect(gen).toContain('T_C="https://app-test.$D"');
    expect(gen).toContain('P_C="https://app.$D"');
    expect(read(`${PROD}/enable-domain.sh`)).toContain('HOSTS="ai-test app-test ai-test-admin');
    const dep = read(`${PROD}/deploy.ps1`);
    expect(dep).not.toContain("AppHostLive");
    expect(dep).not.toContain("S2_APP_HOST_LIVE");
  });
});
