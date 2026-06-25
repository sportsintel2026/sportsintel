// useSport.js — one shared source of truth for the selected sport. WIZEPICKS-USESPORT-2026-06-25
//
// The whole app reads "which sport" from the URL (?sport=mlb|nba|nfl|cfb|nhl).
// That is what lets a SINGLE bottom sport bar drive every page and persist as
// you move between pages — instead of each page keeping its own private copy.
//
// It is a drop-in replacement for  const [sport,setSport]=useState("mlb")
//   - returns [sport, setSport]
//   - setSport accepts a value OR an updater fn, exactly like useState
//   - writing uses { replace:true } so flipping sport does not spam the back stack
//
// Pages that adopt it keep working identically; the only difference is the value
// now lives in the URL, where the sport bar can also set it.

import { useSearchParams } from "react-router-dom";

const VALID = ["mlb", "nba", "nfl", "cfb", "nhl"];

export function useSport(defaultSport = "mlb") {
  const [params, setParams] = useSearchParams();
  const raw = (params.get("sport") || defaultSport).toLowerCase();
  const sport = VALID.includes(raw) ? raw : defaultSport;

  const setSport = (next) => {
    const value = typeof next === "function" ? next(sport) : next;
    const clean = VALID.includes(String(value).toLowerCase())
      ? String(value).toLowerCase()
      : defaultSport;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.set("sport", clean);
        return p;
      },
      { replace: true }
    );
  };

  return [sport, setSport];
}

export default useSport;
