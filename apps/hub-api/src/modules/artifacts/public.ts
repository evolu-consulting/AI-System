// ADR-0037 · cửa công khai DUY NHẤT của module `artifacts`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { artifactHandoffOn } from "./artifact.flag";
export type { ArtifactMcpTools } from "./artifact.mcp";
export { artifactToolsGranted, jobVariant, withArtifactTools } from "./artifact.mcp";
export { artifactStoreFor } from "./artifact.mount";
export type { ArtifactRef } from "./artifact.rules";
export { inputOf, renderEnvelope, shouldInline } from "./artifact.rules";
export type { ArtifactSink } from "./artifact.service";
export { compactHistory, KEEP_LAST_TURNS, olderBody, splitHistory } from "./history.rules";
