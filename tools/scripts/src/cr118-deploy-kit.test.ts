// CR-118 · deploy-kit: bất biến của kit prod (web gộp + 301 community) (UAT kit stg-cr118 đã gỡ khỏi repo). Thuần: đọc file, không docker/mạng.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";

const root = repoRoot();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const PROD = "deploy/prod-sohoptac2";

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

describe("prod kit · CR-119 host web duy nhất", () => {
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
