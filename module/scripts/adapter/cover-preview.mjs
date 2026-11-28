/**
 * #33: the cover preview before an attack — what the pip at the cursor shows (ui/hitchance.mjs) and what `api.ui.cover` publishes.
 * The calculation is the verdict's (`coverFor`, `coverAgainst`); three differences, all of display:
 *  - "Clear" is a result (degree "none"), not a silence;
 *  - a cover condition placed by hand (`coverHalf`…) is rendered as such, source "manual" (the verdict already has it in the AC);
 *  - ignored cover (Sharpshooter…) is rendered with what ignores it.
 * On the player side, only the creatures this client sees count (`seenOnly`): the preview does not give away an invisible
 * or hidden creature. It may then differ from the verdict, which remains the truth (computed by the active GM).
 * The GM sees everything.
 */

import { COVER } from "../core/cover.mjs";
import { coverFor, manualCoverOf, canJudgeCover } from "./cover.mjs";
import { coverIgnoredBy } from "./conditions.mjs";

/**
 * @typedef {object} CoverPreview
 * @property {"none"|"half"|"threeQuarters"|"total"} degree
 * @property {number|null} bonus        AC bonus; null: Total Cover (untouchable).
 * @property {string[]} sources         "wall", "surface", "creature", "zone", "grapple", "manual".
 * @property {string|null} zone         The name of the spell that gives the cover, when the source is "zone".
 * @property {boolean} manual           The cover comes from a condition placed by hand.
 * @property {{degree: string, by: string}|null} ignored  A cover that this attack ignores, and what ignores it.
 */

/**
 * The cover of `target` against an attack by `attacker` with `activity`, as this client can show it; null outside an attack or
 * when the canvas cannot judge it (other scene, redraw).
 * @param {TokenDocument} attacker
 * @param {TokenDocument} target
 * @param {Activity} activity
 * @param {object} [options]
 * @param {object} [options.posA]        The attacker's position at the end of its approach.
 * @param {string} [options.attackMode]
 * @returns {CoverPreview|null}
 */
export function coverPreviewOf(attacker, target, activity, { posA, attackMode=null }={}) {
  if ( (activity?.type !== "attack") || !attacker?.parent || (attacker.parent !== target?.parent) ) return null;
  if ( !canJudgeCover(attacker.parent) ) return null;
  const base = { degree: "none", bonus: 0, sources: [], zone: null, manual: false, ignored: null };
  const manual = manualCoverOf(target);
  if ( manual ) return { ...base, degree: manual, bonus: COVER[manual].bonus, sources: ["manual"], manual: true };
  const cover = coverFor(attacker, target, { posA, quiet: true, activity, attackMode, seenOnly: !game.user?.isGM });
  if ( !cover ) return base;
  const by = (cover.degree !== "total") ? coverIgnoredBy(attacker, target, activity, attackMode, cover.degree) : null;
  if ( by ) return { ...base, ignored: { degree: cover.degree, by } };
  return { ...base, degree: cover.degree, bonus: cover.bonus, sources: cover.sources, zone: cover.zone };
}
