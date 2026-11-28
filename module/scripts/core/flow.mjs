/**
 * §418: the "Flow" — how the engine goes about it, next to the automation level that says what it does (§417). The pure
 * rules of its settings. Pure: no dependency on Foundry.
 */

/** "Reactions" setting. `level`: according to the automation level — today "ask everyone", as soon as the level judges them. */
export const REACTION_MODES = Object.freeze(["level", "ask", "players", "off"]);

/**
 * Does the engine offer this Reaction? `ask`: to everyone (the player, or the GM for their creatures); `players`: only for a
 * player character — the GM triggers those of their creatures themselves; `off`: never, Reactions are played by hand.
 * @param {string} mode
 * @param {{playerOwned?: boolean}} [who]  Does the actor that would react belong to a player?
 */
export function offersReaction(mode, { playerOwned=false }={}) {
  const m = (!REACTION_MODES.includes(mode) || (mode === "level")) ? "ask" : mode;
  if ( m === "off" ) return false;
  if ( m === "players" ) return playerOwned === true;
  return true;
}

/**
 * "Damage" setting (§419). `level`: according to the automation level — today rolled and applied automatically, as soon as
 * the level resolves actions.
 */
export const DAMAGE_MODES = Object.freeze(["level", "auto", "click", "validate", "clickValidate", "clickPlayers", "clickPlayersValidate"]);

/**
 * The two gestures the setting can ask for around a damage or healing roll: `click` — the author rolls their own dice (a
 * window, a button) instead of the chained roll; `validate` — the GM confirms before the result is applied.
 * §524 (issue #173): `clickPlayers` / `clickPlayersValidate` — on click only when the author is a player; creatures played by the
 * GM stay automatic. Validation, however, applies to everyone.
 * @param {string} mode
 * @param {{playerAuthor?: boolean}} [who]  Is the author of the action a player (not a GM)?
 * @returns {{click: boolean, validate: boolean}}
 */
export function damageSteps(mode, { playerAuthor=false }={}) {
  const m = (!DAMAGE_MODES.includes(mode) || (mode === "level")) ? "auto" : mode;
  const players = (m === "clickPlayers") || (m === "clickPlayersValidate");
  return {
    click: (m === "click") || (m === "clickValidate") || (players && (playerAuthor === true)),
    validate: (m === "validate") || (m === "clickValidate") || (m === "clickPlayersValidate")
  };
}

/**
 * #173 (§556): dnd5e's damage dialog for a roll the engine makes on the author's client. "required" — the setting asks the author to
 * roll (`click`): the dialog shows, whatever the client's "Rolls without dialog"; "offered" — it shows only on a client that turned
 * "Rolls without dialog" off (ui/pointer-offers.mjs).
 * @param {{click: boolean}} steps  `damageSteps(…)`.
 * @returns {"required"|"offered"}
 */
export function damageDialog(steps) {
  return steps?.click ? "required" : "offered";
}

/**
 * #173 (§556): no "Critical Hit" button in that dialog when the engine settled the critical another way — extra critical dice for some
 * targets only (#269, `criticalExtra`), a critical table or a neighbour (§207, `criticalHit`), a hit target that cannot be critically
 * hit (`noCritical`). Pressing it would double the dice twice, or past the rule.
 * @param {{criticalExtra?: object, criticalHit?: string, noCritical?: boolean}} ours  The roll's `config["dnd5e-combat"]`.
 */
export function criticalButtonLocked(ours={}) {
  return !!(ours?.criticalExtra || ours?.criticalHit || ours?.noCritical);
}
