/* eslint-disable */
// Chem audit — 2026-05-03 — NEW chem rules (manager + chemBonus + hero/icon
// symbol fixes). Mirrors apps/web/src/lib/chemistry.ts logic in plain CJS.
// Pulls each of the 13 players' LATEST submission, computes chem with new
// rules, dumps per-slot breakdown + warnings + total.
require('dotenv').config({ path: 'apps/web/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TIER = {
  club:   [{m:7,p:3},{m:4,p:2},{m:2,p:1}],
  league: [{m:8,p:3},{m:5,p:2},{m:3,p:1}],
  nation: [{m:8,p:3},{m:5,p:2},{m:2,p:1}],
};
const LEAGUE_FAMILIES = {
  "premier league":"fam-eng-top","barclays wsl":"fam-eng-top",
  "serie a tim":"fam-ita-top","serie a enilive":"fam-ita-top","calcio a femminile":"fam-ita-top",
  "ligue 1 mcdonald's":"fam-fra-top","d1 arkema":"fam-fra-top","arkema pl":"fam-fra-top",
  "bundesliga":"fam-ger-top",
  "laliga ea sports":"fam-esp-top","liga f":"fam-esp-top","liga f moeve":"fam-esp-top",
  "eredivisie":"fam-ned-top","nederland vrouwen liga":"fam-ned-top",
  "liga portugal":"fam-por-top","liga portugal feminino":"fam-por-top",
  "swiss super league":"fam-sui-top","brack super league":"fam-sui-top","schweizer damen liga":"fam-sui-top",
  "česká liga":"fam-cze-top","ceska liga žen":"fam-cze-top",
  "scottish prem":"fam-sco-top","scottish premiership":"fam-sco-top","scottish women's league":"fam-sco-top",
  "allsvenskan":"fam-swe-top","sverige liga":"fam-swe-top",
};
const norm = (s) => { if(s==null) return null; const t=s.trim().toLowerCase(); return t||null; };
const getFam = (l) => { const k=norm(l); if(!k) return null; return LEAGUE_FAMILIES[k]??k; };
const pickTier = (c, t) => { for(const r of t) if(c>=r.m) return r.p; return 0; };
function isInPos(card, slot){
  if(!slot) return true;
  const T=slot.trim().toUpperCase(); if(!T) return true;
  if((card.position||'').trim().toUpperCase()===T) return true;
  for(const a of card.positionsAlt||[]) if((a||'').trim().toUpperCase()===T) return true;
  return false;
}
// Authoritative Futbin Fut26ChemistryData.rareTypeRules (2026-05-03).
const RARE_TYPE_RULES = {
  4:   { clubSymbols:1, leagueSymbols:0, leagueSymbolsAllLeagues:true, nationSymbols:2, fullChemInPosition:true },
  11:  { clubSymbols:1, leagueSymbols:5, nationSymbols:1 },
  20:  { clubSymbols:1, leagueSymbols:1, nationSymbols:3 },
  25:  { clubSymbols:1, leagueSymbols:0, leagueSymbolsAllLeagues:true, nationSymbols:2, fullChemInPosition:true },
  28:  { clubSymbols:1, leagueSymbols:1, nationSymbols:3 },
  65:  { clubSymbols:1, leagueSymbols:5, nationSymbols:1 },
  66:  { clubSymbols:1, leagueSymbols:2, nationSymbols:2, fullChemInPosition:true },
  67:  { clubSymbols:1, leagueSymbols:2, nationSymbols:2, fullChemInPosition:true },
  68:  { clubSymbols:1, leagueSymbols:1, nationSymbols:2, fullChemInPosition:true },
  69:  { clubSymbols:0, leagueSymbols:0, leagueSymbolsAllLeagues:true, nationSymbols:3, fullChemInPosition:true },
  70:  { clubSymbols:1, leagueSymbols:1, nationSymbols:3, fullChemInPosition:true },
  87:  { clubSymbols:1, leagueSymbols:2, nationSymbols:1 },
  91:  { clubSymbols:1, leagueSymbols:1, nationSymbols:2 },
  108: { clubSymbols:1, leagueSymbols:1, nationSymbols:1, fullChemInPosition:true },
  116: { clubSymbols:1, leagueSymbols:0, leagueSymbolsAllLeagues:true, nationSymbols:2, fullChemInPosition:true },
  120: { clubSymbols:1, leagueSymbols:5, nationSymbols:1 },
  127: { clubSymbols:1, leagueSymbols:5, nationSymbols:1 },
  129: { clubSymbols:1, leagueSymbols:1, nationSymbols:1, fullChemInPosition:true },
  133: { clubSymbols:1, leagueSymbols:5, nationSymbols:1 },
  150: { clubSymbols:2, leagueSymbols:1, nationSymbols:1 },
};
function extractRareTypeId(variant){
  if(!variant) return null;
  const m = String(variant).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}
function deriveChemBonus(itemType, variant){
  const v=(variant||'').toLowerCase(); const t=(itemType||'').toLowerCase();
  const rareId = extractRareTypeId(v);
  if (rareId != null && RARE_TYPE_RULES[rareId]) return RARE_TYPE_RULES[rareId];
  if(t==='icon'||/\bicon\b/.test(v)) return RARE_TYPE_RULES[4];
  if(t==='hero'||/\bhero(es)?\b/.test(v)) return RARE_TYPE_RULES[66];
  if(/\bend-of-an-era\b/.test(v)) return { clubSymbols:0, leagueSymbols:0, leagueSymbolsAllLeagues:true, nationSymbols:2, fullChemInPosition:true };
  if(/\bcornerstones?\b/.test(v)) return { clubSymbols:2 };
  if(/\bsquad-foundations?\b/.test(v)) return { leagueSymbols:2 };
  if(/\bworld-tour\b/.test(v)) return { nationSymbols:2 };
  if(/\bfestival-of-football-captains?\b|\bfof-captains?\b/.test(v)) return { nationSymbols:3 };
  if(/\bpositional-excellence\b/.test(v)) return { fullChemInPosition:true };
  return null;
}
function resolveBonus(card){ if(card.chemBonus!=null) return card.chemBonus; return deriveChemBonus(card.itemType, card.variant); }
function buildPool(cards){
  const clubs=new Map(), leagues=new Map(), nations=new Map();
  let iconCount=0;
  for(const c of cards){
    const b=resolveBonus(c);
    const cs=b?.clubSymbols??1, ls=b?.leagueSymbols??1, ns=b?.nationSymbols??1, all=b?.leagueSymbolsAllLeagues??false;
    const ck=norm(c.club), lk=getFam(c.league), nk=norm(c.nation);
    if(ck&&cs>0) clubs.set(ck,(clubs.get(ck)||0)+cs);
    if(lk&&ls>0) leagues.set(lk,(leagues.get(lk)||0)+ls);
    if(nk&&ns>0) nations.set(nk,(nations.get(nk)||0)+ns);
    if(all) iconCount++;
  }
  return { clubs, leagues, nations, iconCount };
}
function scoreSlot(fill, pool, manager){
  if(!fill.card) return { chem:0, breakdown:null };
  const card=fill.card;
  if(!isInPos(card, fill.positionInLineup)){
    return { chem:0, oop:true, breakdown:null };
  }
  const b=resolveBonus(card);
  if(b?.fullChemInPosition) return { chem:3, breakdown:{ flat3:true, source:b } };
  const ck=norm(card.club), lk=getFam(card.league), nk=norm(card.nation);
  const cc = ck ? (pool.clubs.get(ck)||0) : 0;
  const lc = lk ? (pool.leagues.get(lk)||0) + pool.iconCount : 0;
  const nc = nk ? (pool.nations.get(nk)||0) : 0;
  const cp=pickTier(cc,TIER.club), lp=pickTier(lc,TIER.league), np=pickTier(nc,TIER.nation);
  let sum=cp+lp+np;
  let mgrAdd=0;
  if(manager){
    const mn=norm(manager.nation), ml=getFam(manager.league);
    if((mn&&mn===nk)||(ml&&ml===lk)){ sum+=1; mgrAdd=1; }
  }
  return { chem:Math.min(3, sum), breakdown:{ club:cc, clubPts:cp, league:lc, leaguePts:lp, nation:nc, nationPts:np, leagueFam:lk, mgr:mgrAdd } };
}

(async () => {
  const targetSubmission = process.argv[2] || null;
  const { data: pl } = await sb
    .from('players')
    .select('id, gamer_tag, users:users!players_user_id_fkey(display_name)')
    .is('deleted_at', null)
    .order('id');
  const players = (pl||[]).map(r => ({
    id: r.id, gamer_tag: r.gamer_tag,
    display_name: Array.isArray(r.users) ? r.users[0]?.display_name : r.users?.display_name,
  }));

  for (const p of players) {
    const { data: subs } = await sb
      .from('squad_submissions')
      .select('id, week_start_date, validation_status, formation, submitted_at')
      .eq('player_id', p.id)
      .is('deleted_at', null)
      .order('week_start_date', { ascending: false })
      .limit(1);
    const sub = subs?.[0] || null;
    if (!sub) continue;
    if (targetSubmission && !sub.id.startsWith(targetSubmission)) continue;
    const { data: items } = await sb
      .from('squad_player_items')
      .select('slot_index, name, rating, position, item_type, value, nationality_flag')
      .eq('submission_id', sub.id)
      .is('deleted_at', null)
      .order('slot_index');
    const namesUnique = Array.from(new Set((items||[]).map(r => r.name)));
    let fcRows = [];
    if (namesUnique.length) {
      const { data: fc } = await sb
        .from('fc26_players')
        .select('name, rating, club, league, nation, position, alt_positions, attributes')
        .eq('source_dataset', 'futbin.com')
        .is('deleted_at', null)
        .in('name', namesUnique);
      fcRows = fc || [];
    }
    const fcMap = new Map(fcRows.map(r => [r.name.toLowerCase()+'|'+r.rating, r]));
    const enriched = (items||[]).map(it => {
      const fc = fcMap.get(it.name.toLowerCase()+'|'+it.rating);
      const variant = fc?.attributes?.futbin_variant || null;
      const chemBonus = (fc?.attributes?.chem_bonus && typeof fc.attributes.chem_bonus === 'object') ? fc.attributes.chem_bonus : null;
      return Object.assign({}, it, { fc: fc || null, variant, chemBonus });
    });
    const starting = enriched.filter(e => e.slot_index>=0 && e.slot_index<=10);
    const cards = starting.map(it => ({
      club: it.fc?.club ?? null,
      league: it.fc?.league ?? null,
      nation: it.fc?.nation ?? null,
      position: it.fc?.position ?? it.position,
      positionsAlt: it.fc?.alt_positions ?? [],
      itemType: it.item_type,
      variant: it.variant,
      chemBonus: it.chemBonus,
      name: it.name,
    }));
    const fills = starting.map((it, idx) => ({ card: cards[idx], positionInLineup: it.position }));
    const pool = buildPool(cards);
    const perSlot = []; let total = 0; const warnings = [];
    for (const f of fills) {
      const r = scoreSlot(f, pool, null);
      perSlot.push(r);
      total += r.chem;
      if (r.oop) warnings.push(`${f.card.name} out-of-position at ${f.positionInLineup} (primary=${f.card.position}, alts=[${(f.card.positionsAlt||[]).join(',')||'NONE'}])`);
    }

    console.log('\n══════════════════════════════════════════════════════════════════════════════');
    console.log('Player:', (p.display_name||p.gamer_tag), '| Submission:', sub.id, '| Week:', sub.week_start_date, '| Formation:', sub.formation||'(null)');
    console.log('══════════════════════════════════════════════════════════════════════════════');
    console.log('TOTAL:', total + '/33');
    if (warnings.length) {
      console.log('WARNINGS (' + warnings.length + ' OOP):');
      for (const w of warnings) console.log('  ⚠', w);
    }
    console.log('\nLINK POOL:');
    console.log('  clubs:    ', [...pool.clubs.entries()].map(([k,v]) => `${k}=${v}`).join(', ') || '(none)');
    console.log('  leagues:  ', [...pool.leagues.entries()].map(([k,v]) => `${k}=${v}`).join(', ') || '(none)');
    console.log('  nations:  ', [...pool.nations.entries()].map(([k,v]) => `${k}=${v}`).join(', ') || '(none)');
    console.log('  iconCount:', pool.iconCount);
    console.log('\nPER-SLOT:');
    for (let i = 0; i < starting.length; i++) {
      const it = starting[i]; const r = perSlot[i]; const card = cards[i];
      const b = resolveBonus(card);
      const bonusLabel = b ? `BONUS=${JSON.stringify(b)}` : '';
      const altLabel = (card.positionsAlt||[]).length ? `[${card.positionsAlt.join(',')}]` : '[NONE]';
      const prefix = `slot ${i.toString().padStart(2)}`.padEnd(8);
      const nm = (it.name||'?').padEnd(34);
      const pos = (`${card.position}/${altLabel}`).padEnd(20);
      const slot = (it.position||'?').padEnd(5);
      const itype = (it.item_type||'?').padEnd(8);
      const vt = (it.variant||'-').padEnd(28);
      const chem = r.chem;
      const bd = r.breakdown ? (r.breakdown.flat3 ? 'flat3 (full chem in pos)' : `c${r.breakdown.clubPts}+l${r.breakdown.leaguePts}+n${r.breakdown.nationPts}${r.breakdown.mgr?'+m1':''} (club ct=${r.breakdown.club}, lg ct=${r.breakdown.league}, nat ct=${r.breakdown.nation})`) : (r.oop ? 'OOP' : '-');
      console.log(`  ${prefix} ${nm} ${pos} pickedAt=${slot} ${itype} ${vt} chem=${chem} | ${bd}`);
    }
  }
})();
