import { formatEventDate } from "../lib/eventSlate";

function dateParts(value) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return { weekday: "DATE", day: "—" };
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    day: date.toLocaleDateString("en-US", { day: "numeric" }),
  };
}

export default function EventDateSelector({ groups = [], value, onChange, label = "Event date" }) {
  if (!groups.length) return null;
  return (
    <section className="event-date" aria-label={label}>
      <div className="event-date__label">{label}</div>
      <div className="event-date__rail" role="tablist" aria-label={label}>
        {groups.map((group) => {
          const parts = dateParts(group.date);
          return (
          <button
            type="button"
            role="tab"
            aria-selected={group.date === value}
            className={`event-date__tab${group.date === value ? " is-active" : ""}`}
            key={group.date}
            onClick={() => onChange(group.date)}
            aria-label={`${formatEventDate(group.date)} · ${group.games.length} ${group.games.length === 1 ? "game" : "games"}`}
          >
            <span>{parts.weekday}</span>
            <strong>{parts.day}</strong>
          </button>
        )})}
      </div>
    </section>
  );
}

export const EVENT_DATE_CSS = `
.event-date{min-width:0;margin:16px 0 18px}.event-date__label{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.event-date__rail{display:flex;gap:0;max-width:100%;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x mandatory;border:1px solid #926c25;border-radius:9px;background:#0b0e0f;scrollbar-width:none}.event-date__rail::-webkit-scrollbar{display:none}.event-date__tab{appearance:none;flex:1 0 25%;min-width:74px;border:0;border-radius:0;background:#0c0f10;color:#91928c;padding:9px 8px;text-align:center;cursor:pointer;scroll-snap-align:start}.event-date__tab+.event-date__tab{border-left:1px solid #3b3c37}.event-date__tab span{display:block;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:9px;font-weight:700;letter-spacing:.8px;white-space:nowrap}.event-date__tab strong{display:block;margin-top:4px;font-family:Manrope,system-ui,sans-serif;font-size:19px;line-height:1;font-weight:800;color:#dad9d3}.event-date__tab.is-active{background:linear-gradient(180deg,#ebca7d,#d4a94f);color:#17140d;box-shadow:inset 0 0 18px rgba(255,238,174,.18)}.event-date__tab.is-active span,.event-date__tab.is-active strong{color:#17140d}@media(max-width:350px){.event-date__tab{min-width:68px;padding-left:5px;padding-right:5px}}`;
