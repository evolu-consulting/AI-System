// ADR-0037 · cửa công khai DUY NHẤT của module `mention`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.

export { responderOf } from "./mention.rules";
export type { DirectRunStart, MentionPlan } from "./mention.service";
export { directOnSnapshot } from "./mention.service";
export type { MentionRouted } from "./mention-parse.rules";
export { routeMessage } from "./mention-parse.rules";
