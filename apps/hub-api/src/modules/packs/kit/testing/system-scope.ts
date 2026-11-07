// CHỈ cho test (ADR-0037 `testing/`): int test của gói chạy OutcomeHandler / đọc lý do thẻ trong tx scope system như bộ điều phối
// (gói không import `hub-scope` — luật `pack-no-platform-db-internals`). Code production không import file này.
export { withHubScope as withSystemScope } from "@ai/db/hub-scope";
