// ADR-0037 · cửa công khai DUY NHẤT của module `attachments`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { AttachmentDifyDeps, DifyUploadTarget, UploadTrace } from "./attachment-dify";
export {
  AttachmentContentMissing,
  AttachmentUnavailable,
  difyFileInput,
  uploadToDify,
} from "./attachment-dify";
export { contentLengthOf } from "./attachments.routes";
export type { AttachmentService, OutputJob, UploadInput } from "./attachments.service";
export { OutputClaimLost } from "./attachments.service";
export { FileboxClient } from "./filebox.client";
export { envFileboxToken } from "./filebox-token";
export {
  bindRoomMessageFiles,
  bindRoomOutputs,
  checkRoomSendable,
  normalizeAttachmentIds,
  roomFileRefs,
  roomRunFiles,
} from "./room-files";
export { roomFileWindow } from "./room-files.rules";
export type { RunKind } from "./run-files";
export { bindRunFiles, bindRunOutputs, checkSendable } from "./run-files";
export type { FileBrief, RunFile } from "./run-files.rules";
export {
  agentFilesBlock,
  fileBrief,
  jobAttachments,
  orchestratorFilesBlock,
  withOutHint,
} from "./run-files.rules";
export { inheritRunFiles, linkRunFiles, type RunFileSource } from "./run-links";
export { uuidsIn } from "./run-links.rules";
export type { AttachmentStorage, Staged } from "./storage";
export { storageKey, storageLocatorOf } from "./storage";
