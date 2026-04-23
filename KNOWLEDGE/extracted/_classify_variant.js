// Shared variant → item_type classifier.
// Variants from Futbin card art URLs look like: "0-silver", "3-gold",
// "5-toty", "12-icon", "72-heroes", "11-team-of-the-season",
// "30-fut-birthday", "117-winter-wildcards", etc.
//
// Classification rules (in priority order):
//   icon        → any variant containing 'icon' as a word
//   toty        → 'toty'
//   tots        → 'tots' OR 'team-of-the-season'
//   totw        → 'totw' OR 'in-form' (IF)
//   hero        → 'hero' / 'heroes' (Futbin Heroes promo)
//   rttf        → 'rttf' / 'road-to'
//   normal      → {N-}?{gold|silver|bronze|rare|common|normal}
//   special     → everything else (promos, SBCs, showdown, etc)

function classifyVariant(variant) {
  if (!variant) return "normal";
  const v = String(variant).toLowerCase();
  if (/\bicon\b/.test(v)) return "icon";
  if (/\btoty\b/.test(v)) return "toty";
  if (/\btots\b|team-of-the-season/.test(v)) return "tots";
  if (/\btotw\b|\bin-form\b|\bif\b/.test(v)) return "totw";
  if (/\bhero(es)?\b/.test(v)) return "hero";
  if (/\brttf\b|road-to/.test(v)) return "rttf";
  // Plain card: optional numeric tier prefix + one of the plain words.
  if (/^(\d+-)?(gold|silver|bronze|rare|common|normal)$/.test(v)) return "normal";
  return "special";
}

module.exports = { classifyVariant };
