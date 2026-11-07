// ADR-0037 · cửa công khai DUY NHẤT của module `runner`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { AgentRunner, AgentTask, JobOutcome } from "./job/job-agent-runner";
export { runJob } from "./job/job-agent-runner";
export { packToolKeys } from "./job/pack-tool-keys.rules";
export type { StepView } from "./profile-step.rules";
export { pickStep } from "./profile-step.rules";
export type { AgentRole } from "./runner.rules";
export { buildWorkflowJobPayload, compareStreamId, syntheticFailed } from "./runner.rules";
export type { WorkflowJobOutcome, WorkflowJobRunner } from "./workflow/workflow-job-runner";
