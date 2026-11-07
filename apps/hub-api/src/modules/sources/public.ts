// ADR-0037 · cửa công khai DUY NHẤT của module `sources`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { ResolveReport } from "./resolve.bridge";
export { sourceError } from "./sources.errors";
