// CR-125 · cr125-fix-docusign-return · «Ký ngay» không bị chặn lượt oan: người ký công ty chưa đến lượt theo dữ liệu hub (người ký trước đã
// ký ở nhà cung cấp nhưng webhook trễ / không tới được máy cục bộ) ⇒ hỏi nhà cung cấp MỘT lần rồi đọc lại phong bì. Hết chặn ⇒ đi tiếp;
// vẫn chặn ⇒ `signerInTurn` báo ESIGN_NOT_YOUR_TURN. Nhà cung cấp ký thử (demo) không có trạng thái bên ngoài ⇒ bỏ qua.
import type { PackWho } from "../../kit/public";
import { isTurnOf } from "../domain/esign-signer.rules";
import type { EnvelopeRow, ESignProvider, ESignRepo } from "./esign.ports";
import { errName } from "./esign-void";

type Run = <T>(fn: (r: { esign: ESignRepo }) => Promise<T>) => Promise<T>;

export type FreshTurnDeps = {
  avail: (key: string) => ESignProvider | null;
  sync: (tid: string, row: EnvelopeRow, run: Run) => Promise<void>;
  openOf: (who: PackWho, id: string) => Promise<EnvelopeRow>;
  run: (who: PackWho) => Run;
  warn?: ((msg: string, meta: Record<string, unknown>) => void) | undefined;
};

export const freshTurnOf =
  (d: FreshTurnDeps) =>
  async (who: PackWho, id: string, e: EnvelopeRow): Promise<EnvelopeRow> => {
    const me = e.signers.find((s) => s.role === "company" && s.client_user_id === who.userId);
    if (!me || isTurnOf(e.signers, me) || d.avail(e.provider)?.demo) return e;
    await d
      .sync(who.tenantId, e, d.run(who))
      .catch((x: unknown) =>
        d.warn?.("esign-turn-sync-failed", { contract_id: id, error: errName(x) }),
      );
    return d.openOf(who, id);
  };
