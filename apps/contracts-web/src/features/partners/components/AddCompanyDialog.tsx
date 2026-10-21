// GAP-D2 · #23: hộp "Thêm công ty" ở trang Đối tác — gõ MST ⇒ máy chủ tra Cục Thuế (CHỈ gửi MST) rồi lưu vào danh bạ công ty; hiện
// tên/địa chỉ/trạng thái theo Cục Thuế. Cục Thuế chưa tra được ⇒ mời nhập tên (và địa chỉ) để lưu trước, sau tra lại được.
import type { Company } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { refreshCompany } from "../api";
import { useCreateCompany } from "../hooks/use-partner-rep";
import { type CompanyErr, companyErrKey, normalizeTax } from "../lib/company";

function Result({ c, onRefresh, busy }: { c: Company; onRefresh: () => void; busy: boolean }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.company.${k}`, o);
  return (
    <div role="status" className="space-y-1 rounded-lg bg-sunk px-3 py-2.5 text-[13.5px]">
      <b className="block text-[14px]">{c.name ?? c.party}</b>
      {c.address && <span className="block text-dim">{c.address}</span>}
      <span className="block text-dim">
        {c.registry_result === "found"
          ? c.active === false
            ? L("inactive", { status: c.status ?? "" })
            : L("active")
          : L("notChecked")}
      </span>
      <button
        type="button"
        className="btn btn-quiet btn-sm"
        disabled={busy || !c.tax_id}
        onClick={onRefresh}
      >
        {L("refresh")}
      </button>
    </div>
  );
}

export function AddCompanyDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.vgaps.company.${k}`, o);
  const create = useCreateCompany();
  const [tax, setTax] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [needName, setNeedName] = useState(false);
  const [err, setErr] = useState<CompanyErr | null>(null);
  const [done, setDone] = useState<Company | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const submit = () => {
    const n = normalizeTax(tax);
    if (!n) return setErr("invalid");
    setErr(null);
    // Lần đầu CHỈ gửi MST; chỉ khi Cục Thuế chưa tra được mới gửi thêm tên/địa chỉ người nhập.
    const body: { tax_id: string; name?: string; address?: string } = { tax_id: n };
    if (needName && name.trim()) body.name = name.trim();
    if (needName && address.trim()) body.address = address.trim();
    create.mutate(body, {
      onSuccess: setDone,
      onError: (e) => {
        const k = companyErrKey(e instanceof ApiError ? String(e.code) : "");
        if (k === "unavailable") setNeedName(true);
        setErr(k);
      },
    });
  };
  const refresh = async (party: string) => {
    setRefreshing(true);
    try {
      setDone(await refreshCompany(party));
      setErr(null);
    } catch (e) {
      setErr(companyErrKey(e instanceof ApiError ? String(e.code) : ""));
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={L("title")}>
        <DialogHeader>
          <DialogTitle>{L("title")}</DialogTitle>
          <DialogDescription>{L("hint")}</DialogDescription>
        </DialogHeader>
        {done ? (
          <Result c={done} busy={refreshing} onRefresh={() => void refresh(done.party)} />
        ) : (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex flex-col gap-1 text-[13px]">
              {L("mst")}
              <input
                className="field font-mono"
                inputMode="numeric"
                maxLength={30}
                value={tax}
                onChange={(e) => setTax(e.target.value)}
                placeholder={L("mstPh")}
              />
            </label>
            {needName && (
              <>
                <label className="flex flex-col gap-1 text-[13px]">
                  {L("name")}
                  <input
                    className="field"
                    maxLength={300}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[13px]">
                  {L("address")}
                  <input
                    className="field"
                    maxLength={500}
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </label>
              </>
            )}
            <DialogFooter className="items-center gap-2">
              <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
                {t("contracts.common.cancel")}
              </button>
              <button type="submit" className="btn btn-primary btn-sm" disabled={create.isPending}>
                {create.isPending ? L("looking") : needName ? L("saveFirst") : L("lookup")}
              </button>
            </DialogFooter>
          </form>
        )}
        {err && (
          <p role="alert" className="text-sm text-late">
            {L(`error.${err}`)}
          </p>
        )}
        {done && (
          <DialogFooter>
            <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              {L("close")}
            </button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
