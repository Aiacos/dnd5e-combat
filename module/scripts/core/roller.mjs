/**
 * Who makes a roll imposed on an actor (saving throw, Concentration): its player if connected,
 * otherwise the engine. Pure function (SPEC, principle 2: everyone rolls their own dice).
 */

/**
 * @param {Array<{id: string, active: boolean, isGM: boolean, owner: boolean}>} users
 * @returns {string|null}  Id of the player who rolls, or null if it is up to the engine (active GM's client).
 */
export function chooseRoller(users) {
  const players = users.filter(u => u.active && !u.isGM && u.owner).map(u => u.id).sort();
  return players[0] ?? null;
}
