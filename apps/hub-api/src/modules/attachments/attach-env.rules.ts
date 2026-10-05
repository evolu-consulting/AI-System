// HUB-FR-44 · H2c-R04, AC-15 · env `HUB_ATTACH_*` (plan §7, plan-rules §4). Lỗi: `Error` không chứa giá trị env.
// B0: chỉ chữ ký (thân ném `not implemented`) — B1.

export type AttachEnvInput = {
  HUB_ATTACH_DRIVER?: string;
  HUB_ATTACH_DIR?: string;
  HUB_ATTACH_TENANT_MAX_BYTES?: string;
  HUB_ATTACH_SWEEP_S?: string;
};

export type AttachEnv = { driver: "local"; dir: string; tenantMaxBytes: number; sweepS: number };

/** driver = `local`; dir tuyệt đối (theo `platform`); hạn tenant ≥ `ATTACH_MAX_BYTES` (vắng 5 GiB); sweep 10–86 400 s (vắng 600). */
export function parseAttachEnv(_e: AttachEnvInput, _platform: NodeJS.Platform): AttachEnv {
  throw new Error("not implemented: parseAttachEnv");
}
