// ADR-0037 · cửa công khai DUY NHẤT của module `runs`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { ProcessRunInput } from "./create-run";
export { runErrorText } from "./run-errors";
export type { ProcessStage, StageExecutor } from "./run-process";
export { queueTimeoutReason } from "./runs.rules";
export type { PreparedRun, RunContext, RunDriver, RunService } from "./runs.service";
export { xreadPairs } from "./sse/sse-reader";
export type { RunOutcome, SseEventBody, SseWriter } from "./sse/sse-writer";
