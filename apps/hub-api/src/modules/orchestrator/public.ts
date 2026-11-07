// ADR-0037 · cửa công khai DUY NHẤT của module `orchestrator`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { chunkText } from "./orchestrator.rules";
export { deltaEmit, flowHistoryWindowOf } from "./orchestrator.service";
