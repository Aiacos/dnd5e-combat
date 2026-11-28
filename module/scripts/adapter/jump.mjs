/**
 * §208: what a token's jump can do now — from its sheet (Strength, Dexterity), its content (`jump`: Athlete,
 * Second-Story Work, the *Jump* spell through its effect, equipped Boots, Step of the Wind), its run-up (the core's movement
 * history, in combat) and the turn's budget (fixed jump already taken, doubled distance). The rules: core/jump.mjs.
 * Lengths in feet, unless stated.
 */
import { RUN_UP, jumpLimits, hasRunningStart } from "../core/jump.mjs";
import { contentOf } from "./content.mjs";
import { originItemOf } from "./facts.mjs";
import { combatantFor, readBudget, committedPosition } from "./turn.mjs";
import { lengthIn } from "./units.mjs";
import { difficultRegionsFor } from "./path-world.mjs";

/** An item that acts when worn: equipped, and attuned if it requires attunement. */
const worn = item => (item.system?.equipped !== false) && ((item.system?.attunement !== "required") || item.system?.attuned === true);

/**
 * This actor's jump rules.
 * @returns {{runUp: number, useDex: boolean, fixed: {distance: number, cost: number}|null, double: string[]}}
 */
export function jumpRulesOf(actor) {
  const out = { runUp: RUN_UP, useDex: false, fixed: null, double: [] };
  const take = (rule, { carried }) => {
    if ( !rule ) return;
    if ( Number.isFinite(rule.runUp) ) out.runUp = Math.min(out.runUp, rule.runUp);
    if ( rule.useDex ) out.useDex = true;
    if ( rule.double ) out.double.push(...rule.double);
    const f = rule.fixed;
    // A fixed jump carried by a spell's effect (Jump) applies only to the creature that carries the effect, not to the caster.
    if ( f && ((f.from === "effect") ? !carried : carried) && (!out.fixed || (f.distance > out.fixed.distance)) ) {
      out.fixed = { distance: f.distance, cost: f.cost };
    }
  };
  for ( const item of actor?.items ?? [] ) {
    const rule = contentOf(item).entry?.jump;
    if ( !rule ) continue;
    const physical = ["equipment", "weapon", "consumable", "tool", "loot", "container"].includes(item.type);
    if ( physical && !worn(item) ) continue;
    take(rule, { carried: true });
  }
  for ( const effect of actor?.effects ?? [] ) {
    if ( effect.disabled || effect.isSuppressed ) continue;
    const item = originItemOf(effect);
    if ( item ) take(contentOf(item).entry?.jump, { carried: false });
  }
  return out;
}

/**
 * The run-up: out of combat, always (time does not count); in combat, the walk before the jump, read from the turn's movement
 * history (`TokenDocument#movementHistory`, cleared at the start of the turn), must be at least `runUp` feet.
 */
export function runningStartOf(token, runUp=RUN_UP) {
  if ( !combatantFor(token.actor) ) return true;
  const grid = token.parent?.grid;
  if ( !grid?.size ) return false;
  const points = [...(token.movementHistory ?? []), committedPosition(token)];
  const steps = [];
  for ( let i = 1; i < points.length; i++ ) {
    const a = points[i - 1];
    const b = points[i];
    const d = grid.measurePath([{ x: a.x, y: a.y }, { x: b.x, y: b.y }]).distance;
    steps.push({ distance: lengthIn(d, grid.units, "ft"), action: b.action ?? null });
  }
  return hasRunningStart(steps, runUp);
}

/** What this token's jump allows, in feet, and the fixed jump if it is still free this turn. */
export function jumpOptionsOf(token) {
  const actor = token.actor;
  const rules = jumpRulesOf(actor);
  const combatant = combatantFor(actor);
  const budget = combatant ? readBudget(combatant) : null;
  const abilities = actor?.system?.abilities ?? {};
  const runningStart = runningStartOf(token, rules.runUp);
  const limits = jumpLimits({ str: abilities.str?.value, dex: abilities.dex?.value, useDex: rules.useDex, runningStart,
    double: !!budget?.jumpDouble });
  return { ...limits, runningStart, fixed: (budget?.fixedJump ? null : rules.fixed), rules, combatant, budget };
}

/** Is the arrival cell Difficult Terrain for this token (dnd5e's Difficult Terrain regions)? */
export function landsOnDifficult(token, point, elevation) {
  return difficultRegionsFor(token).some(region => region.testPoint?.({ x: point.x, y: point.y, elevation }));
}
