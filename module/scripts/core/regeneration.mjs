/**
 * M8 (SPEC §18.13): monster Regeneration (Trolls, Slaads, Oni, Shield Guardian, Revenant); §482 (B04): declared form.
 * What the original English text specifies, and what happens at the start of the creature's turn. Pure functions, no Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…").replace(/&Reference\[([^\]]+)\]/g, "$1")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/\s+/g, " ");

const WHO = "(?:it|she|he|they)";
const types = s => s.split(/,|\bor\b|\band\b/).map(x => x.trim().toLowerCase()).filter(Boolean);

/**
 * B04: a list "necrotic damage or bludgeoning, piercing, or slashing damage from a silvered weapon or damage from holy water or
 * damage from a Critical Hit" — one group per "… damage", each possibly coming from a silvered weapon, plus holy water and the
 * Critical Hit.
 */
function readDamageClause(clause, out) {
  if ( /\bdamage from (?:a )?critical hits?\b/i.test(clause) ) out.critical = true;
  if ( /\bdamage from (?:a (?:vial|flask) of )?holy water\b/i.test(clause) && !out.stoppedByItems.includes("holy-water") ) out.stoppedByItems.push("holy-water");
  for ( const m of clause.matchAll(/(?:^|\bor\s+)((?:[a-z]+,?\s+(?:or\s+)?)*?[a-z]+) damage( from (?:a )?silvered weapons?)?/gi) ) {
    (m[2] ? out.silveredBy : out.stoppedBy).push(...types(m[1]));
  }
}

/**
 * - `needsHp`: "if it has at least 1 Hit Point" (Slaads, Oni) — B04: "she", "he", "they" too;
 * - `stoppedBy`: "If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn" — B04: the same
 *   phrasing also reads the silvered weapon ("… or bludgeoning, piercing, or slashing damage from a silvered weapon, this
 *   trait doesn't function at the start of the werewolf's next turn");
 * - `stoppedByItems` (B04): "or damage from holy water" → `["holy-water"]` (identifier of the item that deals the damage);
 * - `stoppedWhile` (B04): "and isn't in sunlight or running water" → `["sunlight", "runningWater"]`;
 * - `survivesZero`: "The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate".
 * - §78, lycanthropes (MM 2014): "regains 10 hit points at the start of her turn if she hasn't taken necrotic damage or
 *   bludgeoning, piercing, or slashing damage from a silvered weapon since her last turn" — `stoppedBy` (necrotic) and
 *   `silveredBy` (bludgeoning, piercing, slashing: only from a silvered weapon).
 * - K2 (§323): `critical` — "or damage from a Critical Hit": a Critical Hit stops it too.
 * @param {string} html
 * @returns {{needsHp: boolean, stoppedBy: string[], silveredBy: string[], stoppedByItems: string[], stoppedWhile: string[],
 *   survivesZero: boolean, critical: boolean}}
 */
export function readRegeneration(html) {
  const text = plain(html);
  const needsHp = new RegExp(`\\bif ${WHO} (?:has|have) at least 1 Hit Points?\\b`, "i").test(text);
  const out = { stoppedBy: [], silveredBy: [], stoppedByItems: [], critical: false };
  const stopped = text.match(/\btakes ([^.]+?), this trait doesn[’']t function/i);
  if ( stopped ) readDamageClause(stopped[1], out);
  const since = text.match(new RegExp(`\\bif ${WHO} (?:hasn[’']t|has not|haven[’']t|have not) taken (.+?) since (?:its|her|his|their) last turn`, "i"));
  if ( since ) readDamageClause(since[1], out);
  const stoppedWhile = [];
  const where = text.match(new RegExp(`\\b(?:if|and) (?:${WHO} )?(?:isn[’']t|is not|aren[’']t|are not) in ([a-z ,]+)`, "i"));
  if ( where ) {
    if ( /\bsunlight\b/i.test(where[1]) ) stoppedWhile.push("sunlight");
    if ( /\brunning water\b/i.test(where[1]) ) stoppedWhile.push("runningWater");
  }
  const survivesZero = new RegExp(`\\b(?:dies|destroyed) only if ${WHO} starts? (?:its|her|his|their) turn with 0 Hit Points\\b`, "i").test(text);
  return { needsHp, stoppedBy: [...new Set(out.stoppedBy)], silveredBy: [...new Set(out.silveredBy)], stoppedByItems: out.stoppedByItems,
    stoppedWhile, survivesZero, critical: out.critical };
}

/** B04: the keys of the declared form `regeneration: { … }`, and the places where the trait does not function. */
export const REGENERATION_KEYS = Object.freeze(["amount", "needsHp", "stoppedBy", "silveredBy", "stoppedByItems", "stoppedWhile", "survivesZero", "critical"]);
export const REGENERATION_STOPS = Object.freeze(["sunlight", "runningWater"]);

/**
 * B04: the regeneration retained — the reading of the text, then the declared keys on top (a declared key replaces the reading;
 * a missing key stays that of the text). `amount`: formula (or number) of the healing in place of the activity's; `null` otherwise.
 * @param {true|object} declared
 * @param {ReturnType<typeof readRegeneration>} read
 */
export function resolveRegeneration(declared, read) {
  const base = { amount: null, ...read };
  if ( !declared || (typeof declared !== "object") ) return base;
  for ( const key of REGENERATION_KEYS ) {
    if ( declared[key] !== undefined ) base[key] = Array.isArray(declared[key]) ? [...declared[key]] : declared[key];
  }
  if ( typeof base.amount === "number" ) base.amount = String(base.amount);
  return base;
}

/** B04: validation of the `regeneration` entry — `true`, or an object with known keys. */
export function validateRegeneration(value, damageTypes) {
  if ( value === true ) return [];
  if ( !value || (typeof value !== "object") || Array.isArray(value) ) {
    return ["regeneration: true or { amount?, needsHp?, stoppedBy?, silveredBy?, stoppedByItems?, stoppedWhile?, survivesZero?, critical? }"];
  }
  const errors = [];
  for ( const key of Object.keys(value) ) if ( !REGENERATION_KEYS.includes(key) ) errors.push(`regeneration.${key}: unknown key`);
  const amount = value.amount;
  if ( (amount !== undefined) && !(((typeof amount === "number") && (amount > 0)) || ((typeof amount === "string") && amount.trim())) ) {
    errors.push("regeneration.amount: positive number or formula");
  }
  for ( const key of ["needsHp", "survivesZero", "critical"] ) {
    if ( (value[key] !== undefined) && (typeof value[key] !== "boolean") ) errors.push(`regeneration.${key}: boolean`);
  }
  for ( const key of ["stoppedBy", "silveredBy"] ) {
    if ( value[key] === undefined ) continue;
    if ( !Array.isArray(value[key]) ) { errors.push(`regeneration.${key}: array of damage types`); continue; }
    for ( const t of value[key] ) if ( !damageTypes.includes(t) ) errors.push(`regeneration.${key}: unknown damage type "${t}"`);
  }
  if ( (value.stoppedByItems !== undefined) && !(Array.isArray(value.stoppedByItems) && value.stoppedByItems.every(x => (typeof x === "string") && x)) ) {
    errors.push("regeneration.stoppedByItems: array of item identifiers");
  }
  if ( value.stoppedWhile !== undefined ) {
    if ( !Array.isArray(value.stoppedWhile) ) errors.push(`regeneration.stoppedWhile: array of ${REGENERATION_STOPS.join(", ")}`);
    else for ( const w of value.stoppedWhile ) {
      if ( !REGENERATION_STOPS.includes(w) ) errors.push(`regeneration.stoppedWhile: unknown "${w}" (${REGENERATION_STOPS.join(", ")})`);
    }
  }
  return errors;
}

/**
 * At the start of its turn: `heal` (it regenerates), `dies` (0 HP and the regeneration does not function: the troll dies) or
 * `none`.
 * @param {{hp: number, needsHp: boolean, stopped: boolean, survivesZero: boolean, dead: boolean, held?: boolean}} state
 */
export function regenerationAtTurnStart({ hp, needsHp, stopped, survivesZero, dead, held=false }) {
  if ( dead ) return "none";
  // B04: `held` — the creature is where its trait does not function (in sunlight, in running water): like a stopped regeneration.
  if ( stopped || held ) return (survivesZero && (hp <= 0)) ? "dies" : "none";
  if ( needsHp && (hp < 1) ) return "none";
  return "heal";
}

/**
 * Do the damage types taken stop the regeneration? `silvered`: the types received from a silvered weapon (§78); K2 (§323):
 * `critical` — the rule stops on a Critical Hit (`byCritical`), and the damage comes from a Critical Hit.
 * B04: `byItems` / `item` — the identifier of the damage's item is one of those that stop it (holy water).
 */
export function stopsRegeneration(stoppedBy, types, silveredBy=[], silvered=[], { byCritical=false, critical=false, byItems=[], item=null }={}) {
  return stoppedBy.some(t => types.includes(t)) || silveredBy.some(t => silvered.includes(t)) || (byCritical && critical)
    || (!!item && byItems.includes(item));
}
