// ADM-NFR-06 · `bun run mocks`: chạy mock Dify + Hub trên 2 cổng. Nơi duy nhất có I/O khởi động.
import { createDifyMock } from "./dify";
import { loadMockEnv, type MockEnv } from "./env";
import { createHubMock } from "./hub";

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
console.log(
  `mocks: Dify http://localhost:${dify.port}/v1 · Hub http://localhost:${hub.port} · timeout ${env.timeoutMs} ms`,
);
