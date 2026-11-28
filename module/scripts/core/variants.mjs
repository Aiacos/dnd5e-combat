/**
 * M5 (SPEC §18.8): variants of a monster attack. The Monster Manual encodes "if the creature has charged", "if the swarm is
 * Bloodied", "if the roll had Advantage" with a SECOND attack activity on the same item, named after its
 * condition (original English name, which Babele keeps):
 *  - "Moving Attack" / "Charging Attack", `activation.condition` "moved 20+ feet (straight toward the target)";
 *  - "Bloodied Attack": the swarm (or the Quaggoth) Bloodied; the Blood Hawk: "if the target is Bloodied";
 *  - "Attack with Advantage" / "Attack at Advantage" (goblins, Chimera, Scout Captain);
 *  - "Attacked if Grappling" (Mimic: the target is grappled by it).
 * The engine chooses the right activity in the GM's place: at use for what is known before the roll (charge, Bloodied,
 * grappled), at the damage roll for Advantage ("if the attack roll had Advantage" is only known after the roll).
 *
 * Pure: plain objects.
 */

import { sizeLimitIn } from "./riders.mjs";

/** dnd5e size ranks, for "Medium or smaller" ("de taille M ou inférieure"). */
const SIZE_RANK = Object.freeze({ tiny: 0, sm: 1, med: 2, lg: 3, huge: 4, grg: 5 });

/** The charge sentence when it bounds the size: "If the target is a Medium or smaller creature and … moved 20+ feet". */
const CHARGE_SIZE = /If the target is ([^.]*?)\bmoved \d+/i;

/** Kind of an attack activity from its English name, or null for the base attack. */
function kindOf(name) {
  const n = String(name ?? "");
  if ( /\b(Moving|Charging) Attack\b/i.test(n) ) return "charge";
  if ( /\bBloodied Attack\b/i.test(n) ) return "bloodied";
  if ( /\bAttack (with|at) Advantage\b/i.test(n) ) return "advantage";
  if ( /\bif Grappling\b/i.test(n) ) return "grappled";
  return null;
}

/**
 * The variants of an item, or null if it has none.
 * @param {Array<{id: string, type: string, name: string, condition?: string, effects?: string[], sizeAtMost?: string}>}
 *   activities  `name`: original English name; `effects`: ids of the activity's effects; `sizeAtMost`: the maximum size
 *   of the target the activity states (`target.affects.special`, dnd5e size key).
 * @param {string} [description]  English description of the item (plain text or HTML)
 * @returns {{base: string, baseEffects: string[],
 *   variants: Array<{id: string, kind: string, feet?: number, subject?: string, effects: string[]}>}|null}
 */
export function variantsOf(activities, description="") {
  const attacks = (activities ?? []).filter(a => a.type === "attack");
  if ( attacks.length < 2 ) return null;
  const text = String(description ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&");
  const variants = [];
  let base = null;
  for ( const a of attacks ) {
    const kind = kindOf(a.name);
    if ( !kind ) { base ??= a; continue; }
    const v = { id: a.id, kind, effects: a.effects ?? [] };
    if ( kind === "charge" ) {
      const m = String(a.condition ?? "").match(/(\d+)\+?\s*(?:feet|ft)/i) ?? text.match(/moved (\d+)\+?\s*(?:feet|ft)/i);
      v.feet = m ? Number(m[1]) : 20;
      // The charge only applies against a target of at most this size: the activity says so, otherwise the description's sentence.
      const size = a.sizeAtMost ?? sizeLimitIn(text.match(CHARGE_SIZE)?.[1] ?? "");
      if ( size ) v.sizeAtMost = size;
    }
    if ( kind === "bloodied" ) v.subject = /if the target is (?:&Reference\[)?Bloodied/i.test(text) ? "target" : "self";
    variants.push(v);
  }
  if ( !base || !variants.length ) return null;
  return { base: base.id, baseEffects: base.effects ?? [], variants };
}

/**
 * The variant to use before the roll, or null (the base attack). Advantage is not judged here.
 * @param {object} plan  returned by `variantsOf`
 * @param {{selfBloodied?: boolean, targetBloodied?: boolean, chargedFeet?: number, grappledBySelf?: boolean,
 *   targetSize?: string}} facts
 *   `targetSize`: the target's size (dnd5e key); unknown, a charge's size bound retains nothing.
 * @returns {string|null}  activity id
 */
export function chooseVariant(plan, facts={}) {
  for ( const v of plan?.variants ?? [] ) {
    const tooBig = !!v.sizeAtMost && (facts.targetSize in SIZE_RANK)
      && (SIZE_RANK[facts.targetSize] > SIZE_RANK[v.sizeAtMost]);
    if ( (v.kind === "charge") && ((facts.chargedFeet ?? 0) >= v.feet) && !tooBig ) return v.id;
    if ( (v.kind === "bloodied") && (v.subject === "self") && facts.selfBloodied ) return v.id;
    if ( (v.kind === "bloodied") && (v.subject === "target") && facts.targetBloodied ) return v.id;
    if ( (v.kind === "grappled") && facts.grappledBySelf ) return v.id;
  }
  return null;
}

/** The variant "if the roll had Advantage", to take for the damage. */
export function advantageVariant(plan) {
  return plan?.variants.find(v => v.kind === "advantage")?.id ?? null;
}

/**
 * Effects of the base attack that its charge variant also carries: they only apply after a charge (the text says so:
 * "if … moved 20+ feet straight toward it …, the target … has the Prone condition"). The MM sometimes copied them onto
 * the base attack (Boar Tusk): we remove them from the base attack.
 */
export function chargeOnlyEffects(plan) {
  const charge = plan?.variants.find(v => v.kind === "charge");
  return charge ? plan.baseEffects.filter(id => charge.effects.includes(id)) : [];
}

/**
 * The straight-line charge that precedes the attack: the longest end of the turn's path that goes straight toward the target.
 * Points in cells (top-left corner or center, as long as it is the same reference), distance of a cell in feet.
 * Straight: each intermediate point stays within half a cell of the line; toward the target: the distance to the target
 * dropped by at least 80% of the distance traveled. Length counted in cells (diagonal = 1 cell, dnd5e default rule).
 * @param {Array<{x: number, y: number}>} path  positions of the turn, the last = current position
 * @param {{x: number, y: number}} target
 * @param {number} cellFeet
 * @returns {number}  feet traveled in a straight line toward the target, 0 otherwise
 */
export function straightChargeFeet(path, target, cellFeet) {
  const pts = (path ?? []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
  if ( pts.length < 2 ) return 0;
  const end = pts.at(-1);
  const euclid = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const cells = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  let best = 0;
  for ( let k = pts.length - 2; k >= 0; k-- ) {
    const start = pts[k];
    const length = euclid(start, end);
    if ( length < 1e-6 ) continue;
    // Straight: the points between start and end stay close to the line.
    const straight = pts.slice(k + 1, -1).every(p => {
      const cross = Math.abs(((end.x - start.x) * (p.y - start.y)) - ((end.y - start.y) * (p.x - start.x)));
      return (cross / length) <= 0.5;
    });
    if ( !straight ) break;
    const closer = euclid(start, target) - euclid(end, target);
    if ( closer >= 0.8 * length ) best = Math.max(best, cells(start, end) * cellFeet);
  }
  return best;
}
