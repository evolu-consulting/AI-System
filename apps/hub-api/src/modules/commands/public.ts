// ADR-0037 · cửa công khai DUY NHẤT của module `commands`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { CatalogWorkflow, WorkflowInputValue, WorkflowJobInput } from "./catalog.types";
export { appNeedsQuery } from "./command-input.rules";
export { classifyMessage } from "./command-parse.rules";
export type { BoundCommand } from "./commands.service";
export { bindCommandInputs } from "./commands.service";
export { levenshtein, suggestCommands } from "./suggest.rules";
