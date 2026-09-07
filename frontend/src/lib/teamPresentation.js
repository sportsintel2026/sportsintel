export function collapseRepeatedTeamWords(value) {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  const normalized = (word) => word.toLowerCase().replace(/[^a-z0-9]/g, "");
  let changed = true;
  while (changed) {
    changed = false;
    for (let start = 0; start < words.length; start += 1) {
      const maxLength = Math.floor((words.length - start) / 2);
      for (let length = maxLength; length >= 1; length -= 1) {
        const left = words.slice(start, start + length).map(normalized).join(" ");
        const right = words.slice(start + length, start + length * 2).map(normalized).join(" ");
        if (left && left === right) {
          words.splice(start + length, length);
          changed = true;
          start = -1;
          break;
        }
      }
      if (changed) break;
    }
  }
  return words.join(" ");
}

export function presentationPickText({ pick, displayName, abbreviation }) {
  const raw = String(pick || "Qualified edge").trim();
  const abbr = String(abbreviation || "").trim();
  if (!abbr || !raw.toLowerCase().startsWith(`${abbr.toLowerCase()} `)) {
    return collapseRepeatedTeamWords(raw);
  }
  return collapseRepeatedTeamWords(`${displayName}${raw.slice(abbr.length)}`);
}
