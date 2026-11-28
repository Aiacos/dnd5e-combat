/**
 * K1 (creature re-save, SPEC §322): what the original English text of a monster ability says about the END of its conditions, and
 * that the 2024 Monster Manual writes in no data — the Carrion Crawler's Tentacles, the "Euphoria Breath", the Vrock's Spores
 * "repeat the save at the end of each of their turns"; the Basilisk's Gaze and the Gorgon's Breath have a first failure
 * (Restrained) and a second (Petrified); the "Sleep Breath" and the Jackalwere's Gaze "end if the target takes damage".
 * dnd5e's rules do not play it: without this text, the condition lasts the whole minute (54 high gaps in the re-save).
 *
 * Read like M4 (`core/durations.mjs`) and M1 (`core/multiattack.mjs`): the English text, kept by Babele under a translated world.
 * Returns declarations of the content schema (`triggers`, `via: "effect"`), which the content shipped by identifier replaces
 * if it declares any. An ability with several outcomes (Eye Rays: charm, paralysis, sleep…) is read by segment, and each rule
 * applies only to the effects whose condition is named in its segment (`fromEffect`).
 *
 * Pure: plain strings and objects.
 */

const CONDITIONS = ["blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible", "paralyzed", "petrified",
  "poisoned", "prone", "restrained", "stunned", "unconscious"];

/** Readable text: enrichers resolved into "…" except condition references ("&Reference[Paralyzed]" → "Paralyzed"). */
export function plainText(html) {
  return String(html ?? "")
    .replace(/&(?:amp;)?Reference\[([A-Za-z]+)[^\]]*\](?:\{([^}]*)\})?/g, (_, id, label) => label || id)
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, "$1")
    .replace(/\[\[[^\]]*\]\](?:\{([^}]*)\})?/g, (_, label) => label || "…")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[’]/g, "'")
    .replace(/\s+/g, " ").trim();
}

/**
 * The segments of an ability with several outcomes: "1: Charm Ray. … 2: Paralyzing Ray. …" (Eye Rays), "First Roar. … Second
 * Roar. …" (Sphinx of Valor's Roar), otherwise the whole text. "First Failure:" (colon) does not split it.
 */
function segments(text) {
  const parts = text.split(/(?=\b\d{1,2}\s*:\s*[A-Z][A-Za-z' ]{2,40}\.)|(?=\b(?:First|Second|Third|Fourth|Fifth) [A-Z][a-z]+\.\s)/);
  return parts.length > 1 ? parts : [text];
}

/** The conditions named in a passage ("has the Paralyzed condition"). */
export function conditionsIn(text) {
  return CONDITIONS.filter(c => new RegExp(`\\b${c}\\b`, "i").test(text));
}

/**
 * The end rules read in a segment.
 * @returns {{resave: {on: string, tally?: object}|null, endsOnDamage: boolean, resaveOnDamage: boolean}}
 */
export function readEndings(text) {
  let resave = null;
  // First failure then second: "First Failure: … repeats the save at the end of its next turn … Second Failure: … has the Petrified
  // condition", or "… until the end of its next turn, at which point / when it repeats the save. Second Failure: …".
  const second = text.match(/\bSecond Failure\s*:\s*([^]*)$/i);
  if ( second && /\b(?:repeats? the save at the end of its next turn|end of its next turn,? (?:at which point|when) it repeats the save)\b/i.test(text.slice(0, second.index)) ) {
    const status = conditionsIn(second[1].split(/\binstead of\b/i)[0])[0] ?? null;
    resave = { on: "endOfTurn", tally: { successes: 1, failures: 1, ...(status ? { status } : {}) } };
  } else {
    // "repeats the save at the end of each of its turns", or "At the end of each of its turns, the target repeats the … save"
    // (Arcanaloth's Banishing Claw, Djinni's Whirlwind Creation, Quasit's Fright).
    const m = text.match(/\brepeats? the (?:[A-Za-z…]+ )?sav(?:e|ing throw) at the (end|start) of each of its turns\b/i)
      ?? text.match(/\bAt the (end|start) of each of its turns, the target repeats the (?:[A-Za-z…]+ )?sav(?:e|ing throw)\b/i);
    if ( m ) resave = { on: m[1].toLowerCase() === "end" ? "endOfTurn" : "startOfTurn" };
  }
  // "… for 1 minute or until it takes damage", "This effect ends for the target if it takes damage", "The condition ends if the
  // target takes damage", "succeeds automatically … if it takes damage" (Chasme's Drone). Not "whenever it takes damage"
  // (re-played save), nor "an X condition, which ends early if …" (Pseudodragon's Sting: only Unconscious ends, not the effect),
  // nor damage taken elsewhere ("takes damage while …").
  const endsOnDamage = /\b(?:until (?:it|the target) takes damage|(?:the (?:effect|condition) )?ends?(?: for the target)? if (?:it|the target) takes damage|(?:succeeds|ends) automatically[^.]*\bif it takes damage)\b/i.test(text)
    && !/\bwhich ends early if the target takes damage\b/i.test(text);
  const resaveOnDamage = /\brepeats? the (?:[A-Za-z]+ )?save (?:whenever|each time) it takes damage\b/i.test(text);
  return { resave, endsOnDamage, resaveOnDamage };
}

/** The activity of a numbered segment ("9: Disintegration Ray." → the activity named "9: …"), or null. */
function activityOfSegment(part, activities) {
  const n = part.match(/^\s*(\d{1,2})\s*:/)?.[1];
  if ( !n ) return null;
  return activities.find(a => new RegExp(`^\\s*${n}\\s*:`).test(a.name ?? ""))?.id ?? null;
}

const DEATH = /\b(?:dies|die|kills? (?:it|the target)|is killed|disintegrates?|turns? to dust|dissolves? into ash)\b/i;
// What, BEFORE the 0 HP, shows that the sentence is about something other than the killed target (the bearer, an object,
// a stabilization).
const NOT_THE_TARGET = /\b(?:only if|instead|becomes Stable|tome|gem|rope|bag|canister|limb|body|possession|curse)\b/i;

/**
 * K2 (SPEC §323): the death that the text promises, read in a monster ability.
 *  - "If this damage reduces the target to 0 Hit Points, it dies / the X kills it / it disintegrates into dust", "A Humanoid
 *    reduced to 0 Hit Points by this damage dies", "A creature dies and turns to dust if reduced to 0 Hit Points by this attack"
 *    → `killsAtZero` (with `types: ["humanoid"]`, `sizeAtMost` when the text states them, `activities` for a numbered segment);
 *  - "If the target has N Hit Points or fewer, it dies / it drops to 0 Hit Points. Otherwise … damage" → `hpTiers`: at N HP
 *    or fewer, no damage, death (`statuses: ["dead"]`) or HP at 0 (`zero: true` — the engine's 0 HP rule then decides); above
 *    that, the damage without the "Death" effect that the data applies automatically (Ankhtepot's Death Touch).
 * Not the sentences that speak of the bearer ("dies only if…", the tome, the gem), nor "becomes Stable", nor "rises as",
 * nor "instead".
 * @param {string} html
 * @param {{activities?: Array<{id: string, name: string}>, effects?: Array<{id: string, statuses: string[]}>}} [data]
 * @returns {{killsAtZero?: object|true, hpTiers?: object[]}}
 */
export function monsterDeaths(html, { activities=[], effects=[] }={}) {
  const text = plainText(html);
  const out = {};
  if ( !text ) return out;
  const parts = segments(text);
  const kills = [];
  for ( const part of parts ) {
    const activity = (parts.length > 1) ? activityOfSegment(part, activities) : null;
    if ( (parts.length > 1) && !activity ) continue;
    for ( const sentence of part.split(/(?<=\.)\s+/) ) {
      const zero = sentence.search(/\b0 Hit Points\b/i);
      if ( (zero < 0) || !DEATH.test(sentence) || /\bbecomes Stable\b/i.test(sentence) ) continue;
      const before = sentence.slice(0, zero);
      if ( NOT_THE_TARGET.test(before) || !/\b(?:target|creature|Humanoid)\b/i.test(before) ) continue;
      const rule = {};
      if ( /\bHumanoid\b/.test(sentence) ) rule.types = ["humanoid"];
      const size = sentence.match(/\b(Tiny|Small|Medium|Large|Huge) or smaller\b/i)?.[1];
      if ( size ) rule.sizeAtMost = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge" }[size.toLowerCase()];
      if ( activity ) rule.activities = [activity];
      kills.push(rule);
    }
    const tier = part.match(/\bIf the (?:target|creature|[a-z]+|…) has (\d+) Hit Points or fewer, it (dies|drops to 0 Hit Points)\b/i);
    if ( tier ) {
      const atMost = Number(tier[1]);
      const low = { atMost, damage: false, ...(/^dies$/i.test(tier[2]) ? { statuses: ["dead"] } : { zero: true }), ...(activity ? { activities: [activity] } : {}) };
      const deadEffects = effects.filter(e => (e.statuses ?? []).includes("dead")).map(e => e.id);
      const high = deadEffects.length ? { effects: effects.filter(e => !deadEffects.includes(e.id)).map(e => e.id) } : {};
      if ( activity ) high.activities = [activity];
      out.hpTiers = [...(out.hpTiers ?? []), low, high];
    }
  }
  if ( kills.length ) {
    const merged = {};
    if ( kills.every(k => k.types) ) merged.types = kills[0].types;
    if ( kills.every(k => k.sizeAtMost) ) merged.sizeAtMost = kills[0].sizeAtMost;
    if ( kills.every(k => k.activities) ) merged.activities = [...new Set(kills.flatMap(k => k.activities))];
    out.killsAtZero = Object.keys(merged).length ? merged : true;
  }
  return out;
}

/**
 * K3 (SPEC §324): only one of the ability's effects, when the text says so — otherwise dnd5e applies all those of the activity.
 *  - "a condition determined by rolling 1d4: on a 1, Charmed; on a 2, Frightened…" → `{ effects: "one", roll: true, order }` (the
 *    effects in the order in which the text names their conditions);
 *  - "the Charmed or Frightened condition (the X's choice)" → `{ effects: "one" }`;
 *  - "X chooses a damage type" (one effect per type in the data: Curse of the Beholder) → `{ effects: "one" }`.
 * Not an ability with several segments (Eye Rays: the die chooses the activity, not the effect).
 * @param {string} html
 * @param {Array<{id: string, statuses: string[]}>} effects
 * @returns {{effects: "one", roll?: true, order?: string[]}|null}
 */
export function monsterChoice(html, effects=[]) {
  const text = plainText(html);
  if ( !text || (effects.length < 2) || (segments(text).length > 1) ) return null;
  const rolled = text.match(/\b(?:determined by rolling|roll(?:ing)? (?:a )?)1?d(\d+)\b([^]*)$/i);
  if ( rolled ) {
    const rest = rolled[2].slice(0, 400);
    const order = [];
    for ( const m of rest.matchAll(/\bon an? \d+\s*,\s*(?:the target has the )?([A-Za-z]+)/gi) ) {
      const e = effects.find(x => (x.statuses ?? []).includes(m[1].toLowerCase()) && !order.includes(x.id));
      if ( e ) order.push(e.id);
    }
    if ( order.length >= 2 ) return { effects: "one", roll: true, order };
  }
  if ( /\bthe [A-Za-z]+ or [A-Za-z]+ condition \([^)]*\bchoice\)/i.test(text) ) return { effects: "one" };
  // "suffers one of the following effects of the X's choice" (Pirate Admiral's Scimitar), "shape-shifts to resemble a rat (…),
  // a raven (…), or a spider (…)" (Imp's, Quasit's Shape-Shift: one form at a time).
  if ( /\bone of the following effects(?: of the [^.:]*'s choice| \([^)]*\bchoice\))/i.test(text) ) return { effects: "one" };
  // "the target has the X's choice of (A) the Charmed condition … or (B) the Prone condition" (Githzerai's Psychic Warp,
  // Ez d'Avenir's Galvanize Allies).
  if ( /\bchoice of \(A\)[^]*\bor \(B\)/i.test(text) ) return { effects: "one" };
  if ( /\bshape-shifts? to resemble an? [A-Za-z -]+ \([^)]*\), an? [A-Za-z -]+ \([^)]*\),? or an? [A-Za-z -]+/i.test(text) ) return { effects: "one" };
  if ( /\bchooses a damage type\b/i.test(text) ) return { effects: "one" };
  return null;
}

/**
 * K6 (SPEC §327): what the text of a monster ability says about Reactions.
 *  - a parry: a Reaction activity whose response "adds N to its AC against that attack" (Commander's Counterattack,
 *    Pirate Captain's Riposte, Defensive Stance, Sand Whirlwind) → the MM's Parry declaration (`isHit`, `use`, `penalty`
 *    of N, or of the Proficiency Bonus when the text refers to a computed value); "melee attack" in the trigger: against melee
 *    only;
 *  - "can't take Reactions" → `noReactions` (the bearer of an effect of the item); "either an action or a Bonus Action",
 *    "an action or a Bonus Action, not both" → `actionOrBonus`.
 * @param {string} html
 * @param {{reaction?: boolean}} [data]  does the item have a Reaction activity
 * @returns {{triggers?: object[], noReactions?: true, actionOrBonus?: true}}
 */
export function monsterReactions(html, { reaction=false, acEffect=null }={}) {
  const text = plainText(html);
  const out = {};
  if ( !text ) return out;
  if ( reaction ) {
    // K12 (§333): also "against melee attack rolls (including the triggering attack) until the start of its next turn" (Defensive
    // Stance) — the item's "+N AC" effect then lasts until the start of its turn.
    const ac = text.match(/\badds? (\d+|…) to its AC against (?:that|the|the triggering) attack/i)
      ?? text.match(/\badds? (\d+|…) to its AC against (?:melee )?attack rolls \(including the triggering attack\)/i);
    if ( ac ) {
      const melee = /\bTrigger\s*:[^]*?\bmelee attack\b/i.test(text.split(/\bResponse\s*:/i)[0] ?? "");
      // The data carries the "+N AC" effect (Counterattack, Riposte, Sand Whirlwind): like Shield — offered if N can make
      // the blow miss, the effect applied, the blow re-judged. Without an effect (Parry): the bonus removed from the roll.
      if ( Number.isFinite(acEffect) ) out.triggers = [{ on: "isHit", if: { "hit.stoppableBy": acEffect, ...(melee ? { "activity.isMelee": true } : {}) }, do: [{ type: "use" }] }];
      else out.triggers = [{ on: "isHit", ...(melee ? { if: { "activity.isMelee": true } } : {}),
        do: [{ type: "use" }, { type: "penalty", formula: /^\d+$/.test(ac[1]) ? ac[1] : "@prof" }] }];
    }
  }
  // An ability with numbered rays: a ray's restriction would apply to all its effects — left alone.
  if ( segments(text).length > 1 ) return out;
  if ( /\bcan(?:'|no)t take (?:any )?Reactions\b/i.test(text) ) out.noReactions = true;
  if ( /\b(?:either )?an action or a Bonus Action(?:,? (?:but )?not both)?\b[^.]*\b(?:on|during) its turn\b|\bcan take (?:only )?(?:either )?an action or a Bonus Action\b/i.test(text) ) out.actionOrBonus = true;
  return out;
}

/**
 * K7 (SPEC §328): what the ability inflicts on its bearer turn after turn, and the healing it blocks.
 *  - "the target takes [[/damage … activity=<id>]] damage at the start (end) of each of its turns", "loses […] Hit Points at
 *    the start of each of its turns" →
 *    `{ on: startOfTurn|endOfTurn, via: "effect", do: [{ type: "damage", to: "bearer", activity }] }`, for
 *    the effects whose sentence names the condition ("While Poisoned", "Until the grapple ends" → Grappled), otherwise for
 *    all; not a creature swallowed or engulfed (the Swallow brick handles it, §18.17), nor damage that the bearer inflicts
 *    around it ("deals … to any creature");
 *  - "can't regain Hit Points" (the text speaks of the target) → `blocksHealing`.
 * Reads the raw HTML: the enricher `[[/damage … activity=…]]` names the ability's damage activity.
 * @param {string} html
 * @param {Array<{id: string, statuses: string[]}>} [effects]
 * @returns {{triggers?: object[], blocksHealing?: true}}
 */
export function monsterRecurring(html, effects=[], activities=[]) {
  const raw = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;/g, "'")
    .replace(/\s+/g, " ");
  const out = {};
  const triggers = [];
  // §334: an enricher without an activity ("[[/damage average]]", or "3 ([[/r 1d6]]) Piercing damage") — the sole damage activity.
  const damageActivities = activities.filter(a => a.type === "damage");
  for ( const sentence of raw.split(/(?<=\.)\s+(?=[A-Z])/) ) {
    // §334: "at the start of each of the water elemental's turns" — the turn of the creature that applied the effect
    // (`originTurnStart`).
    const turn = sentence.match(/\bat the (start|end) of each of (its|the [^.]*?['’]s|his|her) turns\b/i);
    const moment = turn?.[1];
    const ofOrigin = !!turn && /^the /i.test(turn[2]);
    if ( ofOrigin && (moment.toLowerCase() !== "start") ) continue;
    const activity = sentence.match(/\[\[\/damage[^\]]*\bactivity=([A-Za-z0-9]{16})/)?.[1]
      ?? (((/\[\[\/damage\b/.test(sentence) || /\bdamage\b/i.test(sentence)) && (damageActivities.length === 1)) ? damageActivities[0].id : null);
    if ( !moment || !activity ) continue;
    if ( /\b(?:swallowed|engulfed)\b/i.test(sentence) || /\bdeals?\b[^.]*\bto (?:any|each) creature\b/i.test(sentence) ) continue;
    if ( !/\b(?:takes|loses)\b/i.test(sentence) ) continue;
    const named = conditionsIn(plainText(sentence).replace(/\bgrapple\b/i, "grappled"));
    const ids = effects.filter(e => (e.statuses ?? []).some(s => named.includes(s))).map(e => e.id);
    const on = ofOrigin ? "originTurnStart" : (moment.toLowerCase() === "start" ? "startOfTurn" : "endOfTurn");
    const step = { type: "damage", to: "bearer", activity };
    if ( ids.length && (ids.length < effects.length) ) for ( const id of ids ) triggers.push({ on, via: "effect", fromEffect: id, do: [step] });
    else triggers.push({ on, via: "effect", do: [step] });
  }
  // Several recurring damages for all the effects at once (two serums of the Syringe): which goes with which effect is not stated.
  const ambiguous = triggers.filter(t => !t.fromEffect).length > 1;
  const text = plainText(html);
  // Numbered rays: a ray's rule would apply to all its effects — left alone.
  const several = segments(text).length > 1;
  if ( triggers.length && !ambiguous && !several ) out.triggers = triggers;
  if ( !several && /\bthe target can(?:'|’|no)t regain Hit Points\b|\bUntil (?:this poison|the curse) ends, the target can(?:'|’|no)t regain Hit Points\b/i.test(text) ) out.blocksHealing = true;
  // "Whenever the golem is subjected to Fire damage, it (takes no damage and instead) regains … Hit Points equal to the Fire
  // damage dealt".
  const absorbs = [...text.matchAll(/\bWhenever (?:the )?[^.]*? is subjected to ([A-Za-z]+) damage, (?:it takes no damage and instead )?(?:it )?regains a number of Hit Points equal to the \1 damage dealt/gi)]
    .map(m => m[1].toLowerCase());
  if ( absorbs.length ) out.absorbsDamage = [...new Set(absorbs)];
  return out;
}

/**
 * K8 (SPEC §329): pushes and pulls of a monster ability — "the target is pushed up to 10 feet straight away from the X",
 * "pulled up to 15 feet straight toward the X" →
 * `{ on: failedSave|hit, do: [{ type: "move", mode, distance, units: "ft" }] }`; "If the target is a Huge or smaller
 * creature" / "Large or smaller" → `if: { "target.sizeAtMost" }`. On a save: after "Failure";
 * otherwise on an attack: on a hit. Not a distance referring to a computed value ("pushed up to …"), nor "into the X's
 * space".
 * §466: also "the target is pushed 5 feet straight away" (without "up to"); after "Success:" → on a SUCCESSFUL save (`savedSave`:
 * Bulette's Deadly Leap); "the X can pull the target up to 10 feet" → the author chooses the distance (`upTo`: Giant Squid's
 * Tentacle); "pulled up to 20 feet straight toward the Sphere's center" on an area → toward the area's center (`toward: "area"`:
 * Implosion). Still not: "pushed or pulled" (at choice), "into the X's space".
 * @param {string} html
 * @param {{save?: boolean, attack?: boolean, area?: boolean}} [kinds]  the item's activities (`area`: one has a template)
 * @returns {object[]} `triggers` declarations
 */
export function monsterPushes(html, { save=false, attack=false, area=false }={}) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  const out = [];
  for ( const sentence of text.split(/(?<=\.)\s+/) ) {
    // §334: also "the hook horror pulls (pushes, moves) the target up to 15 feet straight toward (away from) itself".
    // §466: "the squid can pull the target up to 10 feet straight toward itself" — `can`, "up to": the author chooses.
    const active = sentence.match(/\b(can )?(pulls?|push(?:es)?|moves?) the target (up to )?(\d+) feet(?: straight)? (toward|away from) (?:itself|it|him|her)\b/i);
    const passive = sentence.match(/\b(pushed|pulled) (?:up to )?(\d+) feet(?: straight)? (?:away from|toward)\b/i);
    const m = passive ?? (active ? [active[0], (/^push/i.test(active[2]) || /^away/i.test(active[5])) ? "pushed" : "pulled", active[4]] : null);
    const upTo = !passive && !!active?.[1] && !!active?.[3];
    // Nor "pushed or pulled" / "toward or away" (at choice). §466: toward the center of an area (Implosion) — only a pull, on an
    // ability with a template.
    if ( !m || /\bor (?:pushed|pulled)\b|\btoward or away\b/i.test(sentence) ) continue;
    const toArea = /\bcenter\b/i.test(sentence);
    if ( toArea && !(area && /^pulled$/i.test(m[1]) && /\btoward the [^.]*?\bcenter\b/i.test(sentence)) ) continue;
    const before = text.slice(0, text.indexOf(sentence));
    const failure = /\bFailure\s*:/i.test(sentence) || (/\bFailure\s*:[^]*$/i.test(before) && !/\bSuccess\s*:[^]*$/i.test(before.split(/\bFailure\s*:/i).at(-1)));
    // §466: "Success: Half damage, and the target is pushed 5 feet" — the push of the success (not "Failure or Success").
    const success = /(?:^|[^r]\s)Success\s*:/i.test(sentence) && !/\bFailure or Success\s*:/i.test(sentence);
    const on = (save && success) ? "savedSave" : (save && failure) ? "failedSave" : (attack ? "hit" : null);
    if ( !on ) continue;
    const size = sentence.match(/\bIf the target is (?:an? )?(Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1]
      ?? before.split(/(?<=\.)\s+/).at(-1)?.match(/\bIf the target is (?:an? )?(Tiny|Small|Medium|Large|Huge) or smaller\b/i)?.[1];
    const sizeAtMost = size ? { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" }[size.toLowerCase()] : null;
    out.push({ on, ...(sizeAtMost ? { if: { "target.sizeAtMost": sizeAtMost } } : {}),
      do: [{ type: "move", mode: /^pushed$/i.test(m[1]) ? "push" : "pull", distance: Number(m[2]), units: "ft", ...(upTo ? { upTo: true } : {}),
        ...(toArea ? { toward: "area" } : {}) }] });
  }
  return out;
}

/**
 * K9 (SPEC §330): the type gate of a monster ability — "(Constructs and Undead succeed automatically)", "the target succeeds
 * automatically if it is a Construct or an Undead" → `targets.unaffectedIf` (one of the types). Not "a creature that isn't a
 * Construct", which often serves another clause (Temporary Hit Points of the Lizard King's Bite). Not an ability with
 * numbered rays.
 * @param {string} html
 * @returns {{unaffectedIf: object}|null}
 */
export function monsterTypeGate(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  // K9 (§334): also "Constructs and Undead automatically succeed on this save", "each creature … that isn't an Undead", "and
  // isn't a Construct or an Undead" (Death Cry, Life Disruption, Horrifying Visage, Blood Puppeteer).
  const m = text.match(/\(([A-Za-z ,]+?) succeed automatically\)/i) ?? text.match(/\bsucceeds automatically if it is an? ([A-Za-z ,]+?(?: or an? [A-Za-z]+)?)\)?(?:[.;,]|$)/i)
    ?? text.match(/\b((?:Constructs|Undead|Oozes|Plants|Elementals)(?:,? (?:and|or) (?:Constructs|Undead|Oozes|Plants|Elementals))*) automatically succeed on this save/i)
    ?? text.match(/\b(?:that|and) isn['’]t an? ((?:Construct|Undead|Ooze|Plant|Elemental)(?: or an? (?:Construct|Undead|Ooze|Plant|Elemental))*)\b/i);
  if ( !m ) return null;
  // A save gate is stated before the first outcome ("Failure:"): elsewhere, the clause applies to something else (Temporary
  // Hit Points of the Lizard King's Bite: "a creature that isn't a Construct or an Undead").
  const failure = text.search(/\bFailure\s*:/i);
  if ( !/\bSaving Throw\b/i.test(text) || ((failure >= 0) && (m.index > failure)) ) return null;
  const TYPES = ["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"];
  const types = TYPES.filter(t => new RegExp(`\\b${t}s?\\b`, "i").test(m[1]));
  if ( !types.length ) return null;
  return { unaffectedIf: (types.length === 1) ? { "target.creatureType": types[0] } : { any: types.map(t => ({ "target.creatureType": t })) } };
}

/**
 * K10 (SPEC §331): the conditional Advantage of a monster ability, declared like Pack Tactics (`preAttackRoll`, `advantage`):
 *  - "Advantage on attack rolls against any creature that doesn't have all its Hit Points" (Bloodthirsty Frenzy) →
 *    `target.wounded`;
 *  - "While Bloodied, the X has Advantage on attack rolls" (Fury of Peril) → `source.hasStatus: bloodied`;
 *  - "Advantage on … against a creature Grappled by it / it is grappling" → `target.grappledBySource`;
 *  - "Advantage on attack rolls against a creature that has the Frightened condition" → `target.hasStatus`.
 * "this attack" (the Ankheg's Bite against the one it grapples): only for the item's attacks (`activity.identifier`).
 * @param {string} html
 * @param {string|null} [identifier]  the item's identifier, for "this attack"
 * @returns {object[]} `triggers` declarations
 */
export function monsterAdvantage(html, identifier=null) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  const out = [];
  for ( const sentence of text.split(/(?<=\.)\s+/) ) {
    if ( !/\bhas Advantage on (?:attack rolls|this attack|the attack|its attack)/i.test(sentence) && !/\bAdvantage on attack rolls\b/i.test(sentence) ) continue;
    let condition = null;
    if ( /\bdoesn(?:'|’)t have all (?:its|of its) Hit Points\b/i.test(sentence) ) condition = { "target.wounded": true };
    else if ( /\bWhile (?:it is )?Bloodied\b/i.test(sentence) ) condition = { "source.hasStatus": "bloodied" };
    else if ( /\b(?:Grappled by it|it is grappling|it has Grappled)\b/i.test(sentence) ) condition = { "target.grappledBySource": true };
    else {
      const status = sentence.match(/\bagainst (?:(?:a|any) (?:creature|target)|targets|creatures) (?:that (?:has|have)|with) the ([A-Za-z]+) condition\b/i)?.[1];
      if ( status && conditionsIn(status).length ) condition = { "target.hasStatus": status.toLowerCase() };
    }
    if ( !condition ) continue;
    const own = /\b(?:this|the) attack\b/i.test(sentence) && identifier;
    out.push({ on: "preAttackRoll", if: own ? { all: [condition, { "activity.identifier": identifier }] } : condition, do: [{ type: "advantage" }] });
  }
  return out;
}

/**
 * K11 (SPEC §332): the data gives half damage on a success (`onSave: half`) where the text gives nothing — a clause
 * "Success:" without damage ("The target is immune…", "can't take this action again…"), or no "Success:" clause (Solar's
 * Slaying Bow) → `saveDamage: { <activité>: "none" }`; conversely "Success: Half damage" on `none` data → `"half"`.
 * "Success: [[/damage]] damage" (the half computed by the enricher) is not one.
 * @param {string} html
 * @param {Array<{id: string, type: string, onSave?: string}>} activities
 * @returns {object|null}  `saveDamage`
 */
export function monsterSaveDamage(html, activities=[]) {
  const saves = activities.filter(a => (a.type === "save") && ["half", "none", "full"].includes(a.onSave));
  if ( !saves.length ) return null;
  const raw = String(html ?? "").replace(/<[^>]+>/g, " ");
  if ( !/\bFailure\s*:/i.test(raw) || (segments(plainText(html)).length > 1) ) return null;
  const success = raw.match(/\bSuccess\s*:\s*([^]*?)(?=\b(?:Failure|First Failure|Second Failure|Failure or Success)\s*:|$)/i)?.[1] ?? null;
  // "Success: Half damage" when the data gives nothing (Gelatinous Cube's Engulf).
  if ( (success !== null) && /^\s*half (?:the |as much )?damage/i.test(success) ) {
    const nones = saves.filter(a => a.onSave === "none");
    return nones.length ? Object.fromEntries(nones.map(a => [a.id, "half"])) : null;
  }
  if ( (success !== null) && (/\bdamage\b|\bhalf\b/i.test(success)) ) return null;
  const halves = saves.filter(a => ["half", "full"].includes(a.onSave));
  return halves.length ? Object.fromEntries(halves.map(a => [a.id, "none"])) : null;
}

/**
 * The end declarations of a monster ability, from its English text.
 * @param {string} html                                         original English description
 * @param {Array<{id: string, statuses: string[]}>} effects     the item's effects (to attach a rule to its outcome)
 * @returns {object[]}  `triggers` declarations (content schema), empty if there is nothing to read
 */
export function monsterEndings(html, effects=[]) {
  const text = plainText(html);
  if ( !text ) return [];
  const parts = segments(text);
  const out = [];
  for ( const part of parts ) {
    const { resave, endsOnDamage, resaveOnDamage } = readEndings(part);
    if ( !resave && !endsOnDamage && !resaveOnDamage ) continue;
    // A single outcome (or effects without a condition): the rule applies to any effect of the item; otherwise to the effects
    // whose condition is named here.
    let from = [null];
    if ( parts.length > 1 ) {
      const named = conditionsIn(part);
      const ids = effects.filter(e => (e.statuses ?? []).some(s => named.includes(s))).map(e => e.id);
      if ( !ids.length ) continue;
      from = ids;
    }
    for ( const id of from ) {
      const at = id ? { fromEffect: id } : {};
      if ( resave ) out.push({ on: resave.on, via: "effect", ...at, do: [{ type: "resave", ...(resave.tally ? { tally: resave.tally } : {}) }] });
      if ( resaveOnDamage ) out.push({ on: "isDamaged", via: "effect", ...at, do: [{ type: "resave" }] });
      else if ( endsOnDamage ) out.push({ on: "isDamaged", via: "effect", ...at, do: [{ type: "remove" }] });
    }
  }
  return out;
}

/** Size written in English → dnd5e size key. */
const SIZE_KEYS = { tiny: "tiny", small: "sm", medium: "med", large: "lg", huge: "huge", gargantuan: "grg" };

/**
 * K12 (SPEC §333): the condition that the text applies and that the data forgets — "If the target is a Large or smaller
 * creature, it has the Prone condition" on an attack without an effect (Water Elemental's Torrent, Strike), "Failure: The
 * target has the Restrained condition" on a save whose activity does not cite the effect (Sticky Net). On a hit for an attack, on
 * the failed save for a save; size limit kept. Nothing when an activity of the same kind already applies that condition,
 * nor for a conditional sentence ("While", "If this damage reduces", "until it takes damage").
 * @param {string} html
 * @param {{activities?: Array<{type: string, effects?: string[]}>, effects?: Array<{id: string, statuses?: string[]}>}} [data]
 * @returns {object[]} `triggers` declarations
 */
export function monsterMissingStatus(html, { activities=[], effects=[] }={}) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) || /\bone of the following\b/i.test(text) ) return [];
  const statusesOf = kind => new Set(activities.filter(a => a.type === kind).flatMap(a => a.effects ?? [])
    .flatMap(id => effects.find(e => e.id === id)?.statuses ?? []));
  const save = activities.some(a => a.type === "save");
  const attack = activities.some(a => a.type === "attack");
  const out = [];
  const sentences = text.split(/(?<=\.)\s+/);
  for ( const [i, sentence] of sentences.entries() ) {
    // §334: also "it starts burning" (Magmin's Touch) — dnd5e's Burning condition.
    const m = sentence.match(/\b(?:it|the target) has the (Prone|Restrained|Blinded|Deafened|Frightened|Poisoned|Stunned|Incapacitated|Paralyzed) condition\b/i)
      ?? sentence.match(/\b(?:it|the target) starts (burning)\b/i);
    if ( !m || /\b(?:While|until it takes damage|If this damage|reduces the target to 0)\b/i.test(sentence) ) continue;
    // A condition applied by the engine has no duration: the only duration read is one turn (`effectEnds` "status:<état>", §334)
    // — "until the start of the wyvern's next turn" (the caster), "until the end of its next turn" (the target).
    const turn = sentence.match(/\buntil the (start|end) of (?:the \S+?['’]s|its) next turn\b/i);
    const ends = turn ? `${/\bof its next turn/i.test(turn[0]) ? "bearer" : "caster"}Turn${(turn[1].toLowerCase() === "start") ? "Start" : "End"}` : null;
    if ( !ends && /\buntil (?:the (?:start|end)|the grapple ends)\b|\bfor (?:\d+|one|an?|…) (?:round|minute|hour|…)|\bon an? \d/i.test(sentence) ) continue;
    const status = m[1].toLowerCase();
    const before = sentences.slice(0, i).join(" ");
    const failure = /\bFailure\s*:/i.test(sentence) || (/\bFailure\s*:/i.test(before) && !/\bSuccess\s*:[^]*$/i.test(before.split(/\bFailure\s*:/i).at(-1)));
    const on = (save && failure) ? "failedSave" : ((attack && !save) ? "hit" : null);
    if ( !on || statusesOf(on === "hit" ? "attack" : "save").has(status) ) continue;
    const size = sentence.match(/\bIf the target is an? (Tiny|Small|Medium|Large|Huge|Gargantuan) or smaller\b/i)?.[1];
    out.push({ on, ...(size ? { if: { "target.sizeAtMost": SIZE_KEYS[size.toLowerCase()] } } : {}), do: [{ type: "status", status }], ...(ends ? { ends } : {}) });
  }
  return out;
}

/**
 * K12 (SPEC §333): "the target can't make Opportunity Attacks until …" (Bone Whip, Frightful Blow) → `noOpportunityAttacks`,
 * carried by the item's effect; only if the item has an effect.
 */
export function monsterNoOpportunity(html, effects=[]) {
  if ( !effects.length ) return false;
  return /\bcan[’']t (?:make|take) Opportunity ?(?:Attacks?)?/i.test(plainText(html));
}

/**
 * K12 (SPEC §333): "takes the Dash, the Disengage, or Hide action" (Cunning), "takes the Dash and Disengage actions" (Clay
 * Golem's Haste) → `basicActions` of the utility activity: "or" at choice, "and" all.
 * @param {string} html
 * @param {Array<{id: string, type: string}>} activities
 */
export function monsterBasicActions(html, activities=[]) {
  const utility = activities.find(a => a.type === "utility");
  if ( !utility ) return null;
  const m = plainText(html).match(/\btakes the ((?:(?:the |, |,? (?:and|or) )*(?:Dash|Disengage|Hide|Dodge))+) actions?\b/i);
  if ( !m ) return null;
  const actions = [...m[1].matchAll(/\b(Dash|Disengage|Hide|Dodge)\b/gi)].map(x => x[1].toLowerCase());
  if ( !actions.length ) return null;
  const rule = (actions.length === 1) ? actions[0] : (/\bor\b/i.test(m[1]) ? { choose: actions } : actions);
  return { [utility.id]: rule };
}

/**
 * K12 (SPEC §333): "each creature in a 30-foot Emanation … that can see the doppelganger" (Unsettling Visage, Horrifying Visage,
 * Flesh Unraveling) → `targets.unaffectedIf: { "target.seesSource": false }`: a creature that does not see the source is not
 * affected. Only for an ability with a save.
 */
export function monsterSightGate(html, activities=[]) {
  if ( !activities.some(a => a.type === "save") ) return null;
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  return /\b(?:each|any)\b[^.:]{0,120}\bthat can see (?:the \S|it\b|him\b|her\b)/i.test(text) ? { "target.seesSource": false } : null;
}

/**
 * K1 (SPEC §334): "Success: The target is immune to this cloaker's Moan for the next 24 hours" (Moan, Sleep Gaze,
 * Horrifying Visage, Chilling Gaze…) → on a successful save, a mark `immune:<identifiant>` of that duration; the gate
 * `target.hasMark` then rules out the marked creature (neither save nor effect). Not for an attack (Lycanthropes' Bite: the
 * gate would also rule out the blow's damage; Immunity to the curse is left to the GM there).
 * @param {string} html
 * @param {string} identifier
 * @param {Array<{type: string}>} [activities]
 * @returns {{trigger: object, gate: object}|null}
 */
export function monsterImmunity(html, identifier, activities=[]) {
  if ( !identifier || activities.some(a => a.type === "attack") ) return null;
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  const m = text.match(/\bSuccess\s*:\s*The target is immune to [^.]*? for (?:the next )?(\d+|an?|one) (minute|hour)s?\b/i);
  if ( !m ) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const seconds = n * ((m[2].toLowerCase() === "hour") ? 3600 : 60);
  const mark = `immune:${identifier}`;
  return { trigger: { on: "savedSave", do: [{ type: "mark", mark, label: "Marque.Immunite", seconds }] }, gate: { "target.hasMark": mark } };
}

/**
 * §334: the duration that the text gives to an ability's effect, when it is counted in turns (the data often says "1 turn",
 * which falls at the start of the next combatant's turn):
 *  - "the target has the Restrained condition until the end of its next turn" → `effectEnds` of the effect that carries it:
 *    `bearerTurnEnd` ("its") or `casterTurnEnd` ("the spy master's"); likewise "start";
 *  - "the target can't take Reactions until …" on an effect without a condition → `noReactions` of that effect, and its duration;
 *  - a duration in turns stated of the target without naming a condition ("the target's Speed is halved until the end of its
 *    next turn", "This effect lasts until the end of its next turn") → `effectEnds` of the single effect without a condition that
 *    the activity cites. The sentence that speaks of the creature itself ("The dragon can't take this action again until the
 *    start of its next turn") says nothing about it; nor do two sentences that give two different durations;
 *  - "the creature can't regain Hit Points" on an effect without a condition → `blocksHealing` of that effect.
 * A text with several segments (numbered rays) is left alone.
 * @param {string} html
 * @param {{activities?: Array<{type: string, effects?: string[]}>, effects?: Array<{id: string, statuses?: string[]}>}} [data]
 * @returns {{effectEnds?: object, noReactions?: string[], blocksHealing?: string[]}}
 */
export function monsterEffectDurations(html, { activities=[], effects=[] }={}) {
  const text = plainText(html);
  const out = {};
  if ( !text || (segments(text).length > 1) ) return out;
  const cited = new Set(activities.flatMap(a => a.effects ?? []));
  const own = effects.filter(e => cited.has(e.id));
  const bare = own.filter(e => !(e.statuses ?? []).length);
  // "its next turn" and "the target's next turn": the bearer's turn; "the kuo-toa's next turn": that of the creature.
  const whose = m => (/^(?:its|the target['’]s)$/i.test(m[2]) ? "bearer" : "caster");
  const endOf = m => `${whose(m)}Turn${(m[1].toLowerCase() === "start") ? "Start" : "End"}`;
  const loose = new Set();
  for ( const sentence of text.split(/(?<=\.)\s+/) ) {
    const turn = sentence.match(/\buntil the (start|end) of (its|the [^.]*?['’]s|his|her) next turn\b/i);
    if ( !turn || /^(?:his|her)$/i.test(turn[2]) ) continue;
    const status = sentence.match(/\bhas the (Prone|Restrained|Blinded|Deafened|Frightened|Poisoned|Stunned|Incapacitated|Paralyzed|Charmed|Grappled) condition\b/i)?.[1]?.toLowerCase();
    if ( status ) {
      for ( const e of own.filter(e => (e.statuses ?? []).includes(status)) ) (out.effectEnds ??= {})[e.id] = endOf(turn);
      continue;
    }
    if ( /\bcan[’']t take (?:a Bonus Action or )?Reactions?\b|\bcan[’']t take a Bonus or Reaction\b/i.test(sentence) && (bare.length === 1) ) {
      out.noReactions = [bare[0].id];
      (out.effectEnds ??= {})[bare[0].id] = endOf(turn);
      continue;
    }
    // A duration stated of the target, with no condition named: that of the single effect without a condition (judged below, once
    // all sentences are read).
    const aboutTarget = /\bthe target\b|\bThis effect lasts\b/i.test(sentence)
      && !/\bcan[’']t take this action again\b/i.test(sentence);
    if ( aboutTarget ) loose.add(endOf(turn));
  }
  // Two sentences that give two different durations (two effects, only one without a condition): we do not guess which is
  // its own.
  const [only] = bare;
  if ( (bare.length === 1) && (loose.size === 1) && !out.effectEnds?.[only.id] ) (out.effectEnds ??= {})[only.id] = [...loose][0];
  if ( (bare.length === 1) && /\b(?:the creature|the target) can[’']t regain Hit Points\b/i.test(text) ) out.blocksHealing = [bare[0].id];
  return out;
}

const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];

/**
 * §334: the window of a monster Reaction, from its trigger ("Trigger: …", or the activation condition of the Reaction
 * activity) — the Reaction is offered (`use`) at the corresponding engine moment:
 *  - "misses the kuo-toa with a melee attack roll" → `isMissed` (melee);
 *  - "hits it with an attack roll", "An attack roll hits the …", "is hit by an attack roll" → `isHit`;
 *  - "makes an attack roll against it" → `isAttacked`;
 *  - "takes Piercing or Slashing damage", "is subjected to Cold damage", "deals damage to it" → `isDamaged` (types kept);
 *    "is hit by a ranged attack roll and takes … damage from it": only for a ranged attack;
 *  - "within 30 feet … casts a spell" → `castsSpell`.
 * The subject must be the creature itself (not "A Bloodied creature … takes damage"). Nothing for the other triggers.
 * @param {string} html
 * @param {string[]} [conditions]  activation conditions of the Reaction activities
 * @param {boolean} [outward]      the Reaction activity targets another creature (`use` on the trigger's source)
 * @param {string|null} [activity] the id of the Reaction activity
 * @returns {object[]} `triggers` declarations
 */
export function monsterReactionWindow(html, conditions=[], outward=false, activity=null) {
  // A Reaction that targets another creature (save, attack, damage: Sticky Shield) goes to the one that triggered it; the Reaction
  // activity is named (the item sometimes has others: the checks to break free of the Sticky Shield).
  const use = [{ type: "use", ...(activity ? { activity } : {}), ...(outward ? { target: "source" } : {}) }];
  const text = plainText(html);
  const declared = text.match(/\bTrigger\s*:\s*([^]*?)(?=\bResponse\b|$)/i)?.[1] ?? "";
  const sources = [declared, ...conditions.map(c => plainText(c))].map(s => s.trim()).filter(s => s && !/^[….\s]*$/.test(s));
  for ( const t of sources ) {
    if ( /\bmiss(?:es|ed)\b[^.]*\bmelee attack roll\b/i.test(t) ) return [{ on: "isMissed", if: { "activity.isMelee": true }, do: use }];
    if ( /\ban attack roll hits (?:it|him|her|the \S+|[A-Z]\w+)\b|\bhits (?:it|him|her|the \S+) with an attack roll\b|\bis hit by an? (?:melee )?attack roll\b/i.test(t) ) {
      return [{ on: "isHit", ...(/\bmelee attack roll\b/i.test(t) ? { if: { "activity.isMelee": true } } : {}), do: use }];
    }
    if ( /\bmakes an attack roll against (?:it|him|her|them)\b/i.test(t) ) return [{ on: "isAttacked", do: use }];
    // The subject is the creature ("The shoggoth … ", "Laurie … "), or implied in the condition ("takes Acid … damage").
    if ( /^(?:the|it|takes|is|[A-Z][a-z]+)\b/i.test(t) && !/^(?:A|An|Another|Each)\b/.test(t) ) {
      const dmg = t.match(/\b(?:takes|is subjected to) ((?:[A-Za-z]+, )*[A-Za-z]+(?:,? or [A-Za-z]+)?) damage\b/i);
      if ( dmg ) {
        const types = DAMAGE_TYPES.filter(k => new RegExp(`\\b${k}\\b`, "i").test(dmg[1]));
        // "hit by a ranged attack roll" (Stone Giant's Deflect Missile): a melee hit opens nothing.
        const ranged = /\bhit by a ranged attack roll\b/i.test(t) ? { "activity.isAttack": true, "activity.isMelee": false } : {};
        const when = { ...(types.length ? { "damage.hasType": types } : {}), ...ranged };
        return [{ on: "isDamaged", ...(Object.keys(when).length ? { if: when } : {}), do: use }];
      }
      if ( /\btakes damage\b/i.test(t) ) return [{ on: "isDamaged", do: use }];
    }
    if ( /\bdeals damage to (?:it|him|her)\b/i.test(t) ) return [{ on: "isDamaged", do: use }];
    if ( /\bcasts a spell\b/i.test(t) ) return [{ on: "castsSpell", do: use }];
  }
  return [];
}

/**
 * §334: the Advantage an attack's activation condition gives ("with Advantage if the target doesn't have all its Hit Points",
 * "… if the target is Grappled by the bugbear", "with Advantage during the first round of each combat") — the stat block's
 * text only says it through `[[lookup @activation.condition]]`. For the item's own attacks only.
 * @param {string[]} conditions   activation conditions of the attack activities
 * @param {string|null} identifier
 * @returns {object[]} `triggers` declarations
 */
export function monsterActivationAdvantage(conditions=[], identifier=null) {
  if ( !identifier ) return [];
  for ( const raw of conditions ) {
    const c = plainText(raw ?? "");
    if ( !/\bwith Advantage (?:if|during)\b/i.test(c) ) continue;
    let condition = null;
    if ( /\bduring the first round of (?:each|the|a) combat\b/i.test(c) ) condition = { "combat.firstRound": true };
    else if ( /\bdoesn['’]t have all (?:of )?its Hit Points?\b/i.test(c) ) condition = { "target.wounded": true };
    else if ( /\bis Grappled by (?:the \S+|it|him|her)\b/i.test(c) ) condition = { "target.grappledBySource": true };
    if ( condition ) return [{ on: "preAttackRoll", if: { all: [condition, { "activity.identifier": identifier }] }, do: [{ type: "advantage" }] }];
  }
  return [];
}

/**
 * §334: "Attack rolls against the displacer beast have Disadvantage" (Displacement, "Blurred Form", "Incomprehensible Form") —
 * a `preAttackRoll` declaration carried by the TARGET's item (`defends: true`): Disadvantage, unless it is Incapacitated when the
 * text says so ("suppressed while … Incapacitated", "unless … has the Incapacitated condition").
 * @param {string} html
 * @returns {object[]} `triggers` declarations
 */
export function monsterDefense(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  if ( !/\bAttack rolls against (?:the \S+|it|him|her) (?:have|are made with) Disadvantage\b/i.test(text) ) return [];
  const incapacitated = /\bIncapacitated\b/i.test(text);
  return [{ on: "preAttackRoll", defends: true, ...(incapacitated ? { if: { not: { "target.hasStatus": "incapacitated" } } } : {}), do: [{ type: "disadvantage" }] }];
}

/**
 * §334: "If the target is a Huge or smaller creature and the elephant moved 20+ feet straight toward it immediately before the
 * hit, the target has the Prone condition" on an attack with ONE activity (no charge variant, M5) → `effectsIf`: the attack's
 * effects apply only after a charge of that length (fact `source.chargedFeet`).
 * @param {string} html
 * @param {Array<{type: string}>} [activities]
 * @returns {object|null}  `effectsIf` condition
 */
export function monsterChargeGate(html, activities=[]) {
  if ( activities.filter(a => a.type === "attack").length !== 1 ) return null;
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  const m = text.match(/\bmoved (\d+)\+? feet (?:straight )?toward (?:it|the target|them) immediately before the hit\b/i);
  return m ? { "source.chargedFeet": Number(m[1]) } : null;
}

/**
 * §334: "While in sunlight, the drider has Disadvantage on ability checks and attack rolls", "While in Bright Light, the
 * cloaker has Disadvantage on attack rolls" → Disadvantage on the creature's attack rolls in sunlight (`source.inSunlight`: the
 * scene's global light, not a torch) or in Bright Light (`source.inBrightLight`). Ability checks: `monsterLightChecks`.
 * @param {string} html
 * @returns {object[]} `triggers` declarations
 */
export function monsterLightSensitivity(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return [];
  const m = text.match(/\bWhile (?:it is )?in (sunlight|Bright Light)\b[^.]*\bDisadvantage on (?:[^.]*\b)?attack rolls\b/i);
  if ( !m ) return [];
  const fact = /^sunlight$/i.test(m[1]) ? "source.inSunlight" : "source.inBrightLight";
  return [{ on: "preAttackRoll", if: { [fact]: true }, do: [{ type: "disadvantage" }] }];
}

/**
 * §334, §484: the other half of the same sentence — "Disadvantage on ability checks and attack rolls" → Disadvantage on the
 * creature's ability checks (`rollDisadvantage`, "check": checks, skills and Initiative) while it is in sunlight
 * (`self.inSunlight`) or in Bright Light (`self.inBrightLight`). A sentence that names only attack rolls says nothing about this.
 * @param {string} html
 * @returns {{on: string[], if: object}|null}
 */
export function monsterLightChecks(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  const m = text.match(/\bWhile (?:it is )?in (sunlight|Bright Light)\b[^.]*\bDisadvantage on (?:[^.]*\b)?ability checks\b/i);
  if ( !m ) return null;
  return { on: ["check"], if: { [/^sunlight$/i.test(m[1]) ? "self.inSunlight" : "self.inBrightLight"]: true } };
}

/**
 * The other half of "While Bloodied, the X has Advantage on attack rolls and saving throws" (the Berserker's Bloodied Frenzy,
 * SRD 5.2): Advantage on the creature's saving throws while it is Bloodied (`rollAdvantage`, "save"). The attack rolls:
 * `monsterAdvantage`.
 * @param {string} html
 * @returns {{on: string[], if: object}|null}
 */
export function monsterBloodiedSaves(html) {
  const text = plainText(html);
  if ( !text || (segments(text).length > 1) ) return null;
  if ( !/\bWhile (?:it is )?Bloodied\b[^.]*\bAdvantage on (?:[^.]*\b)?saving throws\b/i.test(text) ) return null;
  return { on: ["save"], if: { "self.hasStatus": "bloodied" } };
}

/**
 * The effects that an ability places on its bearer and that end as soon as it attacks: "ends early immediately after the X makes
 * an attack roll" (Will-o'-Wisp's "Disappearance", SRD 5.2) → `breaksOn: ["attack"]`. Read from the text, not declared by
 * identifier: another monster carries the same item — same identifier, same activity and effect ids — without this ending in its
 * text. The other ending that the Will-o'-Wisp's text names (the use of another ability) is left to the GM.
 * @param {string} html
 * @returns {string[]|null}
 */
export function monsterBreaksOn(html) {
  const text = plainText(html);
  if ( !text ) return null;
  return /\bends? early immediately after\b[^.]*\bmakes an attack roll\b/i.test(text) ? ["attack"] : null;
}

/** The length units of an activity range (dnd5e `CONFIG.DND5E.movementUnits`): a range readable as a distance. */
const LENGTH_UNITS = new Set(["ft", "m", "mi", "km"]);

/** The `[[lookup @range.…]]`, `@target.affects.special|type` and `@target.template.size|units` of a text, replaced by the activity's value (as dnd5e displays them). */
function resolveLookups(html, activity) {
  const template = (typeof activity.template === "object") ? activity.template : {};
  const read = { "range.value": activity.range?.value, "range.units": activity.range?.units, "range.special": activity.range?.special,
    "target.affects.special": activity.target?.special, "target.affects.type": activity.target?.type,
    "target.template.size": template?.size, "target.template.units": template?.units };
  return String(html ?? "").replace(/\[\[lookup @(range\.(?:value|units|special)|target\.affects\.(?:special|type)|target\.template\.(?:size|units))\b[^\]]*\]\]/g,
    (whole, path) => ((read[path] ?? "") !== "" ? String(read[path]) : whole));
}

/**
 * §461: the self-teleportation that a monster ability describes — "the X (magically) teleports (up to 30 feet) to an unoccupied
 * space it can see (within 60 feet)", "can teleport…", the distance given in plain text or deferred to the activity's range
 * (`[[lookup @range.value]]`: "Teleport" of demons and yugoloths, sphinxes' "Arcane Prowl") → content `teleport`: `{ activity }`
 * when the activity's range is a length (it sets the distance, runtime/teleport.mjs), otherwise `{ activity, distance, units }`
 * from the text ("self" range). "Along with one willing creature of its choice within 5 feet of it" → `passengers`, from the
 * activity's target.
 *
 * Only what is certain: the ability has a single activity, "utility", with no template — the teleportation is all it does (a cited
 * attack is another item) —, and its destination is free. §462: or an activity (utility, damage, save) whose template
 * hits the space LEFT — "each creature within 10 feet of the space it left" (the Lich's "Deadly Teleportation", "Icy Step"), the
 * template size equal to the text's → `area: "left"` (runtime: area placed automatically around the caster before the jump,
 * excluding them); §463: or the ARRIVAL space ("in a 10-foot Emanation originating from it at its destination space", "within 5
 * feet of its destination space") → `area: "arrival"` (area placed after the jump). NOT read: an attack (the order is not that of
 * the use), "taking
 * creatures it is grappling with it" (who takes the area, are grappled creatures carried along?), a constrained destination
 * ("within 5 feet of a creature", "of a second tree"), "of your choice" (mount and rider), "itself or a willing demon" (another
 * creature), the Teleport spell.
 * @param {string} html
 * @param {Array<{id: string, type?: string, range?: {value?: *, units?: string, special?: string},
 *   template?: boolean|{type?: string, size?: *, units?: string, count?: *},
 *   target?: {type?: string, count?: *, special?: string}}>} [activities]
 * @returns {{activity: string, distance?: number, units?: string, passengers?: object,
 *   area?: "left"|"arrival", after?: "attack"}|null}
 */
export function monsterSelfTeleport(html, activities=[]) {
  // §464: "Immediately after the attack hits or misses, the spirit can teleport up to 30 feet…", "Hit or Miss: The X can
  // teleport up to 60 feet…" — a single attack activity (others, damage-only, may accompany it: an extra on a Critical Hit); the
  // distance is the text's (the attack's range is its reach).
  const attacks = activities.filter(a => a.type === "attack");
  if ( (attacks.length === 1) && activities.every(a => ["attack", "damage"].includes(a.type)) ) {
    const after = monsterTeleportAfterAttack(html);
    return after ? { activity: attacks[0].id, distance: after, units: "ft", after: "attack" } : null;
  }
  if ( activities.length !== 1 ) return null;
  const [activity] = activities;
  const text = plainText(resolveLookups(html, activity));
  if ( !text || (segments(text).length > 1) ) return null;
  // §465: a constrained destination — a single utility activity with no template.
  if ( (activity.type === "utility") && !activity.template ) {
    const constrained = constrainedTeleport(text, activity);
    if ( constrained ) return constrained;
  }
  let area = null;
  if ( activity.template ) {
    // §462: the area hits the space left; §463: or the arrival space — only one of the two, of the template's size, without
    // carried grappled creatures.
    const size = Number(activity.template?.size);
    const left = text.match(/\beach (?:creature|…)\s+within (\d+) (?:feet|ft)\.? of the space (?:it|he|she|they) (?:left|leaves)\b/i);
    const arrival = text.match(/\beach (?:creature|…) in an? (\d+)-foot Emanation originating from [^.]*? at (?:its|his|her|their) destination space\b/i)
      ?? text.match(/\beach (?:creature|…)(?: of its choice)?(?: that it can see)?\s+within (\d+) (?:feet|ft)\.? of (?:its|his|her|their|the [^.]*?['’]s) destination space\b/i);
    const said = (left && !arrival) ? left : (arrival && !left) ? arrival : null;
    if ( !said || !(size > 0) || (Number(said[1]) !== size) ) return null;
    if ( !["utility", "damage", "save"].includes(activity.type) || /\btaking (?:the )?creatures? (?:it|he|she) is grappling\b/i.test(text) ) return null;
    area = left ? "left" : "arrival";
  } else if ( activity.type !== "utility" ) return null;
  const m = text.match(/\b(?:magically )?teleports?(, along with [^,.]*? of its choice within [^,.]*? of it,)? (?:up to (\d+) (?:feet|ft)\.? )?to an unoccupied space (?:it|he|she|they) can see(?: within (\d+) (?:feet|ft))?(?: of (?:itself|himself|herself))?(?=[ ,.]|$)/i);
  if ( !m ) return null;
  const range = activity.range ?? {};
  const value = Number(range.value);
  const said = m[2] ?? m[3] ?? null;
  const rule = { activity: activity.id };
  if ( !(LENGTH_UNITS.has(range.units) && Number.isFinite(value) && (value > 0)) ) {
    if ( !said ) return null;
    Object.assign(rule, { distance: Number(said), units: "ft" });
  }
  if ( m[1] ) {
    const within = Number(String(activity.target?.special ?? "").match(/\bwithin (\d+) (?:feet|ft)\b/i)?.[1]
      ?? m[1].match(/\bwithin (\d+) (?:feet|ft)\b/i)?.[1]);
    if ( !(within > 0) ) return null;
    rule.passengers = { count: Math.max(1, Number(activity.target?.count) || 1), within, units: "ft" };
  }
  if ( area ) rule.area = area;
  return rule;
}

/**
 * §465: a self-teleportation whose destination is constrained —
 *  - "teleports to an unoccupied space within 5 feet of a creature it can see" ("Waking Dream"): near a creature, no other limit;
 *  - "uses Teleport, but its destination space must be within 10 feet of the triggering creature" ("Pursuit"): near the
 *    creature that triggered it (the designated target, otherwise any creature seen), within the activity's range;
 *  - "teleports to an unoccupied space within 5 feet of a second tree that is within 60 feet of the previous tree" (Tree Stride):
 *    at most 60 + 2 × 5 ft; plants are not scene objects — the GM judges it (`near: "plant"`, reminded when aiming).
 * @returns {object|null}  The `teleport` rule, or null.
 */
function constrainedTeleport(text, activity) {
  const range = activity.range ?? {};
  const value = Number(range.value);
  const fromActivity = ["ft", "m", "mi", "km"].includes(range.units) && Number.isFinite(value) && (value > 0);
  const tree = text.match(/\bteleports to an unoccupied space within (\d+) (?:feet|ft)\.? of a second [^.]*? that is within (\d+) (?:feet|ft)\.? of the (?:previous|first) (?:tree|plant)\b/i);
  if ( tree ) {
    const within = Number(tree[1]);
    return { activity: activity.id, distance: Number(tree[2]) + (2 * within), units: "ft", destination: { near: "plant", within, units: "ft" } };
  }
  const pursuit = text.match(/\buses Teleport, but its destination space must be within (\d+) (?:feet|ft)\.? of the triggering creature\b/i);
  if ( pursuit && fromActivity ) return { activity: activity.id, destination: { near: "creature", within: Number(pursuit[1]), units: "ft", trigger: true } };
  const near = text.match(/\bteleports to an unoccupied space within (\d+) (?:feet|ft)\.? of a creature (?:it|he|she|they) can see\b/i);
  if ( near ) return { activity: activity.id, destination: { near: "creature", within: Number(near[1]), units: "ft" } };
  return null;
}

/**
 * §464: the distance (feet) of a teleportation that the text offers once the attack is judged, hit or miss, or null.
 * @param {string} html
 * @returns {number|null}
 */
function monsterTeleportAfterAttack(html) {
  const text = plainText(html);
  const m = text.match(/\b(?:Immediately after the attack hits or misses,|Hit or Miss\s*:)\s*(?:the [^.]*?|…) can teleport up to (\d+) (?:feet|ft)\.? to an unoccupied space (?:it|he|she|they) can see\b/i);
  return m ? Number(m[1]) : null;
}

/**
 * §463: "each creature OF ITS CHOICE … within 5 feet of its destination space" (the Mummy Lord's Whirlwind of Sand) — the area of a
 * teleportation that the creature distributes: `zoneAffects: "enemy"` (the choice is offered, enemies ticked in advance, §401).
 * @param {string} html
 * @returns {boolean}
 */
export function monsterTeleportChoice(html) {
  return /\beach creature of its choice\b[^.]*\bdestination space\b/i.test(plainText(html).replace(/\bft\./g, "ft"));
}
