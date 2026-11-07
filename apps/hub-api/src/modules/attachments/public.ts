// ADR-0037 · cửa công khai DUY NHẤT của module `attachments`: module khác chỉ import file này (theo tên, không `export *`). Ruột là riêng của module.
export type { AttachmentDifyDeps, UploadTrace } from "./attachment-dify";
export {
  AttachmentContentMissing,
  AttachmentUnavailable,
  difyFileInput,
  uploadToDify,
} from "./attachment-dify";
export { contentLengthOf } from "./attachments.routes";
export type { AttachmentService, OutputJob, UploadInput } from "./attachments.service";
export { OutputClaimLost } from "./attachments.service";
export {
  bindRoomMessageFiles,
  bindRoomOutputs,
  checkRoomSendable,
  normalizeAttachmentIds,
  roomFileRefs,
  roomRunFiles,
} from "./room-files";
export { roomFileWindow } from "./room-files.rules";
export type { FileBrief, RunFile } from "./run-files.rules";
export { fileBrief, orchestratorFilesBlock } from "./run-files.rules";
export type { AttachmentStorage, Staged } from "./storage";
export { storageKey, storageLocatorOf } from "./storage";
