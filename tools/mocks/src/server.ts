// ADM-NFR-06 · HUB-FR-131 · `bun run mocks`: chạy mock Dify + Hub + KnowledgeHub trên 3 cổng. Nơi duy nhất có I/O khởi động.
import { createDifyMock } from "./dify";
import { loadMockEnv, type MockEnv } from "./env";
import { createGithubMock, GH_MOCK_TOKEN } from "./github";
import { createHubMock } from "./hub";
import { createKhMock } from "./kh";

function readEnvOrExit(): MockEnv {
  try {
    return loadMockEnv(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const env = readEnvOrExit();
// idleTimeout 0: kịch bản timeout giữ kết nối tới MOCK_TIMEOUT_MS (mặc định 30 s > 10 s mặc định của Bun).
const dify = Bun.serve({
  port: env.difyPort,
  idleTimeout: 0,
  fetch: createDifyMock(env).fetch,
});
const hub = Bun.serve({ port: env.hubPort, idleTimeout: 0, fetch: createHubMock(env).fetch });
const kh = Bun.serve({
  port: env.khPort,
  idleTimeout: 0,
  fetch: createKhMock({ apiKey: env.khApiKey, timeoutMs: env.timeoutMs }).fetch,
});
// P-c2 · mock GitHub (Hub trỏ HUB_GITHUB_API_URL tới đây); token chấp nhận = GITHUB_MOCK_TOKEN.
const gh = Bun.serve({
  port: Number(process.env.GITHUB_MOCK_PORT || 4040),
  fetch: createGithubMock({ tokens: [process.env.GITHUB_MOCK_TOKEN || GH_MOCK_TOKEN] }).fetch,
});
console.log(
  `mocks: GitHub http://localhost:${gh.port} · Dify http://localhost:${dify.port}/v1 · Hub http://localhost:${hub.port} · KH http://localhost:${kh.port} · timeout ${env.timeoutMs} ms`,
);
