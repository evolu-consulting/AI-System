# Plan stack · X1-combine (ST1, tách từ plan.md §6)

## 6. Stack (ST1) — `bun run combine:dev`
File `tools/hub-dev/src/combine.ts` (≤ 400 dòng; tái dùng `startHubDev`, `healthy`, `hubApiEnv` của `dev.ts`; không sửa hành vi `hub:dev`) + hàm thuần `tools/scripts/src/combine.rules.ts` (QC khoá, AC19): `buildCombineEnv(base, opts: {token?, wsl?, mock?}): Record<ProcName, env>` (env §3; token chung); `stopOrder(started: readonly ProcName[]): ProcName[]` (ngược thứ bật). Script `"combine:dev": "bun --env-file=.env.local tools/hub-dev/src/combine.ts"`.

| Bước | Việc | Kiểm |
|---|---|---|
| 0 | `docker compose up -d --wait` (Postgres, Redis, Mailpit) | exit 0 |
| 1 | `HUB_INTERNAL_TOKEN` (§3), đặt `CORS_ORIGINS`, `HUB_CORS_ORIGINS`, `ADMIN_HUB_URL` vào env truyền cho tiến trình con | — |
| 2 | `startHubDev()` với `HUB_DEV_RUNTIME=none` mặc định: migrate → admin-api `:3001` → fixture user → `hub:seed` → hub-api `:4000` | `/health` 2 cổng |
| 2b | Dify mock: `startDifyMock()` (`tools/hub-dev/src/dify-mock.ts`) cổng 5001 nếu trống (bận ⇒ dùng lại + ghi chú); `docs/guides/combine-test.md` S7 (D1): tạo workflow `mock-send` qua Admin (base_url `http://localhost:5001/v1`, secret `mk-ok`) rồi bật cờ `side_effect` | `GET :5001` phản hồi |
| 3 | chat-web `bun run --cwd apps/chat-web dev` (`HUB_URL`, `AUTH_URL`) · admin-web (`ADMIN_API_URL`, `PUBLIC_HUB_URL`, `PUBLIC_STUDIO_URL`, `PUBLIC_CHAT_WEB_URL`) · studio-web (`ADMIN_API_URL`, `HUB_URL`, `PUBLIC_ADMIN_WEB_URL`, `PUBLIC_CHAT_WEB_URL`) | `GET /` 200 ở 3100/3000/3200 (studio `/studio/`), chờ ≤ 60 s |
| 4 | Runtime: in lệnh WSL (hub-dev.md "Runtime trong WSL") với `AGENT_RT_PROVIDERS=claude-sub,dify`, `AGENT_RT_HUB_URL=<url Hub nhìn từ WSL>`; `COMBINE_WSL=1` ⇒ tự `wsl.exe -d Ubuntu -u worker -- bash -l -s` (stdin = script) | log `runtime.ready` (không chặn) |
| 5 | In bảng URL + user mẫu; nhắc `bun run seed:dify` (dry-run) | — |
| Dừng | Ctrl+C/SIGTERM: dừng theo thứ tự ngược đúng các tiến trình script đã bật (không giết tiến trình dùng lại) | AC19 |

Cổng bận ⇒ dùng lại (như `hub:dev`) + ghi chú; web bận ⇒ lỗi rõ (`strictPort`).

**Kiểu (`combine.rules.ts`, chốt readiness lần 2):**
```ts
export type ProcName = "admin-api" | "hub-api" | "dify-mock" | "chat-web" | "admin-web" | "studio-web";
export const START_ORDER: readonly ProcName[] = ["admin-api", "hub-api", "dify-mock", "chat-web", "admin-web", "studio-web"];
export function buildCombineEnv(base: Record<string, string>, opts: { token?: string; wsl?: boolean; mock?: boolean /* mặc định true */ }): Record<ProcName, Record<string, string>>;
export function stopOrder(started: readonly ProcName[]): ProcName[]; // ngược thứ tự bật, chỉ gồm tên có trong `started`
```
`base` = env tiến trình cha; `opts.mock=false` ⇒ không có khoá `dify-mock` được bật (env vẫn trả, `stopOrder` không gồm). AC19 "6 tiến trình" = 6 `ProcName` trên; Runtime WSL không tính.

**Nối với `startHubDev` (chốt readiness lần 3, không sửa `dev.ts`):** `combine.ts` gộp `env["admin-api"]` và `env["hub-api"]` vào `process.env` trước khi gọi `startHubDev()`; sau khi hàm trả về luôn thêm `admin-api`, `hub-api` vào `started`. Khi dừng theo `stopOrder`: gặp `hub-api` ⇒ gọi `dev.stop()` một lần (tự bỏ qua tiến trình dùng lại); `admin-api` là no-op. Kiểm AC19 tay: 5 tiến trình `/health` hoặc `GET /` 200; `dify-mock` chỉ cần `GET :5001` có phản hồi (không đòi 200).
