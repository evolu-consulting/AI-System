// CR-181 · s4 · Q10 · màn toàn màn hình «Tạo chữ ký của bạn» chắn TRƯỚC khi vào app (mọi app trong workspace-web qua `ShellFeatured`).
// Chỉ chặn khi công ty bật ký trên tài liệu và API báo `needs_create`; API lỗi ⇒ KHÔNG chặn (ghi log). «Làm sau» chỉ khi không bắt buộc.
import type { MySignatureView } from "@ai/contracts/signature";
import { toast } from "@ai/web-kit/ui/toast";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCreateSignature, useMySignature } from "../hooks/use-my-signature";
import { readLater, shouldBlock, writeLater } from "../lib/gate";
import { CreateFlow } from "./CreateFlow";

/** Chờ tối đa bấy nhiêu ms cho lượt GET đầu; quá hạn ⇒ cho vào app (API treo/chậm không được che khung app). */
export const GATE_WAIT_MS = 3000;

/**
 * Chốt MỘT LẦN: lượt tải đầu xong (hoặc quá hạn) ⇒ sẵn sàng, không quay lại «đang chờ». Nếu không chốt, observer khác (mục menu)
 * làm query lỗi chạy lại ⇒ `isPending` bật lại ⇒ màn chặn trả `null` ⇒ cả Shell (và menu đang mở) bị gỡ rồi dựng lại.
 */
export const latchReady = (was: boolean, pending: boolean): boolean => was || !pending;

export function useGateReady(pending: boolean, waitMs = GATE_WAIT_MS): boolean {
  const [was, setWas] = useState(false);
  const ready = latchReady(was, pending);
  useEffect(() => {
    if (ready) {
      if (!was) setWas(true);
      return;
    }
    const id = setTimeout(() => setWas(true), waitMs);
    return () => clearTimeout(id);
  }, [ready, was, waitMs]);
  return ready;
}

type Person = { name: string; company: string };

/** Phần trình bày của màn chặn (không gọi API). */
export function GateScreen(p: {
  view: MySignatureView;
  person: Person;
  save: React.ComponentProps<typeof CreateFlow>["save"];
  onDone: () => void;
  onLater: () => void;
  onFail: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("contracts.mySig.gate.title")}
      data-testid="sig-gate"
      className="fixed inset-0 z-50 grid place-items-center overflow-auto bg-background px-4 py-6"
    >
      <div className="grid w-full max-w-xl gap-3.5 rounded-lg border bg-card p-4 shadow-lg sm:p-6">
        <div>
          <p className="font-semibold">
            {t("contracts.mySig.gate.hello", { name: p.person.name })}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("contracts.mySig.gate.sub", { company: p.person.company })}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{t("contracts.mySig.gate.lead")}</p>
        <CreateFlow
          view={p.view}
          person={{ name: p.person.name }}
          save={p.save}
          onDone={p.onDone}
          onFail={p.onFail}
          allowLater={!p.view.settings.required}
          onLater={p.onLater}
          finalLabel={{
            main: t("contracts.mySig.gate.saveEnter"),
            initials: t("contracts.mySig.gate.saveInitials"),
          }}
        />
      </div>
    </div>
  );
}

export function FirstLoginGate({
  person,
  enabled,
  children,
}: {
  person: Person | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const q = useMySignature(enabled && person !== null);
  const create = useCreateSignature();
  const [later, setLater] = useState(readLater);
  const ready = useGateReady(q.isPending);
  if (q.isError)
    console.warn("[signature] không đọc được trạng thái chữ ký — cho vào app", q.error);
  if (enabled && person && !ready) return null; // chờ một lượt gọi để không loé app rồi mới chặn
  if (!person || !q.data || !shouldBlock(q.data, later)) return <>{children}</>;
  return (
    <GateScreen
      view={q.data}
      person={person}
      save={(kind, png, method) => create.mutateAsync({ kind, method, png })}
      onDone={() => toast(t("contracts.mySig.gate.saved"), "ok")}
      onFail={() => toast(t("contracts.mySig.gate.saveFail"), "late")}
      onLater={() => {
        writeLater();
        setLater(true);
        toast(t("contracts.mySig.gate.laterToast"), "ok");
      }}
    />
  );
}
