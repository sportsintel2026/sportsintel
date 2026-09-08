import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import sharp from "sharp";

const WIDTH = 1200;
const HEIGHT = 630;

function clean(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

function xml(value) {
  return clean(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function clip(value, max) {
  const text = clean(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function wrap(value, max = 31, limit = 2) {
  const words = clean(value).split(" ").filter(Boolean);
  const lines = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > max) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
  }
  if (lines.length > limit) {
    const kept = lines.slice(0, limit);
    kept[limit - 1] = clip(`${kept[limit - 1]} ${lines.slice(limit).join(" ")}`, max);
    return kept;
  }
  return lines;
}

function chunkUrl(value, max = 48) {
  const text = clean(value);
  const lines = [];
  for (let start = 0; start < text.length && lines.length < 3; start += max) {
    lines.push(text.slice(start, start + max));
  }
  if (text.length > max * 3) lines[2] = `${lines[2].slice(0, -1)}…`;
  return lines;
}

export function shareImagePath(pathname) {
  const cleanPath = clean(pathname).replace(/^\/+|\/+$/g, "");
  if (!cleanPath || !/^[a-z0-9/_-]+$/i.test(cleanPath)) throw new Error(`share card: invalid route path ${pathname}`);
  return `/share/${cleanPath}.png`;
}

export function shareCardSvg(spec) {
  const titleLines = Array.isArray(spec.titleLines) && spec.titleLines.length
    ? spec.titleLines.map((line) => clip(line, 34)).slice(0, 2)
    : wrap(spec.title, 31, 2);
  const title = titleLines.map((line, index) => `<text x="76" y="${236 + index * 76}" class="title">${xml(line)}</text>`).join("");
  const matchup = spec.matchup ? `<text x="78" y="402" class="matchup">${xml(clip(spec.matchup, 58))}</text>` : "";
  const detail = spec.detail ? `<text x="78" y="446" class="detail">${xml(clip(spec.detail, 76))}</text>` : "";
  const context = spec.context ? `<text x="78" y="489" class="context">${xml(clip(spec.context, 88))}</text>` : "";
  const url = chunkUrl(spec.url).map((line, index) => `<text x="1123" y="${538 + index * 19}" text-anchor="end" class="url">${xml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#08090b"/><stop offset="0.62" stop-color="#101310"/><stop offset="1" stop-color="#07100c"/></linearGradient>
      <radialGradient id="glow" cx="82%" cy="18%" r="70%"><stop offset="0" stop-color="#35db91" stop-opacity=".20"/><stop offset=".52" stop-color="#35db91" stop-opacity=".03"/><stop offset="1" stop-color="#35db91" stop-opacity="0"/></radialGradient>
      <pattern id="grid" width="44" height="44" patternUnits="userSpaceOnUse"><path d="M44 0H0V44" fill="none" stroke="#d7b46e" stroke-opacity=".055" stroke-width="1"/></pattern>
      <filter id="soft"><feGaussianBlur stdDeviation="18"/></filter>
    </defs>
    <rect width="1200" height="630" rx="34" fill="url(#bg)"/>
    <rect width="1200" height="630" rx="34" fill="url(#glow)"/>
    <rect width="1200" height="630" rx="34" fill="url(#grid)"/>
    <rect x="24" y="24" width="1152" height="582" rx="25" fill="none" stroke="#d7b46e" stroke-opacity=".7" stroke-width="2"/>
    <path d="M77 128H1123" stroke="#d7b46e" stroke-opacity=".22"/>
    <circle cx="1100" cy="84" r="10" fill="#42d494"/><circle cx="1100" cy="84" r="22" fill="#42d494" opacity=".15" filter="url(#soft)"/>
    <text x="76" y="91" class="brand">WIZE<tspan fill="#d7b46e">PICKS</tspan></text>
    <text x="1070" y="91" text-anchor="end" class="sport">${xml(spec.sport)} · ${xml(spec.kind)}</text>
    <text x="76" y="176" class="eyebrow">${xml(spec.eyebrow || "PUBLIC GAME INTELLIGENCE")}</text>
    ${title}
    ${matchup}${detail}${context}
    <rect x="76" y="526" width="520" height="55" rx="12" fill="#d7b46e"/>
    <text x="336" y="561" text-anchor="middle" class="cta">${xml(spec.cta || "SEE THE FULL WIZEPICKS BREAKDOWN")}</text>
    ${url}
    <style>
      text{font-family:"DejaVu Sans",Arial,sans-serif}.brand{fill:#f8f4ea;font-size:34px;font-weight:900;letter-spacing:1px}.sport{fill:#9da39d;font-size:18px;font-weight:700;letter-spacing:2px}.eyebrow{fill:#42d494;font-size:18px;font-weight:800;letter-spacing:3px}.title{fill:#f7f3e9;font-size:62px;font-weight:900;letter-spacing:-1.4px}.matchup{fill:#d7b46e;font-size:28px;font-weight:800}.detail{fill:#d9ddd7;font-size:21px;font-weight:650}.context{fill:#969d96;font-size:18px;font-weight:650;letter-spacing:.5px}.cta{fill:#15130e;font-size:18px;font-weight:900;letter-spacing:.7px}.url{fill:#a3aaa2;font-size:12px;font-weight:650;letter-spacing:.2px}
    </style>
  </svg>`;
}

export async function writeShareCard(dist, spec) {
  const imagePath = shareImagePath(spec.path);
  const outputPath = join(dist, imagePath.slice(1));
  await mkdir(dirname(outputPath), { recursive: true });
  await sharp(Buffer.from(shareCardSvg({ ...spec, url: `wizepicks.com${spec.path}` })))
    .png({ compressionLevel: 9, quality: 92 })
    .toFile(outputPath);
  return imagePath;
}
