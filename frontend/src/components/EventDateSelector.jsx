import { formatEventDate } from "../lib/eventSlate";

export default function EventDateSelector({ groups = [], value, onChange, label = "Event date" }) {
  if (!groups.length) return null;
  return (
    <section className="event-date" aria-label={label}>
      <div className="event-date__label">{label}</div>
      <div className="event-date__rail" role="tablist" aria-label={label}>
        {groups.map((group) => (
          <button
            type="button"
            role="tab"
            aria-selected={group.date === value}
            className={`event-date__tab${group.date === value ? " is-active" : ""}`}
            key={group.date}
            onClick={() => onChange(group.date)}
          >
            <span>{formatEventDate(group.date, { compact: true })}</span>
            <small>{group.games.length} {group.games.length === 1 ? "game" : "games"}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export const EVENT_DATE_CSS = `
.event-date{min-width:0;margin:12px 0 16px}.event-date__label{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:700;letter-spacing:1.35px;text-transform:uppercase;color:#74808a;margin:0 2px 7px}.event-date__rail{display:flex;gap:8px;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x proximity;padding:0 1px 4px;scrollbar-width:none}.event-date__rail::-webkit-scrollbar{display:none}.event-date__tab{appearance:none;flex:0 0 auto;min-width:112px;max-width:180px;border:1px solid #263039;border-radius:11px;background:#101519;color:#aeb8bf;padding:9px 11px;text-align:left;cursor:pointer;scroll-snap-align:start}.event-date__tab span{display:block;font-family:"Barlow Condensed",sans-serif;font-size:15px;font-weight:800;letter-spacing:.2px;white-space:nowrap}.event-date__tab small{display:block;margin-top:3px;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:8px;letter-spacing:.55px;color:#66727c}.event-date__tab.is-active{border-color:#C9A86A;background:linear-gradient(180deg,#211c12,#12130f);color:#f2dfb4;box-shadow:inset 0 0 0 1px rgba(201,168,106,.11)}.event-date__tab.is-active small{color:#a98f5e}@media(max-width:1023px){.event-date{position:sticky;top:80px;z-index:32;margin-top:0;padding:8px 0 4px;background:linear-gradient(180deg,#0b0d11 0%,#0b0d11 84%,rgba(11,13,17,.92) 100%)}}@media(max-width:430px){.event-date__tab{min-width:104px;padding:8px 10px}.event-date__tab span{font-size:14px}}`;
