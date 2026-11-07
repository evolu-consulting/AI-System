// ADR-0037 · cửa công khai DUY NHẤT của module `kh`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.

export type { KhJobItem } from "./kh.agent.rules";
export type { KhConn } from "./kh.client";
export { KhClient } from "./kh.client";
export type { KhJobPreparer } from "./kh.job";
export { KH_QUERY_HINT } from "./kh.job";
export type { KhRuntime } from "./kh.mount";
export type { KhJobCtx, KhQueryService } from "./kh.query.service";
export { khJobCtx } from "./kh.query.service";
export type { KhSnapshot } from "./kh.start";
export { khStartPlan } from "./kh.start";
export { enqueueKhSummary, writeStatesOfRun } from "./kh.writes.port";
