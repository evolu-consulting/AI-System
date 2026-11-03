// CR-114 · hub-agent-handoff · cờ bật bàn giao bằng tham chiếu (driver Orchestrator, tool MCP, quyền MCP của job, vòng dọn).
// `HUB_ARTIFACT_HANDOFF=1`; tắt (mặc định) = hành vi cũ nguyên vẹn.
export const artifactHandoffOn = (env: Record<string, string | undefined> = process.env): boolean =>
  env.HUB_ARTIFACT_HANDOFF === "1";
