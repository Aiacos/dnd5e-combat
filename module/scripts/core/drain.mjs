/**
 * M8 (SPEC §18.16): Hit Point maximum drain (Life Drain of the Wight, Wraith, Specter; Chasme's Proboscis; Clay Golem's Slam;
 * Bite and Blood Drain of vampires; "Draining Kiss"; "Doom Word"; Demilich's Energy Drain); §105: ability score drain
 * (Shadow's Draining Swipe), and sheets in 2014 format or written in French (Life Drain of a hand-made vampiric mist). What the
 * original English text says, or the French text of a sheet without an original. Pure functions, without Foundry.
 */

import { plainStatText as plain } from "./text.mjs";

/** Damage types named in French in the drain sentence. */
const FRENCH_TYPES = { "nécrotiques": "necrotic", "nécrotique": "necrotic", "radiants": "radiant", "psychiques": "psychic" };

/** Abilities, by their English and French names. */
const ABILITIES = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha",
  force: "str", "dextérité": "dex", sagesse: "wis", charisme: "cha"
};

/** The drained amount: an enriched roll `[[/r 1d4]]`, or dice written in plain text. */
const DICE = /\[\[\/r ([^\]#]+?)(?:#[^\]]*)?\]\](?:\{[^}]*\})?|(\d+d\d+(?:\s*[+-]\s*\d+)?)/.source;
const ABILITY_EN = new RegExp(String.raw`\b(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score (?:decreases|is reduced) by (?:${DICE})`, "i");
const ABILITY_FR = new RegExp(String.raw`\bvaleur de (Force|Dextérité|Constitution|Intelligence|Sagesse|Charisme)(?: de la cible)? (?:est réduite|diminue|baisse) de (?:${DICE})`, "i");

/**
 * - `equal`: "its Hit Point maximum decreases by an amount equal to the [Necrotic] damage taken" — `type`: that type
 *   only (null: all);
 * - `regains`: "and the vampire regains Hit Points equal to that amount";
 * - `fixed`: "the target's Hit Point maximum decreases by 14 ([[/r 4d6]])" — a formula, on a failed save;
 * - `onFailedSave`: 2014 format, "must succeed on a … saving throw or its Hit Point maximum is reduced by…" — the part
 *   equal to the damage is drained only if the save that the touch imposes is failed;
 * - `ability`: "the target's Strength score decreases by [[/r 1d4]]" — { key, formula }, on a hit;
 * - `floor`: §283, "Contamination" (PHB 2024) — "can't reduce a target's Hit Point maximum below 1": the maximum does not go
 *   below this floor (and the drain does not kill). The same sentence says "the Necrotic damage it took" and "On a failed
 *   save, it takes … and its Hit Point maximum is reduced": drain equal to the damage, on the failed save.
 * A reduction "every 24 hours" (curses of the Mummy, of the Slaad) is not a combat drain: ignored.
 * @param {string} html
 * @returns {{equal: boolean, type: string|null, regains: boolean, fixed: string|null, onFailedSave: boolean,
 *   ability: {key: string, formula: string}|null, floor: number|null}}
 */
export function readDrain(html) {
  const raw = String(html ?? "").replace(/’/g, "'");
  const text = plain(raw);
  const none = { equal: false, type: null, regains: false, fixed: null, onFailedSave: false, ability: null, floor: null };
  if ( /\bevery \d+ hours\b|\btoutes les \d+ heures\b/i.test(text) ) return none;
  const en = text.match(/Hit Points? maximum (?:decreases|is reduced) by an amount equal to the (?:([A-Za-z]+) )?damage (?:taken|it took)/i);
  const fr = text.match(/maximum de points de vie (?:est réduit|diminue|baisse) d'un montant égal aux dégâts (?:([a-zàâéèêîôû]+) )?subis/i);
  const equal = !!(en || fr);
  const type = en?.[1] ? en[1].toLowerCase() : (fr?.[1] ? (FRENCH_TYPES[fr[1].toLowerCase()] ?? null) : null);
  const regains = /\bregains Hit Points equal to that amount\b|\bregagne (?:autant de points de vie|un nombre de points de vie égal à ce montant)/i.test(text);
  const fixed = raw.match(/Hit Point maximum decreases by \d+ \(\[\[\/r ([^\]#]+?)(?:#[^\]]*)?\]\]\)/i)?.[1]?.trim() ?? null;
  const onFailedSave = equal && (/\bmust succeed on [^.]{0,80}saving throw or its Hit Point maximum/i.test(text)
    || /\bOn a failed save, [^.]{0,120}Hit Point maximum (?:decreases|is reduced)/i.test(text)
    || /\bdoit réussir un jet de sauvegarde[^.]{0,80}sinon son maximum de points de vie/i.test(text));
  const a = raw.match(ABILITY_EN) ?? raw.match(ABILITY_FR);
  const ability = a ? { key: ABILITIES[a[1].toLowerCase()], formula: (a[2] ?? a[3]).trim() } : null;
  const below = text.match(/can't reduce (?:a|the) target's Hit Point maximum below (\d+)/i)
    ?? text.match(/ne peut pas réduire le maximum de points de vie d'une cible en dessous de (\d+)/i);
  const floor = below ? Number(below[1]) : null;
  return { equal, type, regains, fixed, onFailedSave, ability, floor };
}

/** What a drain can still remove when the current maximum is `max` and the text sets a floor (null: everything). */
export const flooredDrain = (n, max, floor) => (Number.isFinite(floor) ? Math.max(0, Math.min(n, max - floor)) : n);

/** Does the text describe a drain that the engine can play? */
export const drains = rule => !!(rule && (rule.equal || rule.fixed || rule.ability));

/**
 * The drained part of computed damage (final values by type, after Resistances): that of the named type, or all damage
 * (excluding healing and Temporary Hit Points); never more than the total taken.
 * @param {Array<{type: string, value: number}>} damages
 * @param {string|null} type
 * @param {number} [amount]   Total taken.
 */
export function drainedAmount(damages, type, amount) {
  const skip = new Set(["healing", "temphp", "maximum"]);
  const sum = damages.filter(d => (d.value > 0) && !skip.has(d.type) && (!type || (d.type === type))).reduce((n, d) => n + d.value, 0);
  return Math.max(0, Math.min(Math.trunc(sum), Math.trunc(amount ?? sum)));
}

/**
 * The effect that carries a drain on the target: only one per source and per drained quantity, whose total grows with each drain.
 * Hit Point maximum: `hp.tempmax` (which dnd5e adds to the maximum, data/actor/templates/attributes.mjs:468), until a Long Rest
 * ("until the target finishes a Long Rest"); ability: until a Long Rest too (the 2024 Monster Manual gives no
 * duration; user's choice, 2026-10-07).
 * @param {{kind: "hp"|string, total: number}} drain   `kind`: "hp", or the ability key.
 * @returns {{key: string, change: number, expiry: "longRest"}}
 */
export function drainEffectShape({ kind, total }) {
  if ( kind === "hp" ) return { key: "system.attributes.hp.tempmax", change: -total, expiry: "longRest" };
  return { key: `system.abilities.${kind}.value`, change: -total, expiry: "longRest" };
}

/**
 * §120: what the author regains (key `lifesteal`, Vampiric Touch) — a part of the damage of that type dealt, rounded down to
 * the integer ("half the necrotic damage dealt").
 * @param {Array<{value: number, type: string}>} damages
 * @param {{damageType?: string, fraction?: number}} rule
 * @returns {number}
 */
export function lifestealAmount(damages, { damageType=null, fraction=1 }={}) {
  return Math.max(0, Math.floor(drainedAmount(damages, damageType) * fraction));
}
