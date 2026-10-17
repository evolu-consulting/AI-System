import { Link, useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { logout, useMe } from "@/api/session";
import { PageHead, Panel } from "@/components/ui";

/** ⚙ Cài đặt: the scoring page from the mock, plus who is signed in. Members and the rest go through the assistant. */
export default function SettingsPage() {
  const { data: me } = useMe();
  const nav = useNavigate();
  const qc = useQueryClient();
  async function out() {
    await logout().catch(() => {});
    qc.clear();
    nav("/login", { replace: true });
  }
  return (
    <>
      <PageHead title="Cài đặt" />
      <Panel className="mb-4">
        <Link to="/settings/scoring" className="flex items-center gap-4 px-5 py-4 hover:bg-sunk">
          <span><span className="block font-semibold">Cách tính điểm uy tín</span>
            <span className="block text-[13px] text-dim">Tiêu chí, trọng số và quy tắc xếp mức cho khách hàng và nhà cung cấp</span></span>
          <span className="ml-auto text-dim">→</span>
        </Link>
      </Panel>
      <Panel className="flex flex-wrap items-center gap-4 px-5 py-4">
        <span><span className="block font-semibold">{me?.name}</span>
          <span className="block text-[13px] text-dim">{me?.email} · {me?.org?.name}</span></span>
        <button type="button" className="btn btn-quiet ml-auto" onClick={out}>Đăng xuất</button>
      </Panel>
      <p className="mt-4 text-[13px] text-dim">Mời đồng nghiệp, đổi vai trò, sản phẩm và danh mục: hỏi Trợ lý AI bên phải.</p>
    </>
  );
}
