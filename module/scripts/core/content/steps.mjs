/**
 * Validation of a step (`do`), a declaration (`triggers`) and an aura. Pure functions, no dependency on Foundry.
 */

import { CREATURE_TYPES } from "../eligibility.mjs";
import { MOMENTS, OUTCOME_MOMENTS, RESAVE_MOMENTS, BEARER_MOMENTS, BEARER_DAMAGE_MOMENTS, TURN_MOMENTS, unknownFacts, normalize, PRE_ATTACK_WINDOWS, DAMAGED_BY } from "../triggers.mjs";
import { ABILITIES, ATTACK_STEPS, AURA_AFFECTS, DAMAGE_ON_SAVE, DAMAGE_TO, FALL_WINDOWS, HIT_WINDOWS, MOVE_DIRECTIONS, MOVE_IF_BLOCKED, MOVE_MODES, OUTCOME_STEPS, RESAVE_ON_FAIL, STEP_TYPES, VIA } from "./enums.mjs";
import { isId, isObject } from "./shared.mjs";
import { SAME_DAMAGE } from "../damage-return.mjs";

/** §485: `resave.own` — the save of an effect borne by the reacting creature, which their player chooses (Indomitable). */
export const RESAVE_OWN = Object.freeze(["choose"]);
/** §485: the windows where `resave.own` plays out (runtime/resave-choice.mjs). */
export const RESAVE_OWN_MOMENTS = Object.freeze(["enemyTurnEnd"]);

function validateStep(step, at, errors) {
  if ( !isObject(step) ) return errors.push(`${at}: a step is an object`);
  if ( !STEP_TYPES.includes(step.type) ) return errors.push(`${at}.type: unknown "${step.type}" (${STEP_TYPES.join(", ")})`);
  if ( step.type === "damage" ) {
    if ( ("to" in step) && !DAMAGE_TO.includes(step.to) ) errors.push(`${at}.to: ${DAMAGE_TO.join(", ")}`);
    if ( ("onSave" in step) && !DAMAGE_ON_SAVE.includes(step.onSave) ) errors.push(`${at}.onSave: ${DAMAGE_ON_SAVE.join(", ")}`);
    // A retort (or the damage of the bearer) can replay the damage activity of the item; a share (to: "origin") with no
    // formula takes up the amount taken.
    const fromActivity = ["source", "bearer", "self"].includes(step.to) && ("activity" in step);
    const same = (step.to === "origin") && !("formula" in step);
    // §499 (B19): `same` — the retort returns the amount taken (at the isDamaged moment), of the type received or of `damageType`.
    const returned = (step.to === "source") && ("same" in step);
    if ( "same" in step ) {
      if ( step.to !== "source" ) errors.push(`${at}.same: only for a riposte (to: "source")`);
      if ( !SAME_DAMAGE.includes(step.same) ) errors.push(`${at}.same: true or "resisted"`);
      if ( ("formula" in step) || ("activity" in step) ) errors.push(`${at}.same: without formula or activity`);
      if ( ("damageType" in step) && ((typeof step.damageType !== "string") || !step.damageType) ) errors.push(`${at}.damageType: a damage type`);
    }
    if ( !fromActivity && !same && !returned ) {
      if ( (typeof step.formula !== "string") || !step.formula.trim() ) errors.push(`${at}.formula: formula required`);
      // §161: a list of types to choose from for bonus damage (`preDamageRoll`).
      const typeOk = t => (typeof t === "string") && !!t;
      if ( !(typeOk(step.damageType) || (Array.isArray(step.damageType) && step.damageType.length && step.damageType.every(typeOk))) ) errors.push(`${at}.damageType: damage type required`);
    }
  }
  // §74: `spends` — bonus damage that spends an item effect borne by the author (Zephyr Strike: "once").
  if ( (step.type === "damage") && ("spends" in step) && !isId(step.spends) ) errors.push(`${at}.spends: item effect id (16 characters) expected`);
  // §133: "target" — the creature targeted by the attack that opens the window (Protection: the "Protected" effect on the ally).
  if ( (step.type === "use") && ("target" in step) && !["source", "self", "target"].includes(step.target) ) errors.push(`${at}.target: "source", "self" or "target"`);
  if ( (step.type === "use") && ("advantage" in step) && (step.advantage !== true) ) errors.push(`${at}.advantage: true or absent`);
  if ( (step.type === "use") && ("consume" in step) && (step.consume !== false) ) errors.push(`${at}.consume: false or absent`);
  // §489: a use that costs the budget nothing (the retort of a Parry, part of the Reaction already taken).
  if ( (step.type === "use") && ("free" in step) && (step.free !== true) ) errors.push(`${at}.free: true or absent`);
  // §489: the forced reroll has no option.
  if ( (step.type === "reroll") && Object.keys(step).some(k => k !== "type") ) errors.push(`${at}: "reroll" takes no option`);
  if ( (step.type === "use") && ("approach" in step) && ((step.approach !== true) || (step.target !== "source")) ) errors.push(`${at}.approach: true, with target: "source"`);
  // §88: attack with a melee weapon of the actor (Riposte).
  if ( (step.type === "use") && ("weapon" in step) && ((step.weapon !== true) || (step.target !== "source")) ) errors.push(`${at}.weapon: true, with target: "source"`);
  if ( "margin" in step ) {
    const mg = step.margin;
    const ok = (typeof mg === "object") && mg && Object.keys(mg).length && Object.entries(mg).every(([k, v]) => ["min", "max"].includes(k) && Number.isFinite(v) && (v >= 0));
    if ( !ok ) errors.push(`${at}.margin: { min?, max? } (numbers ≥ 0)`);
  }
  if ( ["use", "replay", "ward", "damage"].includes(step.type) && ("activity" in step) && !isId(step.activity) ) errors.push(`${at}.activity: activity id (16 characters) expected`);
  if ( (step.type === "damage") && ("activity" in step) && !["source", "bearer", "self"].includes(step.to) ) errors.push(`${at}.activity: only for a riposte (to: "source") or the bearer (to: "bearer", "self")`);
  if ( step.type === "move" ) {
    if ( !MOVE_MODES.includes(step.mode) ) errors.push(`${at}.mode: ${MOVE_MODES.join(", ")}`);
    const formula = (typeof step.distance === "string") && step.distance.trim();
    if ( !formula && !(Number.isFinite(step.distance) && (step.distance > 0)) ) errors.push(`${at}.distance: positive number or formula`);
    if ( (typeof step.units !== "string") || !step.units ) errors.push(`${at}.units: unit required`);
    if ( ("follow" in step) && (typeof step.follow !== "boolean") ) errors.push(`${at}.follow: boolean`);
    // §401: "up to" — the author chooses the distance (Thorn Whip: "you can pull it up to 3 m").
    if ( ("upTo" in step) && (step.upTo !== true) ) errors.push(`${at}.upTo: true or absent`);
    // §466: `toward: "area"` — a pull toward the center of the area of the activity (Implosion), not toward the author.
    // §502 (B22): `toward: "summon"` — toward the author's summon (the vine of "Greedy Vine").
    if ( ("toward" in step) && !(["area", "summon"].includes(step.toward) && (step.mode === "pull")) ) errors.push(`${at}.toward: "area" or "summon" (with mode "pull") or absent`);
    // §497: random movement (Infestation) — directions rolled on a die, blocked cell, minimum Speed.
    const random = step.mode === "random";
    if ( ("directions" in step) && !(random && Array.isArray(step.directions) && step.directions.length
      && step.directions.every(d => MOVE_DIRECTIONS.includes(d)) && (new Set(step.directions).size === step.directions.length)) ) {
      errors.push(`${at}.directions: distinct directions among ${MOVE_DIRECTIONS.join(", ")} (with mode "random")`);
    }
    if ( ("ifBlocked" in step) && !(random && MOVE_IF_BLOCKED.includes(step.ifBlocked)) ) errors.push(`${at}.ifBlocked: ${MOVE_IF_BLOCKED.join(", ")} (with mode "random")`);
    if ( ("minSpeed" in step) && !(random && Number.isFinite(step.minSpeed) && (step.minSpeed > 0)) ) errors.push(`${at}.minSpeed: positive number, in units (with mode "random")`);
    if ( random && (("upTo" in step) || ("follow" in step)) ) errors.push(`${at}: mode "random" takes neither upTo nor follow`);
  }
  if ( (step.type === "status") && ((typeof step.status !== "string") || !step.status) ) errors.push(`${at}.status: condition required`);
  // §345: `save` — the condition only if the target fails this save (Giant Slayer: Strength DC 15 or Prone).
  if ( (step.type === "status") && ("save" in step) && !(isObject(step.save) && (typeof step.save.ability === "string") && /^[a-z]{3}$/.test(step.save.ability)
    && Number.isFinite(step.save.dc) && (step.save.dc > 0)) ) errors.push(`${at}.save: { ability, dc }`);
  // §352: `around` — also each creature within this distance of the target, the author excepted ("Thunder Hammer").
  if ( (step.type === "status") && ("around" in step) && !(isObject(step.around) && Number.isFinite(step.around.radius) && (step.around.radius > 0)
    && (typeof step.around.units === "string") && step.around.units) ) errors.push(`${at}.around: { radius, units }`);
  if ( (step.type === "lift") && !(Number.isFinite(step.height) && (step.height > 0) && (typeof step.units === "string") && step.units) ) errors.push(`${at}.height, units: elevation required`);
  // §86: retort by a save — toward the attacker, an activity of the item.
  if ( step.type === "save" ) {
    if ( step.to !== "source" ) errors.push(`${at}.to: "source"`);
    if ( !isId(step.activity) ) errors.push(`${at}.activity: activity id (16 characters) expected`);
  }
  if ( step.type === "mark" ) {
    if ( (typeof step.mark !== "string") || !step.mark ) errors.push(`${at}.mark: mark name required`);
    if ( (typeof step.label !== "string") || !step.label ) errors.push(`${at}.label: translation key required`);
    if ( ("seconds" in step) && !(Number.isFinite(step.seconds) && (step.seconds > 0)) ) errors.push(`${at}.seconds: positive number`);
  }
  // C12-b: `disarm` — the item effect applied instead when the target has nothing to drop (Heat Metal).
  if ( (step.type === "disarm") && ("elseEffect" in step) && !isId(step.elseEffect) ) errors.push(`${at}.elseEffect: effect id`);
  if ( (step.type === "consume") && !["target", "source"].includes(step.side) ) errors.push(`${at}.side: "target" or "source"`);
  if ( (step.type === "resave") && ("keep" in step) && (step.keep !== true) ) errors.push(`${at}.keep: true or absent`);
  if ( (step.type === "resave") && ("unlessSeesOrigin" in step) && (step.unlessSeesOrigin !== true) ) errors.push(`${at}.unlessSeesOrigin: true or absent`);
  if ( (step.type === "resave") && ("ifCompelled" in step) && (step.ifCompelled !== true) ) errors.push(`${at}.ifCompelled: true or absent`);
  if ( (step.type === "resave") && ("advantage" in step) && (step.advantage !== true) ) errors.push(`${at}.advantage: true or absent`);
  if ( (step.type === "resave") && ("tally" in step) ) {
    const t = step.tally;
    const count = n => Number.isInteger(n) && (n > 0);
    if ( !isObject(t) || !count(t.successes) || !count(t.failures) || (("status" in t) && ((typeof t.status !== "string") || !t.status))
      || !Object.keys(t).every(k => ["successes", "failures", "status"].includes(k)) ) errors.push(`${at}.tally: { successes, failures, status? } (positive integers, condition)`);
    if ( step.keep === true ) errors.push(`${at}.tally: not applicable with keep`);
  }
  // §495 (brick B15): condition ladder — `stages: [{ effect?, status? }]`, `onSuccess`, `critEnds`.
  if ( (step.type === "resave") && ("stages" in step) ) {
    const s = step.stages;
    const stageOk = x => isObject(x) && (("effect" in x) || ("status" in x)) && Object.keys(x).every(k => ["effect", "status"].includes(k))
      && (!("effect" in x) || isId(x.effect)) && (!("status" in x) || ((typeof x.status === "string") && !!x.status));
    if ( !Array.isArray(s) || !s.length || (s.length > 5) || !s.every(stageOk) ) errors.push(`${at}.stages: [{ effect?: effect id, status?: condition }] (1 to 5 stages)`);
    if ( ("tally" in step) || (step.keep === true) ) errors.push(`${at}.stages: not applicable with tally or keep`);
  }
  if ( (step.type === "resave") && ("onSuccess" in step) && (!("stages" in step) || !["down", "end"].includes(step.onSuccess)) ) errors.push(`${at}.onSuccess: "down" or "end", with stages`);
  if ( (step.type === "resave") && ("critEnds" in step) && (!("stages" in step) || (step.critEnds !== true)) ) errors.push(`${at}.critEnds: true or absent, with stages`);
  // C12-e: a save the data lacks (Power Word Stun: utility activity) — its ability, at the caster's spell DC.
  if ( (step.type === "resave") && ("ability" in step) && !ABILITIES.includes(step.ability) ) errors.push(`${at}.ability: ${ABILITIES.join(", ")}`);
  if ( (step.type === "resave") && ("onFail" in step) && !RESAVE_ON_FAIL.includes(step.onFail) ) errors.push(`${at}.onFail: ${RESAVE_ON_FAIL.join(", ")}`);
  // §485: `own: "choose"` — the reacting creature replays the save of an effect they bear, chosen by their player (Indomitable).
  // Only `advantage` goes with it: the rest (counter, declared ability, outcome) belongs to the effect, not to the reaction.
  if ( (step.type === "resave") && ("own" in step) ) {
    if ( !RESAVE_OWN.includes(step.own) ) errors.push(`${at}.own: ${RESAVE_OWN.join(", ")}`);
    const extra = Object.keys(step).filter(k => !["type", "own", "advantage"].includes(k));
    if ( extra.length ) errors.push(`${at}.own: no ${extra.join(", ")} with own (advantage only)`);
  }
  if ( (step.type === "attackBonus") && ((typeof step.formula !== "string") || !step.formula.trim()) ) errors.push(`${at}.formula: formula required`);
  // §31: what is added to the roll of the reduction activity (Stone's Endurance: "add your Constitution modifier").
  // §33: a die subtracted from the attack roll (Cutting Words: "subtract the result of the roll") — the attack is judged again.
  if ( ["penalty", "bonus"].includes(step.type) && ((typeof step.formula !== "string") || !step.formula.trim()) ) errors.push(`${at}.formula: formula required`);
  if ( (step.type === "reduce") && ("bonus" in step) && ((typeof step.bonus !== "string") || !step.bonus.trim()) ) errors.push(`${at}.bonus: formula`);
  // §493 (B13): `cancelForSelf` — the damage of the area is not applied to the reacting creature; `ifSourceFails`: only if the
  // author fails the save the reaction imposes on them.
  if ( step.type === "cancelForSelf" ) {
    if ( ("ifSourceFails" in step) && (step.ifSourceFails !== true) ) errors.push(`${at}.ifSourceFails: true or absent`);
    const extra = Object.keys(step).filter(k => !["type", "ifSourceFails"].includes(k));
    if ( extra.length ) errors.push(`${at}: unknown key ${extra.join(", ")} (ifSourceFails only)`);
  }
}

export function validateTrigger(declaration, at, facts, errors) {
  if ( !isObject(declaration) ) return errors.push(`${at}: a declaration is an object`);
  const d = normalize(declaration);
  if ( !d.on.length ) errors.push(`${at}.on: at least one moment`);
  for ( const m of d.on ) if ( !(m in MOMENTS) ) errors.push(`${at}.on: unknown moment "${m}" (${Object.keys(MOMENTS).join(", ")})`);
  if ( (d.via !== null) && !VIA.includes(d.via) ) errors.push(`${at}.via: ${VIA.join(", ")}`);
  // `fromEffect`: the declaration only applies to the item effect with this id (Fire Shield: warm OR cold).
  if ( "fromEffect" in declaration ) {
    if ( !isId(declaration.fromEffect) ) errors.push(`${at}.fromEffect: effect id (16 characters)`);
    if ( d.via !== "effect" ) errors.push(`${at}.fromEffect: requires via: "effect"`);
  }
  // §65: `by: "originSide"` — the effect only reacts to damage from the caster or their allies (Suggestion);
  // §294 `by: "otherActivity"` — not to that of the activity that applied it ("Calcination of the Undead").
  if ( "by" in declaration ) {
    if ( !DAMAGED_BY.includes(declaration.by) ) errors.push(`${at}.by: ${DAMAGED_BY.join(", ")}`);
    if ( (d.via !== "effect") || (d.on.length !== 1) || (d.on[0] !== "isDamaged") ) errors.push(`${at}.by: requires via: "effect" and isDamaged as the only moment`);
  }
  // `oncePerTurn`: a share of bonus damage that only applies once per turn ("Attraction of Death": "once per turn").
  if ( ("oncePerTurn" in declaration) && ((declaration.oncePerTurn !== true) || (d.on.length !== 1) || (d.on[0] !== "preDamageRoll")) ) {
    errors.push(`${at}.oncePerTurn: true, with preDamageRoll as the only moment`);
  }
  // §223 (#12): `ask` — a share of bonus damage the author chooses to add or not before the roll (Dreadful Strikes); `uses`:
  // the activity of the item it spends a use of, and without which it is not offered.
  if ( "ask" in declaration ) {
    const a = declaration.ask;
    // §438: `uses` can list several activities (Handbook 3.0.0: one per level tier) — the first one the sheet shows counts.
    const ids = ("uses" in (isObject(a) ? a : {})) ? [a.uses].flat() : [];
    const ok = (a === true) || (isObject(a) && Object.keys(a).every(k => k === "uses") && (!("uses" in a) || (ids.length > 0 && ids.every(isId))));
    if ( !ok ) errors.push(`${at}.ask: true or { uses?: activity id (16 characters) or a list of them }`);
    if ( (d.on.length !== 1) || (d.on[0] !== "preDamageRoll") ) errors.push(`${at}.ask: preDamageRoll as the only moment`);
  }
  // §129: `free` — a reaction window that does not cost the Reaction (Lucky: a luck point), offered even if it is taken.
  if ( ("free" in declaration) && (declaration.free !== true) ) errors.push(`${at}.free: true or absent`);
  // §334: `defends` — a `preAttackRoll` declaration of the target's item (Displacement).
  if ( ("defends" in declaration) && ((declaration.defends !== true) || !(declaration.on ?? []).includes?.("preAttackRoll") && (declaration.on !== "preAttackRoll")) ) errors.push(`${at}.defends: true, with preAttackRoll`);
  if ( !Array.isArray(d.do) || !d.do.length ) errors.push(`${at}.do: at least one step`);
  else {
    d.do.forEach((s, i) => validateStep(s, `${at}.do[${i}]`, errors));
    // Each step goes with its moments: a push only makes sense on an outcome, a repeated save only on the turn.
    const outcome = d.on.some(m => OUTCOME_MOMENTS.includes(m));
    const resave = d.on.length && d.on.every(m => RESAVE_MOMENTS.includes(m));
    const bearer = d.on.length && d.on.every(m => BEARER_MOMENTS.includes(m));
    for ( const s of d.do ) {
      if ( isObject(s) && OUTCOME_STEPS.includes(s.type) && !outcome ) errors.push(`${at}.do: "${s.type}" requires an outcome moment (${OUTCOME_MOMENTS.join(", ")})`);
      // §485: `own` — a reaction of the item itself (not `via`), at the end of an enemy's turn, with its `use` step.
      if ( isObject(s) && (s.type === "resave") && ("own" in s) ) {
        if ( (d.on.length !== 1) || !RESAVE_OWN_MOMENTS.includes(d.on[0]) || (d.via !== null) || !d.do.some(x => isObject(x) && (x.type === "use")) ) {
          errors.push(`${at}.do: "resave" with own requires ${RESAVE_OWN_MOMENTS.join(", ")} as the only moment, no via, and a "use" reaction`);
        }
        continue;
      }
      if ( isObject(s) && (s.type === "resave") && (!resave || (d.via !== "effect")) ) errors.push(`${at}.do: "resave" requires moments among ${RESAVE_MOMENTS.join(", ")} and via: "effect"`);
      if ( isObject(s) && (s.type === "remove") && (!bearer || (d.via !== "effect")) ) errors.push(`${at}.do: "remove" requires bearer moments (${BEARER_MOMENTS.join(", ")}) and via: "effect"`);
      // §34: the Disadvantage can also come from a reaction before the roll ("Shadow Dodge", "Protective Shard").
      const preAttackReaction = d.on.some(m => PRE_ATTACK_WINDOWS.includes(m)) && d.do.some(x => isObject(x) && (x.type === "use"));
      if ( isObject(s) && ATTACK_STEPS.includes(s.type) && !d.on.includes("preAttackRoll") && !((s.type === "disadvantage") && preAttackReaction) ) errors.push(`${at}.do: "${s.type}" requires the preAttackRoll moment`);
      if ( isObject(s) && (s.type === "consume") && (!d.on.includes("preAttackRoll") || (d.via !== "effect")) ) errors.push(`${at}.do: "consume" requires the preAttackRoll moment and via: "effect"`);
      if ( isObject(s) && (s.type === "ward") && (!d.on.includes("isAttacked") || (d.via !== "effect")) ) errors.push(`${at}.do: "ward" requires the isAttacked moment and via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "source") && !("same" in s) && ((d.on.length !== 1) || (d.on[0] !== "isHit")) ) errors.push(`${at}.do: a riposte (to: "source") requires isHit as the only moment`);
      // §499: the amount taken is only known once the damage is applied — isDamaged, on a borne effect.
      if ( isObject(s) && (s.type === "damage") && (s.to === "source") && ("same" in s) && ((d.on.length !== 1) || (d.on[0] !== "isDamaged") || (d.via !== "effect")) ) errors.push(`${at}.do: a riposte of the same amount (same) requires isDamaged as the only moment and via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "origin") && ((d.on.length !== 1) || (d.on[0] !== "isDamaged") || (d.via !== "effect")) ) errors.push(`${at}.do: a damage share (to: "origin") requires isDamaged as the only moment and via: "effect"`);
      if ( isObject(s) && (s.type === "damage") && (s.to === "bearer") && (!d.on.length || !d.on.every(m => BEARER_DAMAGE_MOMENTS.includes(m)) || (d.via !== "effect")) ) errors.push(`${at}.do: the bearer's damage (to: "bearer") requires moments among ${BEARER_DAMAGE_MOMENTS.join(", ")} and via: "effect"`);
      // §484: the damage of a trait to its bearer (`to: "self"`, Sunlight Sensitivity) — on their turn, borne by the item itself.
      if ( isObject(s) && (s.type === "damage") && (s.to === "self") && (!d.on.length || !d.on.every(m => TURN_MOMENTS.includes(m)) || (d.via !== null)) ) errors.push(`${at}.do: a trait's damage to its bearer (to: "self") requires moments among ${TURN_MOMENTS.join(", ")}, without via`);
      if ( isObject(s) && (s.type === "damage") && ("onSave" in s) && ((d.on.length !== 1) || (d.on[0] !== "failedSave") || ("to" in s)) ) errors.push(`${at}.do: "onSave" requires failedSave as the only moment, without "to"`);
      // §301: `reduce` also at the fall windows (Slow Fall), like `cancel` ("Dead Leaf").
      const fallReaction = d.on.some(m => FALL_WINDOWS.includes(m)) && d.do.some(x => isObject(x) && (x.type === "use"));
      if ( isObject(s) && ["halve", "uncrit", "reduce", "miss", "penalty", "reroll", "resist"].includes(s.type) && !((s.type === "penalty") && preAttackReaction) && !((s.type === "reduce") && fallReaction) && (!d.on.some(m => HIT_WINDOWS.includes(m)) || !d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "${s.type}" requires the isHit or allyIsHit moment and a "use" reaction`);
      // §344: `cancel` also at the `isTargeted` window (Rod of Absorption: the spell that targets the bearer is canceled).
      const targetedReaction = d.on.includes("isTargeted") && d.do.some(x => isObject(x) && (x.type === "use"));
      if ( isObject(s) && (s.type === "cancel") && !fallReaction && !targetedReaction ) errors.push(`${at}.do: "cancel" requires the falls, allyFalls or isTargeted moment and a "use" reaction`);
      // §493 (B13): `cancelForSelf` — at the `inArea` window, with its `use` reaction; `ifSourceFails` wants a reaction
      // that targets the source (the activity whose save, imposed on the author, decides).
      if ( isObject(s) && (s.type === "cancelForSelf") ) {
        const uses = d.do.filter(x => isObject(x) && (x.type === "use"));
        if ( !d.on.includes("inArea") || !uses.length ) errors.push(`${at}.do: "cancelForSelf" requires the inArea moment and a "use" reaction`);
        else if ( (s.ifSourceFails === true) && !uses.some(x => x.target === "source") ) errors.push(`${at}.do: "cancelForSelf" with ifSourceFails requires a "use" reaction with target: "source"`);
      }
      // O8d (§347): `intercept` — the reacting creature becomes the target of the attack (Arrow-Catching Shield), before the roll.
      if ( isObject(s) && (s.type === "intercept") && !(d.on.includes("enemyAttacks") && preAttackReaction) ) errors.push(`${at}.do: "intercept" requires the enemyAttacks moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "absorb") && !(d.on.includes("allyIsDamaged") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "absorb" requires the allyIsDamaged moment and a "use" reaction`);
      // §375: `redirect` — on a miss, the attacker makes the same attack again against a creature the reacting creature grapples.
      if ( isObject(s) && (s.type === "redirect") && !(d.on.includes("isMissed") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "redirect" requires the isMissed moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "interpose") && !(d.on.includes("allyIsDamaged") && d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "interpose" requires the allyIsDamaged moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "bonus") && !(d.on.includes("allyAttacks") && preAttackReaction) ) errors.push(`${at}.do: "bonus" requires the allyAttacks moment and a "use" reaction`);
      if ( isObject(s) && (s.type === "endCondition") && (!d.on.includes("gainsCondition") || !d.do.some(x => isObject(x) && (x.type === "use"))) ) errors.push(`${at}.do: "endCondition" requires the gainsCondition moment and a "use" reaction`);
    }
  }
  for ( const key of unknownFacts(d.if, facts) ) errors.push(`${at}.if: unknown fact "${key}"`);
}

export function validateAura(aura, at, errors) {
  if ( !isObject(aura) ) return errors.push(`${at}: an object`);
  if ( ("radius" in aura) && !(Number.isFinite(aura.radius) && (aura.radius > 0)) ) errors.push(`${at}.radius: positive number`);
  if ( ("units" in aura) && (typeof aura.units !== "string") ) errors.push(`${at}.units: string`);
  if ( ("affects" in aura) && !AURA_AFFECTS.includes(aura.affects) ) errors.push(`${at}.affects: ${AURA_AFFECTS.join(", ")}`);
  if ( ("includeSelf" in aura) && (typeof aura.includeSelf !== "boolean") ) errors.push(`${at}.includeSelf: boolean`);
  if ( ("effect" in aura) && !isId(aura.effect) ) errors.push(`${at}.effect: effect id (16 characters)`);
  if ( ("radiusFormula" in aura) && (typeof aura.radiusFormula !== "string") ) errors.push(`${at}.radiusFormula: string`);
  if ( ("whileActive" in aura) && (aura.whileActive !== true) ) errors.push(`${at}.whileActive: true or absent`);
  if ( "changes" in aura ) {
    const ok = Array.isArray(aura.changes) && aura.changes.length && aura.changes.every(c => isObject(c)
      && (typeof c.key === "string") && c.key && (typeof c.value === "string") && (typeof c.type === "string") && c.type);
    if ( !ok ) errors.push(`${at}.changes: list of { key, value (string), type }`);
  }
  if ( ("types" in aura) && (!Array.isArray(aura.types) || !aura.types.length || !aura.types.every(t => CREATURE_TYPES.includes(t))) ) {
    errors.push(`${at}.types: creature types (${CREATURE_TYPES.join(", ")})`);
  }
  for ( const key of Object.keys(aura) ) {
    if ( !["radius", "units", "affects", "includeSelf", "effect", "radiusFormula", "whileActive", "changes", "types"].includes(key) ) errors.push(`${at}.${key}: unknown key`);
  }
}
