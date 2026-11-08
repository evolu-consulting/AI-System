// CR-125 · cr125-contract-from-step · nối node «Tạo hợp đồng từ hồ sơ» (`contracts.create-from-step`): tool gói + binding sổ module. Tool dùng
// đúng use case tải lên của gói (`uploadContractFor`, không phát `contract.uploaded`), đọc tệp bước trước qua cổng `attachmentBytes` của hub
// (đọc theo công ty của lượt), gắn HĐ vào lượt qua cầu engine `packRuns`. Thiếu FileBox / cầu engine / kho tệp hub ⇒ tool vẫn đăng ký nhưng
// báo lỗi nghiệp vụ rõ (`CONTRACT_STEP_STORAGE_OFF`) lúc chạy — không im lặng không làm gì.

import { CREATE_FROM_STEP_STORAGE_OFF } from "@ai/contracts/modules";
import type { Db } from "@ai/db";
import type { Redis } from "ioredis";
import type { AttachmentStorage } from "../../attachments/public";
import { attachmentBytesOf } from "../../attachments/public";
import type { ConfigCache } from "../../config/public";
import {
  moduleRegistry,
  type PackAccessView,
  type PackRunsBridge,
  type PackToolDef,
} from "../kit/public";
import { fileboxClients, packFilebox } from "../packs.filebox";
import { tenantTz } from "../packs.tenant-config";
import { createFromStepTool, type StepFile } from "./adapters/create-from-step.tool";
import type { UploadContract } from "./application/upload-contract.usecase";
import { createFromStepBinding } from "./nodes/create-from-step/binding";
import { uploadContractFor } from "./upload.mount";

/** Đọc nội dung tệp đính kèm của hub theo id, đúng công ty; không có / đã xoá / công ty khác ⇒ null. */
export type AttachmentBytes = (tenantId: string, id: string) => Promise<StepFile | null>;

export type CreateFromStepMountDeps = {
  packTools?: { register(t: PackToolDef): void } | undefined;
  packRuns?: PackRunsBridge | undefined;
  view?: PackAccessView | undefined;
  packs?: { filebox?: { url: string; token: string } } | undefined;
  redis?: Redis | undefined;
  config?: ConfigCache | undefined;
  /** Kho tệp đính kèm của hub (`AppDeps.attachments`); vắng ⇒ tool báo `CONTRACT_STEP_STORAGE_OFF` lúc chạy. */
  attachments?: { storage: AttachmentStorage } | undefined;
  /** Test tiêm bộ đọc tệp giả. */
  attachmentBytes?: AttachmentBytes | undefined;
};

const OFF = async (): Promise<never> => {
  throw new Error(CREATE_FROM_STEP_STORAGE_OFF);
};

export function mountCreateFromStep(
  d: CreateFromStepMountDeps,
  db: Db,
  /** Test tiêm use case tải lên / kho tệp giả. */
  o: { upload?: UploadContract } = {},
): void {
  const fb = packFilebox(d.packs);
  const bytes =
    d.attachmentBytes ?? (d.attachments ? attachmentBytesOf(db, d.attachments.storage) : undefined);
  const timeZoneOf = d.config ? tenantTz({ config: d.config }) : async () => "UTC";
  const upload =
    o.upload ??
    (fb && d.view
      ? uploadContractFor(
          {
            db,
            view: d.view,
            ...(d.redis ? { redis: d.redis } : {}),
            filebox: fileboxClients(fb),
            timeZoneOf,
            // HĐ có sẵn trường từ phiếu ⇒ không xếp AI trích (use case bỏ qua `starter` khi có `prefill`).
            starter: { start: async () => undefined },
          },
          { flow: false },
        )
      : OFF);
  const tool = createFromStepTool({
    upload,
    readFile: async (tenantId, id) => (bytes ? bytes(tenantId, id) : OFF()),
    timeZoneOf,
    link: {
      recordOf: async (tenantId, runId) =>
        (await d.packRuns?.port?.recordOf?.(tenantId, runId, "contracts")) ?? null,
      attach: async (tenantId, runId, contractId) =>
        (await d.packRuns?.port?.attachRecord?.(tenantId, runId, {
          pack: "contracts",
          record_id: contractId,
        })) ?? false,
    },
  });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(createFromStepBinding());
}
