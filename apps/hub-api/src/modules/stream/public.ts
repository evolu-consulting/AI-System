// ADR-0037 · cửa công khai DUY NHẤT của module `stream`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.

export type { DeltaKind, Reconciled } from "./delta.rules";
export { chunkDelta, reconcileStream, streamAccept } from "./delta.rules";
export type { DeltaGap } from "./delta-sink";
export { DeltaSink, deltaSinkFor } from "./delta-sink";
export { gapTrace, reconcileTrace } from "./stream-trace";
