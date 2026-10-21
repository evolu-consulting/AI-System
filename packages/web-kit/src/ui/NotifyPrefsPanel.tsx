// gap-c #11/#12 · form tùy chọn thông báo của CHÍNH người dùng: kênh (email, đẩy + "Gửi thử"), mốc nhắc hạn (mặc định công ty / chọn riêng),
// cảnh báo giá, nhận cả HĐ của người mình quản lý. Bật "thông báo đẩy" mới xin quyền trình duyệt + đăng ký push (chỉ HTTPS/localhost).
import { type CSSProperties, type ReactElement, useEffect, useId, useMemo, useState } from "react";
import { type NotifyTransport, notifyClient } from "../notify/client";
import { usePrefs } from "../notify/hooks";
import { mergeLabels, type NotifyLabels } from "../notify/labels";
import {
  browserPushDeps,
  disablePush,
  enablePush,
  isSubscribed,
  type PushResult,
} from "../notify/push";

const LEADS = [60, 30, 7, 1, 0] as const;
type Lead = (typeof LEADS)[number][];
const BOX: CSSProperties = { display: "grid", gap: 8, padding: "12px 0" };
const ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 8 };

const pushMsg = (r: PushResult, L: NotifyLabels): string | null =>
  r === "ok"
    ? null
    : (
        {
          denied: L.pushDenied,
          insecure: L.pushInsecure,
          unsupported: L.pushUnsupported,
          no_key: L.pushNoKey,
          error: L.pushError,
        } as const
      )[r];

export function NotifyPrefsPanel(p: {
  labels?: Partial<NotifyLabels>;
  swUrl?: string;
  transport?: NotifyTransport;
}): ReactElement {
  const L = mergeLabels(p.labels);
  const id = useId();
  const client = useMemo(() => notifyClient(p.transport), [p.transport]);
  const { prefs, error, save } = usePrefs(client);
  const deps = useMemo(
    () =>
      browserPushDeps(
        {
          vapidKey: () => client.pushKey().then((k) => k.public_key),
          save: (b) => client.savePush(b),
          remove: (e) => client.removePush(e),
        },
        p.swUrl,
      ),
    [client, p.swUrl],
  );
  const [subscribed, setSubscribed] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void isSubscribed(deps).then(setSubscribed);
  }, [deps]);
  const ready = prefs !== null;
  useEffect(() => {
    // Đến từ "Cài đặt thông báo" (#prefs): cuộn tới form khi đã có dữ liệu.
    if (ready && window.location.hash === "#prefs")
      document.getElementById("prefs")?.scrollIntoView();
  }, [ready]);
  if (!prefs) return <p>{error ? L.failed : L.loading}</p>;

  const togglePush = async (on: boolean) => {
    setNote(null);
    if (on) {
      const r = await enablePush(deps);
      if (r !== "ok") return setNote(pushMsg(r, L));
      setSubscribed(true);
      await save(prefs, { push: true });
    } else {
      await disablePush(deps);
      setSubscribed(false);
      await save(prefs, { push: false });
    }
  };
  const test = async () => {
    const r = await client.pushTest().catch(() => null);
    setNote(r === null ? L.pushError : r.created > 0 ? L.pushTestSent : L.pushTestWait);
  };
  const toggleLead = (d: number) => {
    const next = prefs.remind_days.includes(d)
      ? prefs.remind_days.filter((x) => x !== d)
      : [...prefs.remind_days, d];
    void save(prefs, { remind_days: next.sort((a, b) => b - a) as Lead });
  };
  const check = (key: string, text: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label key={key} htmlFor={`${id}-${key}`} style={ROW}>
      <input
        id={`${id}-${key}`}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {text}
    </label>
  );
  return (
    <section id="prefs" aria-label={L.prefsTitle}>
      <fieldset style={{ ...BOX, border: 0, margin: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600, padding: 0 }}>{L.channels}</legend>
        {check("email", L.email, prefs.email, (v) => void save(prefs, { email: v }))}
        <div style={ROW}>
          {check("push", L.push, prefs.push && subscribed, (v) => void togglePush(v))}
          {prefs.push && subscribed && (
            <button type="button" onClick={() => void test()}>
              {L.pushTest}
            </button>
          )}
        </div>
        {note && (
          <p role="status" style={{ margin: 0, fontSize: 13 }}>
            {note}
          </p>
        )}
      </fieldset>
      <fieldset style={{ ...BOX, border: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, padding: 0 }}>{L.remindDays}</legend>
        <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>{L.remindDaysHint}</p>
        {check(
          "lead-default",
          L.remindDaysDefault,
          !prefs.remind_days_custom,
          (v) => void save(prefs, { remind_days: v ? null : (prefs.remind_days_default as Lead) }),
        )}
        {prefs.remind_days_custom && (
          <div style={{ ...ROW, flexWrap: "wrap" }}>
            {LEADS.map((d) =>
              check(`lead-${d}`, L.daysBefore(d), prefs.remind_days.includes(d), () =>
                toggleLead(d),
              ),
            )}
          </div>
        )}
      </fieldset>
      <fieldset style={{ ...BOX, border: 0, margin: 0 }}>
        <legend style={{ fontWeight: 600, padding: 0 }}>{L.alerts}</legend>
        {check(
          "price",
          L.priceAlerts,
          prefs.price_alerts,
          (v) => void save(prefs, { price_alerts: v }),
        )}
        {check(
          "managed",
          L.includeManaged,
          prefs.include_managed,
          (v) => void save(prefs, { include_managed: v }),
        )}
      </fieldset>
      {error && <p role="alert">{L.failed}</p>}
    </section>
  );
}
