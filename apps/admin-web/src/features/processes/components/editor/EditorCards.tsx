// CR-123 u9 · thẻ của trình sửa quy trình theo người xem: công ty thấy sơ đồ các bước ngay đầu trang; Nguồn / Thông tin đầu vào là khái
// niệm kỹ thuật ⇒ chỉ quản trị nền tảng.
import type { useDraft } from "../../hooks/use-draft";
import type { useEditorRefs } from "../../hooks/use-editor-refs";
import { InputsCard } from "./InputsCard";
import { SourcesCard } from "./SourcesCard";
import { StagesCard } from "./StagesCard";

type Refs = ReturnType<typeof useEditorRefs>;
type DraftView = Parameters<typeof StagesCard>[0]["d"];

/** Công ty: sơ đồ các bước nằm ngay đầu trang. */
export function StagesFirst(p: { on: boolean; d: DraftView; readOnly: boolean; refs: Refs }) {
  return p.on ? <StagesCard d={p.d} readOnly={p.readOnly} refs={p.refs} /> : null;
}

/** Quản trị nền tảng: Nguồn · Thông tin đầu vào · Các bước; công ty (`hide`) đã có sơ đồ ở đầu trang. */
export function TechCards(p: {
  hide: boolean;
  d: ReturnType<typeof useDraft>;
  dv: DraftView;
  readOnly: boolean;
  refs: Refs;
  tenantId: string | undefined;
  ready: boolean;
  /** CR-127 · M8 · quy trình theo sự kiện: không còn Nguồn / «Các trường» (hệ thống tự biết dữ liệu hợp đồng). */
  flow?: boolean;
}) {
  if (p.hide) return null;
  if (p.flow) return <StagesCard d={p.dv} readOnly={p.readOnly} refs={p.refs} />;
  const { d } = p;
  return (
    <>
      <SourcesCard
        draft={d.draft}
        errors={d.errors}
        readOnly={p.readOnly}
        tenantId={p.tenantId}
        ready={p.ready}
        patch={d.patch}
      />
      <InputsCard draft={d.draft} errors={d.errors} readOnly={p.readOnly} patch={d.patch} />
      <StagesCard d={p.dv} readOnly={p.readOnly} refs={p.refs} />
    </>
  );
}
