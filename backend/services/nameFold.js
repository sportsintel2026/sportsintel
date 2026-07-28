// WZ-NAMEFOLD-2026-07-28 :: shared letter folding for name-match keys.
//
// Every name normaliser in this repo strips accents with NFD + combining-mark removal. That is
// correct for accents -- "Rakić" decomposes to "c" + a mark, "Rębecki" to "e" + a mark -- and it
// is why those names have always matched fine.
//
// It does NOT work for STROKED letters. "ł" (U+0142) is a single codepoint with no canonical
// decomposition, so NFD leaves it intact and the following [^a-z0-9] pass eats it as punctuation:
//
//     "Jan Błachowicz"  ->  "jan b achowicz"     (a space where the l should be)
//
// That key can never match The Odds API's "jan blachowicz". In routes/ufc.js the odds join needs
// BOTH corners matched, so one mangled Polish name blanks the whole bout -- no odds, no pick, no
// factors -- while every accented name on the same card works, which is why it stayed invisible.
//
// Folded here, once, so ufc.js (odds join) and espnMma.js (grading fallback) cannot disagree about
// what a letter folds to. Their two normalisers are otherwise DIFFERENT on purpose -- espnMma glues
// and drops jr/sr/iii suffixes, ufc.js keeps word spacing -- so they are not merged, only this
// shared gap is.
//
// Both cases are mapped so callers may fold before or after lowercasing.
const STROKE = {
  "\u0142": "l", "\u0141": "L",   // ł Ł  Polish
  "\u0111": "d", "\u0110": "D",   // đ Đ  Croatian / Serbian / Vietnamese
  "\u00f8": "o", "\u00d8": "O",   // ø Ø  Scandinavian
  "\u0127": "h", "\u0126": "H",   // ħ Ħ  Maltese
  "\u0167": "t", "\u0166": "T",   // ŧ Ŧ  Sami
  "\u00f0": "d", "\u00d0": "D",   // ð Ð  Icelandic
  "\u00fe": "th", "\u00de": "Th", // þ Þ  Icelandic
  "\u0131": "i", "\u0130": "I",   // ı İ  Turkish
  "\u00e6": "ae", "\u00c6": "AE", // æ Æ
  "\u0153": "oe", "\u0152": "OE", // œ Œ
  "\u00df": "ss",                 // ß
};
const STROKE_RE = new RegExp("[" + Object.keys(STROKE).join("") + "]", "g");

// Replace stroked/ligature letters with their ASCII equivalents. Leaves every other character
// untouched, so a name that already normalised correctly is byte-identical afterwards.
function foldStrokes(s) {
  return String(s == null ? "" : s).replace(STROKE_RE, (c) => STROKE[c]);
}

module.exports = { foldStrokes };
