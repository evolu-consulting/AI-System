// CR-125 · cr125-contract-from-step · nối node «Tạo hợp đồng từ hồ sơ» (`contracts.create-from-step`): tool gói + binding sổ module. Tool dùng
// đúng use case tải lên của gói (`uploadContractFor`, không phát `contract.uploaded`), đọc tệp bước trước qua cổng `attachmentBytes` của hub
// (đọc theo công ty của lượt), gắn HĐ vào lượt qua cầu engine `packRuns`. Thiếu FileBox / cầu engine / kho tệp hub ⇒ tool vẫn đăng ký nhưng
// báo lỗi nghiệp vụ rõ (`CONTRACT_STEP_STORAGE_OFF`) lúc chạy — không im lặng không làm gì.

import { CREATE_FROM_STEP_STORAGE_OFF } from "@ai/contracts/modules";
import type { Db } from "@ai/db";
import type { Redis } from "ioredis";
import {
  moduleRegistry,
  type PackAccessView,
  type PackRunsBridge,
  type PackToolDef,
} from "../kit/public";
import { fileboxClients, packFilebox } from "../packs.filebox";
import { tenantTz, type WithConfig } from "../packs.tenant-config";
import { createFromStepTool, type StepFile } from "./adapters/create-from-step.tool";
import type { UploadContract } from "./application/upload-contract.usecase";
import { createFromStepBinding } from "./nodes/create-from-step/binding";
import { uploadContractFor } from "./upload.mount";

/** Đọc nội dung tệp đính kèm của hub theo id, đúng công ty; không có / đã xoá / công ty khác ⇒ null. */
export type AttachmentBytes = (
  tenantId: string,
  runId: string,
  id: string,
) => Promise<StepFile | null>;

export type CreateFromStepMountDeps = {
  packTools?: { register(t: PackToolDef): void } | undefined;
  packRuns?: PackRunsBridge | undefined;
  view?: PackAccessView | undefined;
  packs?: { filebox?: { url: string; token: string } } | undefined;
  redis?: Redis | undefined;
  config?: WithConfig["config"] | undefined;
  /** Bộ đọc tệp đính kèm hub (tiêm ở `packs.mount.ts` — gói không import module hub); vắng ⇒ tool báo `CONTRACT_STEP_STORAGE_OFF`. */
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
  const bytes = d.attachmentBytes;
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
    readFile: async (tenantId, runId, id) => (bytes ? bytes(tenantId, runId, id) : OFF()),
    timeZoneOf,
    link: {
      once: async (tenantId, runId, create) => {
        const once = d.packRuns?.port?.linkOnce;
        if (!once) return OFF();
        return once(tenantId, runId, "contracts", create);
      },
    },
  });
  d.packTools?.register(tool);
  moduleRegistry.bindTool(tool);
  moduleRegistry.bindNode(createFromStepBinding());
}
