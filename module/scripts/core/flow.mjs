/**
 * §418 : le « Déroulement » — comment le moteur s'y prend, à côté du niveau d'automatisation qui dit ce qu'il fait (§417). Les règles
 * pures de ses réglages. Pur : aucune dépendance à Foundry.
 */

/** Réglage « Réactions ». `level` : selon le niveau d'automatisation — aujourd'hui « demander à chacun », dès que le niveau les juge. */
export const REACTION_MODES = Object.freeze(["level", "ask", "players", "off"]);

/**
 * Le moteur propose-t-il cette réaction ? `ask` : à chacun (le joueur, ou le MJ pour ses créatures) ; `players` : seulement pour un
 * personnage de joueur — le MJ déclenche lui-même celles de ses créatures ; `off` : jamais, les réactions se jouent à la main.
 * @param {string} mode
 * @param {{playerOwned?: boolean}} [who]  L'acteur qui réagirait appartient-il à un joueur ?
 */
export function offersReaction(mode, { playerOwned=false }={}) {
  const m = (!REACTION_MODES.includes(mode) || (mode === "level")) ? "ask" : mode;
  if ( m === "off" ) return false;
  if ( m === "players" ) return playerOwned === true;
  return true;
}

/**
 * Réglage « Dégâts » (§419). `level` : selon le niveau d'automatisation — aujourd'hui lancés et appliqués d'office, dès que le niveau
 * résout les actions.
 */
export const DAMAGE_MODES = Object.freeze(["level", "auto", "click", "validate", "clickValidate", "clickPlayers", "clickPlayersValidate"]);

/**
 * Les deux gestes que le réglage peut demander autour d'un jet de dégâts ou de soins : `click` — l'auteur lance lui-même ses dés (une
 * fenêtre, un bouton) au lieu du jet enchaîné ; `validate` — le MJ confirme avant que le résultat ne soit appliqué.
 * §524 (issue #173) : `clickPlayers` / `clickPlayersValidate` — au clic seulement quand l'auteur est un joueur ; les créatures que joue le
 * MJ restent automatiques. La validation, elle, vaut pour tous.
 * @param {string} mode
 * @param {{playerAuthor?: boolean}} [who]  L'auteur de l'action est-il un joueur (pas un MJ) ?
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
