// ADR-0037 · cửa công khai DUY NHẤT của module `chat-gate`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export { dockMessageAllowed, meStreamEventAllowed } from "./chat-gate.rules";
