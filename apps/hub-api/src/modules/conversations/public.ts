// ADR-0037 · cửa công khai DUY NHẤT của module `conversations`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { stepLabel } from "./conversations.rules";
export type { ConversationService } from "./conversations.service";
