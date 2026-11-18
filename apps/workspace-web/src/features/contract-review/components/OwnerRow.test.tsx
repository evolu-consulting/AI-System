// CR-184: «Phụ trách» chỉ hiện avatar; tooltip «Phụ trách: <họ tên>» (chữ có trong DOM); không quyền ghi ⇒ không có nút chọn.
import { beforeAll, describe, expect, test } from "bun:test";
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { i18n, initI18n } from "~/app/i18n";
import { MEMBERS_KEY } from "~/features/contracts-list/api";
import { OwnerRow } from "./ManagePanel";
import { OwnerPopover } from "./OwnerPopover";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
  await i18n.reloadResources("vi");
});

const render = (write: boolean, owner: string | null) => {
  const qc = new QueryClient();
  qc.setQueryData(MEMBERS_KEY, { items: [{ id: "u1", name: "Lê Minh Cường" }] });
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <OwnerRow c={{ id: "c1", owner_user_id: owner } as ContractDetail} write={write} />
    </QueryClientProvider>,
  );
};

describe("OwnerRow", () => {
  test("chỉ đọc: avatar + tooltip, không có nút chọn", () => {
    const out = render(false, "u1");
    expect(out).toContain('aria-label="Lê Minh Cường"');
    expect(out).toContain("Phụ trách: Lê Minh Cường");
    expect(out).not.toContain("owner-select");
  });
  test("có quyền ghi: nút mở danh sách mang nhãn «Phụ trách: tên», vùng bấm 44px trên điện thoại", () => {
    const out = render(true, "u1");
    expect(out).toContain('data-testid="owner-select"');
    expect(out).toContain('aria-label="Phụ trách: Lê Minh Cường"');
    expect(out).toContain("max-sm:min-h-11");
  });
  test("chưa giao: hiện «Chưa giao»", () => {
    expect(render(false, null)).toContain("Chưa giao");
  });
});

describe("OwnerPopover (điện thoại)", () => {
  const props = {
    face: "LC",
    tip: "Phụ trách: Lê Minh Cường",
    cur: "u1",
    name: "Lê Minh Cường",
    busy: false,
    options: [],
    cards: new Map(),
    onPick: () => undefined,
  };
  test("nút là trigger của popover (chạm ⇒ hiện tên, không mở thẳng danh sách), nhãn «Phụ trách: tên», vùng bấm 44px", () => {
    const out = renderToStaticMarkup(<OwnerPopover {...props} write />);
    expect(out).toContain('data-testid="owner-select"');
    expect(out).toContain('aria-label="Phụ trách: Lê Minh Cường"');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).toContain("min-h-11");
    expect(out).not.toContain('data-testid="owner-option-');
  });
  test("không quyền: vẫn là popover chỉ hiện tên (nút «Đổi người phụ trách» chỉ có khi write)", () => {
    const out = renderToStaticMarkup(<OwnerPopover {...props} write={false} />);
    expect(out).toContain('aria-haspopup="dialog"');
    expect(out).not.toContain("owner-change");
  });
});
