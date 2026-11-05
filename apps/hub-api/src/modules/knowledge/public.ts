// CR-121 phần B · ADR-0037 · cửa công khai DUY NHẤT của module `knowledge`: module khác chỉ import file này
// (cổng, kiểu, hàm dựng mount; theo tên, không `export *`). Ruột (domain/application/adapters) là riêng của module.
export { openAiEmbedder } from "./adapters/ai.adapters";
export type { Embedder } from "./application/ports";
export { mountKnowledge } from "./knowledge.mount";
