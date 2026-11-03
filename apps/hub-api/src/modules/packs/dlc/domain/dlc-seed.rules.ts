// dlc-engine · seed thư viện quy trình (hub 0070): mỗi dây chuyền một def thư viện mặc định (id/khoá cố định) = sơ đồ mặc định
// `defaultDlcBody` biên dịch bằng `compileDlcStages`. Test `dlc-seed.rules.test.ts` giữ SQL 0070 khớp với code. Thuần, lớp 1.
import {
  compileDlcStages,
  DLC_MODES,
  DLC_SLOTS,
  type DlcMode,
  defaultDlcBody,
} from "./dlc-flow.rules";

export const DLC_DEFAULT_DEFS: Readonly<
  Record<DlcMode, { id: string; key: string; name: string }>
> = {
  "new-system": {
    id: "0d1c0000-0000-4000-8000-000000000071",
    key: "dlc-new-system-md",
    name: "DLC New System mặc định",
  },
  enhancement: {
    id: "0d1c0000-0000-4000-8000-000000000072",
    key: "dlc-enhancement-md",
    name: "DLC Enhancement mặc định",
  },
  "bug-fix": {
    id: "0d1c0000-0000-4000-8000-000000000073",
    key: "dlc-bug-fix-md",
    name: "DLC Bug Fix mặc định",
  },
};

export type DlcSeedRow = {
  mode: DlcMode;
  id: string;
  key: string;
  name: string;
  slot: string;
  body: unknown;
  stages: unknown[];
};

export const dlcSeedRows = (): DlcSeedRow[] =>
  DLC_MODES.map((mode) => {
    const body = defaultDlcBody(mode);
    return {
      mode,
      ...DLC_DEFAULT_DEFS[mode],
      slot: DLC_SLOTS[mode].key,
      body,
      stages: compileDlcStages(body, mode),
    };
  });
