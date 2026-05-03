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

// Granular classifier: returns coarse `itemType` (for the fc26_players
// `item_type` column, same set as classifyVariant) PLUS a granular
// `promoClass` tag + EA chem-bonus shape for promo subclasses that confer
// chemistry symbols different from the bucket default.
//
// The `chemBonus` shape mirrors `apps/web/src/lib/chemistry.ts::ChemBonus`:
//   { clubSymbols?: number,
//     leagueSymbols?: number,
//     leagueSymbolsAllLeagues?: boolean,
//     nationSymbols?: number,
//     fullChemInPosition?: boolean }
//
// When the scrapers persist this into `fc26_players.attributes.chem_bonus`,
// the chemistry calc auto-picks it up (lib/chemistry.ts reads
// `card.chemBonus` as an explicit override before falling back to
// deriveChemBonus()).
//
// Order matters: icon/hero compounds (e.g. "155-toty-icon",
// "97-joga-bonito-hero") must classify as icon/hero NOT toty/joga, so
// those checks run first.
function classifyVariantWithBonus(variant) {
  const v = String(variant || "").toLowerCase();

  if (!v) {
    return { itemType: "normal", promoClass: null, chemBonus: null };
  }

  // Icon — any compound. Highest priority: icons inherit Icon chem regardless
  // of the originating promo (toty-icon, winter-wildcard-icon, etc).
  if (/\bicon\b/.test(v)) {
    return {
      itemType: "icon",
      promoClass: null,
      chemBonus: {
        clubSymbols: 0,
        leagueSymbols: 0,
        leagueSymbolsAllLeagues: true,
        nationSymbols: 2,
        fullChemInPosition: true,
      },
    };
  }

  // Hero — any compound (heroes, winter-wildcards-hero, joga-bonito-hero,
  // fantasy-fc-hero, fut-birthday-hero, ultimate-scream-hero, etc).
  if (/\bhero(es)?\b/.test(v)) {
    return {
      itemType: "hero",
      promoClass: null,
      chemBonus: {
        clubSymbols: 0,
        leagueSymbols: 2,
        nationSymbols: 1,
        fullChemInPosition: true,
      },
    };
  }

  // TOTY — Team of the Year. EA does not publish a chem bonus for TOTY,
  // base symbols apply.
  if (/\btoty\b/.test(v)) {
    return { itemType: "toty", promoClass: null, chemBonus: null };
  }

  // TOTS — Team of the Season.
  if (/\btots\b|team-of-the-season/.test(v)) {
    return { itemType: "tots", promoClass: null, chemBonus: null };
  }

  // TOTW / In-Form.
  if (/\btotw\b|\bin-form\b|\bif\b/.test(v)) {
    return { itemType: "totw", promoClass: null, chemBonus: null };
  }

  // RTTF — Road to the Final.
  if (/\brttf\b|road-to/.test(v)) {
    return { itemType: "rttf", promoClass: null, chemBonus: null };
  }

  // End of an Era — full-icon-style chem (all leagues, +2 nation, full
  // chem in position).
  if (/\bend-of-an-era\b/.test(v)) {
    return {
      itemType: "special",
      promoClass: "end-of-an-era",
      chemBonus: {
        clubSymbols: 0,
        leagueSymbols: 0,
        leagueSymbolsAllLeagues: true,
        nationSymbols: 2,
        fullChemInPosition: true,
      },
    };
  }

  // Cornerstones — +1 extra club symbol (=2 club symbols total).
  if (/\bcornerstones?\b/.test(v)) {
    return {
      itemType: "special",
      promoClass: "cornerstones",
      chemBonus: { clubSymbols: 2 },
    };
  }

  // Squad Foundations — +1 extra league symbol (=2 league symbols).
  if (/\bsquad-foundations?\b/.test(v)) {
    return {
      itemType: "special",
      promoClass: "squad-foundations",
      chemBonus: { leagueSymbols: 2 },
    };
  }

  // World Tour — +1 extra nation symbol (=2 nation symbols).
  if (/\bworld-tour\b/.test(v)) {
    return {
      itemType: "special",
      promoClass: "world-tour",
      chemBonus: { nationSymbols: 2 },
    };
  }

  // Festival of Football Captains — +2 extra nation symbols (=3 nation
  // symbols).
  if (/\bfestival-of-football-captains?\b|\bfof-captains?\b/.test(v)) {
    return {
      itemType: "special",
      promoClass: "festival-of-football-captains",
      chemBonus: { nationSymbols: 3 },
    };
  }

  // Positional Excellence Evo — full chem in primary position regardless
  // of links.
  if (/\bpositional-excellence\b/.test(v)) {
    return {
      itemType: "special",
      promoClass: "positional-excellence",
      chemBonus: { fullChemInPosition: true },
    };
  }

  // Plain gold/silver/bronze/rare/common/normal cards.
  if (/^(\d+-)?(gold|silver|bronze|rare|common|normal)$/.test(v)) {
    return { itemType: "normal", promoClass: null, chemBonus: null };
  }

  // Anything else — special bucket, no granular tag (chem calc falls back
  // to deriveChemBonus() defaults).
  return { itemType: "special", promoClass: null, chemBonus: null };
}

module.exports = { classifyVariant, classifyVariantWithBonus };
