// Cột phải màn Đăng nhập: showcase thương hiệu (hằng định, không đổi theo bước auth). Chữ lấy từ bảng dịch.
import { t } from "../i18n";

const tx = (k: string): string => t(`community.login.showcase.${k}`);

const ic = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Robot() {
  return (
    <svg className="lg-robot" aria-hidden="true" width="118" height="140" viewBox="0 0 160 190">
      <line
        x1="80"
        y1="14"
        x2="80"
        y2="34"
        stroke="#818cf8"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="80" cy="12" r="8" fill="#67e8f9" />
      <rect x="28" y="34" width="104" height="78" rx="24" fill="#818cf8" />
      <rect x="16" y="58" width="12" height="30" rx="6" fill="#6366f1" />
      <rect x="132" y="58" width="12" height="30" rx="6" fill="#6366f1" />
      <rect x="42" y="48" width="76" height="48" rx="16" fill="#1e1b4b" />
      <circle cx="64" cy="70" r="8" fill="#67e8f9" />
      <circle cx="96" cy="70" r="8" fill="#67e8f9" />
      <path
        d="M68 84 Q80 92 92 84"
        stroke="#67e8f9"
        strokeWidth="4"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="68" y="112" width="24" height="10" fill="#6366f1" />
      <rect x="40" y="122" width="80" height="60" rx="18" fill="#a5b4fc" />
      <circle cx="80" cy="150" r="10" fill="#4f46e5" />
      <circle cx="80" cy="150" r="4" fill="#67e8f9" />
      <rect
        x="18"
        y="128"
        width="16"
        height="40"
        rx="8"
        fill="#818cf8"
        transform="rotate(20 26 128)"
      />
      <rect
        x="126"
        y="128"
        width="16"
        height="40"
        rx="8"
        fill="#818cf8"
        transform="rotate(-150 134 128)"
      />
    </svg>
  );
}

function Feature({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="lg-feat">
      <span className="lg-feat-ic">
        <svg {...ic} aria-hidden="true">
          <path d={icon} />
        </svg>
      </span>
      <span>
        <b>{title}</b>
        <span>{desc}</span>
      </span>
    </div>
  );
}

function Deal(p: { kind: "sell" | "buy"; head: [string, string]; cells: [string, string][] }) {
  return (
    <div className={`lg-deal ${p.kind}`}>
      <div className="lg-dh">
        <span className="k">{p.head[0]}</span>
        <span className="v">{p.head[1]}</span>
      </div>
      {p.cells.map(([k, v]) => (
        <div className="lg-dc" key={k}>
          <span className="k">{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Post(p: {
  kind: "sell" | "buy" | "note";
  ini: string;
  who: string;
  when: string;
  pill: string;
}) {
  return (
    <div className="lg-ph">
      <span className={`lg-av ${p.kind}`}>{p.ini}</span>
      <span className="lg-who">
        <b>{p.who}</b>
        <span>{p.when}</span>
      </span>
      <span className={`lg-pill ${p.kind}`}>{p.pill}</span>
    </div>
  );
}

function FeedWindow() {
  return (
    <div className="lg-win">
      <div className="lg-wbar">
        <span className="lg-dot" />
        <span className="lg-dot" />
        <span className="lg-dot" />
        <span className="lg-wt">{tx("winTitle")}</span>
      </div>
      <div className="lg-wbody">
        <article className="lg-post sell">
          <Post kind="sell" ini="TP" who={tx("p1Who")} when={tx("p1When")} pill={tx("p1Pill")} />
          <div className="lg-ptitle">{tx("p1Title")}</div>
          <Deal
            kind="sell"
            head={[tx("p1Ask"), "42.000₫"]}
            cells={[
              [tx("p1Qty"), tx("p1QtyV")],
              [tx("p1Area"), tx("p1AreaV")],
            ]}
          />
        </article>
        <article className="lg-post buy">
          <Post kind="buy" ini="MN" who={tx("p2Who")} when={tx("p2When")} pill={tx("p2Pill")} />
          <div className="lg-ptitle">{tx("p2Title")}</div>
          <Deal
            kind="buy"
            head={[tx("p2Budget"), "~28.000₫"]}
            cells={[
              [tx("p2Need"), tx("p2NeedV")],
              [tx("p2To"), tx("p2ToV")],
            ]}
          />
        </article>
        <article className="lg-post note">
          <Post kind="note" ini="CQ" who={tx("p3Name")} when={tx("p3When")} pill={tx("p3Pill")} />
          <div className="lg-ptitle last">{tx("p3Title")}</div>
        </article>
      </div>
    </div>
  );
}

export function LoginShowcase() {
  return (
    <section className="lg-show" aria-hidden="true">
      <div className="lg-shead">
        <div>
          <h2>{tx("title")}</h2>
          <p>{tx("desc")}</p>
        </div>
        <Robot />
      </div>
      <div className="lg-chips">
        {[tx("chip1"), tx("chip2"), tx("chip3")].map((c) => (
          <span className="lg-chip" key={c}>
            {c}
          </span>
        ))}
      </div>
      <div className="lg-stats">
        <div>
          <b>120+</b>
          <span>{tx("stat1")}</span>
        </div>
        <div>
          <b>{tx("stat2Num")}</b>
          <span>{tx("stat2")}</span>
        </div>
        <div>
          <b>8</b>
          <span>{tx("stat3")}</span>
        </div>
      </div>
      <div className="lg-sbody">
        <div className="lg-feats">
          <Feature icon="M12 5v14M5 12h14" title={tx("f1")} desc={tx("f1d")} />
          <Feature
            icon="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"
            title={tx("f2")}
            desc={tx("f2d")}
          />
          <Feature
            icon="M9 12h6M10 8l-3 0a4 4 0 100 8h3M14 8h3a4 4 0 110 8h-3"
            title={tx("f3")}
            desc={tx("f3d")}
          />
          <div className="lg-quote">
            <p>{tx("quote")}</p>
            <div className="lg-by">
              <i>TP</i> {tx("p1Who")} · {tx("p1AreaV")}
            </div>
          </div>
        </div>
        <FeedWindow />
      </div>
    </section>
  );
}
