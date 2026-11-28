/**
 * Visual feedback above tokens (SPEC §15.3): what a resolution has just learned, between
 * two of its states — attack verdict (critical, miss), cover, reaction, save. Each fact
 * appears only once: the previous state is compared with the new one. Pure functions, no
 * dependency on Foundry; the display is in ui/feedback.mjs.
 */

/**
 * @typedef {object} Feedback
 * @property {string} token   UUID of the token to write above.
 * @property {"hit"|"critical"|"miss"|"cover"|"reaction"|"saveSuccess"|"saveFail"|"duplicate"|"unaffected"} kind
 *           `hit`: a hit without a critical (§228: shown only if the GM wants it, or by their roll)
 *           `duplicate`: a Mirror Image duplicate took the hit (§16.25); `unaffected`: the action cannot affect it (§16.8)
 * @property {string} [degree]  Cover: "half", "threeQuarters", "total".
 * @property {string} [name]    Reaction: its name.
 * @property {boolean} [auto]   Automatically failed save (condition).
 * @property {number} [roll]    §228: the total of the attack roll (verdict) or save, when known.
 * @property {"advantage"|"disadvantage"} [mode]  §231: the d20 of this roll, rolled with Advantage or Disadvantage.
 */

const blank = { hit: null, critical: false, cover: null, reaction: null, save: null, duplicate: null, unaffected: null };

/**
 * The new facts of a resolution.
 * @param {object|null} before  Previous state (null: nothing known).
 * @param {object} after        New state.
 * @returns {Feedback[]}
 */
export function feedbackBetween(before, after) {
  if ( !after?.targets?.length || (after.step === "undone") ) return [];
  const previous = new Map((before?.targets ?? []).map(t => [t.token, t]));
  const out = [];
  const attackTotal = {
    ...(Number.isFinite(after.attack?.roll?.total) ? { roll: after.attack.roll.total } : {}),
    ...(after.attack?.roll?.mode ? { mode: after.attack.roll.mode } : {})
  };
  for ( const t of after.targets ) {
    const b = previous.get(t.token) ?? blank;
    const judged = (t.hit !== null) && (t.hit !== undefined);
    const newlyJudged = judged && ((b.hit === null) || (b.hit === undefined));
    if ( newlyJudged && t.cover?.degree && (t.cover.degree !== "none") ) out.push({ token: t.token, kind: "cover", degree: t.cover.degree });
    if ( t.reaction && !b.reaction ) out.push({ token: t.token, kind: "reaction", name: t.reaction });
    if ( t.unaffected && !b.unaffected ) out.push({ token: t.token, kind: "unaffected" });
    if ( t.duplicate?.taken && !b.duplicate?.taken ) out.push({ token: t.token, kind: "duplicate" });
    else if ( judged && (newlyJudged || (b.hit !== t.hit) || (b.critical !== t.critical)) ) {
      if ( t.hit === false ) out.push({ token: t.token, kind: "miss", ...attackTotal });
      else if ( t.critical ) out.push({ token: t.token, kind: "critical", ...attackTotal });
      else if ( t.hit === true ) out.push({ token: t.token, kind: "hit", ...attackTotal });
    }
    // §169 : un rejeu sans sauvegarde (`noSave`) n'en annonce aucune.
    if ( t.save && !b.save && (t.save.auto !== "noSave") ) {
      out.push({ token: t.token, kind: t.save.success ? "saveSuccess" : "saveFail", auto: !!t.save.auto,
        ...(Number.isFinite(t.save.total) ? { roll: t.save.total } : {}), ...(t.save.mode ? { mode: t.save.mode } : {}) });
    }
  }
  return out;
}

/**
 * §16.40: the resources a use gives back or spends, to show above the token — only for an activity that
 * **gives back** something (a negative consumption: Wild Resurgence), so as not to write "−1 slot" on each spell.
 * @param {Array<{type: "itemUses"|"spellSlots", value: number, name?: string, level?: number}>} targets
 * @returns {Array<{kind: "gain"|"spend", type: string, n: number, name?: string, level?: number}>}
 */
export function resourceFeedback(targets) {
  const usable = (targets ?? []).filter(t => ["itemUses", "spellSlots"].includes(t.type) && Number.isFinite(t.value) && (t.value !== 0));
  if ( !usable.some(t => t.value < 0) ) return [];
  return usable.map(t => ({ kind: t.value < 0 ? "gain" : "spend", type: t.type, n: Math.abs(t.value),
    ...(t.name ? { name: t.name } : {}), ...(Number.isFinite(t.level) ? { level: t.level } : {}) }));
}
