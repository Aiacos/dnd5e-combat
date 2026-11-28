/**
 * §72: the contest (content key `contest`: `{ activity?, skill, against, effect, exclusive? }`) — Insightful Fighting:
 * "a Wisdom (Insight) check against a creature it can see, contested by the target's Charisma (Deception) check; on a
 * success…". At `dnd5e.postUseActivity`, on the author's client: their roll, then the target's (on their player's if
 * connected, otherwise here), the outcome announced in chat; on a win, the activity's `effect` is placed on the target
 * (`exclusive`: those placed elsewhere by the same item drop). What the effect gives (Advantage, Disadvantage) is declared
 * separately (`triggers`, `preAttackRoll`).
 */

import { MODULE_ID } from "../constants.mjs";
import { contestOf, rollContestSkill, playerOwnerOf, applyContestWin, announceContest } from "../adapter/contest.mjs";
import { contestOutcome } from "../core/contest.mjs";
import { route } from "./router.mjs";
import { log, loc } from "./shared.mjs";

export const CONTEST_QUERY = `${MODULE_ID}.contest`;
const CONTEST_TIMEOUT = 30000;

/** The target's roll: on their player's client if connected (request), otherwise on this client. */
async function targetRoll(actor, skills) {
  const player = playerOwnerOf(actor);
  if ( player && (player !== game.user) ) {
    const answer = await player.query(CONTEST_QUERY, { actor: actor.uuid, skills }, { timeout: CONTEST_TIMEOUT }).catch(() => null);
    if ( answer ) return answer;
  }
  return rollContestSkill(actor, skills);
}

async function onPostUse(activity, usageConfig, results) {
  const rule = contestOf(activity);
  if ( !rule || !results?.message ) return;
  const actor = activity.actor;
  const target = (results.message.system?.targets ?? []).map(t => fromUuidSync(t.token ?? "", { strict: false })).find(Boolean)
    ?? [...game.user.targets][0]?.document ?? null;
  if ( !actor || !target?.actor ) return ui.notifications.info(loc("Opposition.SansCible", { item: activity.item.name }));
  const mine = await rollContestSkill(actor, [rule.skill]);
  const theirs = await targetRoll(target.actor, rule.against);
  if ( !mine || !theirs ) return;
  const outcome = contestOutcome(mine.total, theirs.total);
  log(`${activity.item.name}: ${actor.name} ${mine.skill} ${mine.total} vs ${target.name} ${theirs.skill} ${theirs.total} → ${outcome}`);
  await announceContest({ actor, target, mine, theirs, outcome, item: activity.item });
  if ( outcome !== "win" ) return;
  const n = await applyContestWin(results.message, activity, target, rule);
  if ( n ) log(`${activity.item.name}: effect applied to ${target.name}`);
}

export function registerContest() {
  CONFIG.queries[CONTEST_QUERY] = async ({ actor: uuid, skills }) => rollContestSkill(await fromUuid(uuid), skills);
  route("dnd5e.postUseActivity", onPostUse, { label: "contest not played" });
}
