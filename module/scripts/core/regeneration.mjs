/**
 * M8 (SPEC §18.13) : Régénération des monstres (Trolls, Slaads, Oni, Gardien du bouclier, Revenant) ; §482 (B04) : forme déclarée. Ce que le texte anglais
 * d'origine précise, et ce qui se passe au début du tour de la créature. Fonctions pures, sans Foundry.
 */

const plain = html => String(html ?? "").replace(/&amp;/g, "&").replace(/\[\[[^\]]*\]\]/g, "…").replace(/&Reference\[([^\]]+)\]/g, "$1")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/\s+/g, " ");

const WHO = "(?:it|she|he|they)";
const types = s => s.split(/,|\bor\b|\band\b/).map(x => x.trim().toLowerCase()).filter(Boolean);

/**
 * B04 : une liste « necrotic damage or bludgeoning, piercing, or slashing damage from a silvered weapon or damage from holy water or
 * damage from a Critical Hit » — un groupe par « … damage », chacun pouvant venir d'une arme argentée, plus l'eau bénite et le coup
 * critique.
 */
function readDamageClause(clause, out) {
  if ( /\bdamage from (?:a )?critical hits?\b/i.test(clause) ) out.critical = true;
  if ( /\bdamage from (?:a (?:vial|flask) of )?holy water\b/i.test(clause) && !out.stoppedByItems.includes("holy-water") ) out.stoppedByItems.push("holy-water");
  for ( const m of clause.matchAll(/(?:^|\bor\s+)((?:[a-z]+,?\s+(?:or\s+)?)*?[a-z]+) damage( from (?:a )?silvered weapons?)?/gi) ) {
    (m[2] ? out.silveredBy : out.stoppedBy).push(...types(m[1]));
  }
}

/**
 * - `needsHp` : « if it has at least 1 Hit Point » (Slaads, Oni) — B04 : « she », « he », « they » aussi ;
 * - `stoppedBy` : « If the troll takes Acid or Fire damage, this trait doesn't function on the troll's next turn » — B04 : la même
 *   tournure lit aussi l'arme argentée (« … or bludgeoning, piercing, or slashing damage from a silvered weapon, this trait doesn't
 *   function at the start of the werewolf's next turn ») ;
 * - `stoppedByItems` (B04) : « or damage from holy water » → `["holy-water"]` (identifiant de l'objet qui inflige les dégâts) ;
 * - `stoppedWhile` (B04) : « and isn't in sunlight or running water » → `["sunlight", "runningWater"]` ;
 * - `survivesZero` : « The troll dies only if it starts its turn with 0 Hit Points and doesn't regenerate ».
 * - §78, lycanthropes (MM 2014) : « regains 10 hit points at the start of her turn if she hasn't taken necrotic damage or
 *   bludgeoning, piercing, or slashing damage from a silvered weapon since her last turn » — `stoppedBy` (nécrotique) et
 *   `silveredBy` (contondant, perforant, tranchant : seulement d'une arme argentée).
 * - K2 (§323) : `critical` — « or damage from a Critical Hit » : un coup critique la coupe aussi.
 * @param {string} html
 * @returns {{needsHp: boolean, stoppedBy: string[], silveredBy: string[], stoppedByItems: string[], stoppedWhile: string[], survivesZero: boolean, critical: boolean}}
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

/** B04 : les clés de la forme déclarée `regeneration: { … }`, et les lieux où le trait ne fonctionne pas. */
export const REGENERATION_KEYS = Object.freeze(["amount", "needsHp", "stoppedBy", "silveredBy", "stoppedByItems", "stoppedWhile", "survivesZero", "critical"]);
export const REGENERATION_STOPS = Object.freeze(["sunlight", "runningWater"]);

/**
 * B04 : la régénération retenue — la lecture du texte, puis les clés déclarées par-dessus (une clé déclarée remplace la lecture ;
 * une clé absente reste celle du texte). `amount` : formule (ou nombre) du soin à la place de celle de l'activité ; `null` sinon.
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

/** B04 : validation de l'entrée `regeneration` — `true`, ou un objet aux clés connues. */
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
 * Au début de son tour : `heal` (elle régénère), `dies` (0 PV et la régénération ne fonctionne pas : le troll meurt) ou
 * `none`.
 * @param {{hp: number, needsHp: boolean, stopped: boolean, survivesZero: boolean, dead: boolean, held?: boolean}} state
 */
export function regenerationAtTurnStart({ hp, needsHp, stopped, survivesZero, dead, held=false }) {
  if ( dead ) return "none";
  // B04 : `held` — la créature est là où son trait ne fonctionne pas (au soleil, dans une eau courante) : comme une régénération coupée.
  if ( stopped || held ) return (survivesZero && (hp <= 0)) ? "dies" : "none";
  if ( needsHp && (hp < 1) ) return "none";
  return "heal";
}

/**
 * Les types de dégâts subis coupent-ils la régénération ? `silvered` : les types reçus d'une arme argentée (§78) ; K2 (§323) :
 * `critical` — la règle coupe sur un coup critique (`byCritical`), et les dégâts viennent d'un coup critique.
 * B04 : `byItems` / `item` — l'identifiant de l'objet des dégâts est l'un de ceux qui la coupent (eau bénite).
 */
export function stopsRegeneration(stoppedBy, types, silveredBy=[], silvered=[], { byCritical=false, critical=false, byItems=[], item=null }={}) {
  return stoppedBy.some(t => types.includes(t)) || silveredBy.some(t => silvered.includes(t)) || (byCritical && critical)
    || (!!item && byItems.includes(item));
}
