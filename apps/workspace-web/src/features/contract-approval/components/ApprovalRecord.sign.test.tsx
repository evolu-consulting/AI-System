// CR-181 · s10 · «Hồ sơ duyệt»: hình chữ ký nhỏ hiện THẲNG bằng <img> (ảnh đã in: ai xem HĐ cũng thấy; không thay bằng link «Xem»).
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { recordLines } from "../lib/record-view";
import { SignImg } from "./ApprovalRecord";

const C = "11111111-1111-4111-8111-111111111111";
const S = "22222222-2222-4222-8222-222222222222";
const person = { id: C, display_name: "Hoa" };

describe("ApprovalRecord · hình chữ ký", () => {
  test("hiện ảnh chữ ký đã in ngay trong dòng của người ký", () => {
    const qc = new QueryClient();
    qc.setQueryData(["contract-sign-img", C, `stamp:${S}`], "blob:http://x/sig");
    const out = renderToStaticMarkup(
      <QueryClientProvider client={qc}>
        <SignImg contractId={C} who="Hoa" evidence={null} stampId={S} />
      </QueryClientProvider>,
    );
    expect(out).toContain("<img");
    expect(out).toContain('src="blob:http://x/sig"');
    expect(out).toContain('data-testid="record-sign-img"');
  });
  test("người chỉ xem: không có ý kiến, vẫn có mã ảnh chữ ký đã in (BR-X2)", () => {
    const lines = recordLines({
      can_read_evidence: false,
      items: [
        {
          task_id: C,
          stage: "Kế toán",
          action: "approve",
          at: "2026-11-11T09:00:00Z",
          actor: person,
          feedback: "kín",
          evidence: null,
          sign: {
            user: person,
            kind: "digital",
            files_signed: 2,
            at: "2026-11-11T09:00:00Z",
            stamp_id: S,
          },
        },
      ],
    } as never);
    expect(lines[0]?.note).toBeNull();
    expect(lines[0]?.sign).toEqual({ kind: "digital", filesSigned: 2, stampId: S });
  });
});
