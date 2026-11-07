// ADR-0037 · cửa công khai DUY NHẤT của module `usage`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { ChatTokenGate } from "./chat-token-gate";
export { gatedRun } from "./chat-token-gate";
export { noteChatUsage } from "./chat-usage";
