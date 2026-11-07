// ADR-0037 · cửa công khai DUY NHẤT của module `kh`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { KhRuntime } from "./kh.mount";
export type { KhJobCtx, KhQueryService } from "./kh.query.service";
export { khJobCtx } from "./kh.query.service";
export type { KhSnapshot } from "./kh.start";
export { khStartPlan } from "./kh.start";
export { enqueueKhSummary, writeStatesOfRun } from "./kh.writes.port";
