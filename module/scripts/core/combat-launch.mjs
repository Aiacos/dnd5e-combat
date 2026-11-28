/**
 * §397: "Start a combat" (GM) — the rule alone: who the window offers, in which list and checked or not, which Initiatives
 * share a roll, and when the first round can begin.
 *
 * Decisions of the user (2026-11-07):
 *  - "Players": what the connected players control and that has an Initiative (characters, familiars, summons), checked;
 *  - "Seen by the players": the other creatures that a players' token sees, checked;
 *  - "Rest of the map": the others, unchecked — except creatures at 0 HP, actors that are not creatures, marked traps,
 *    tokens of another level of the scene;
 *  - a summon "right after its master" has no roll of its own; a summon without Initiative (Unseen Servant) is not
 *    offered;
 *  - checkbox "one Initiative per creature type": the NPCs of the same actor share a roll.
 *
 * Pure: no dependency on Foundry.
 */

/**
 * @typedef {object} LaunchEntry
 * @property {string} id                Token id.
 * @property {string} actorKey          The actor (the base one for an unlinked token): used for grouping.
 * @property {boolean} player           Owned by a player.
 * @property {boolean} online           One of its players is connected.
 * @property {boolean} creature         A creature (character or NPC), not a group, a vehicle, a trap.
 * @property {boolean} alive            More than 0 HP, not dead.
 * @property {boolean} sameLevel        On the displayed level of the scene.
 * @property {boolean} notCombatant     Marked "not in combat" (`flags.dnd5e-combat.notCombatant`).
 * @property {"own"|"after"|"none"|null} summon  The Initiative rule of a summon, null otherwise.
 * @property {boolean} seen             A players' token sees it.
 */

/**
 * Sorts the tokens of a scene into the three lists of the window.
 * @param {LaunchEntry[]} entries
 * @returns {{players: LaunchEntry[], seen: LaunchEntry[], rest: LaunchEntry[]}}  Each entry gets `checked`.
 */
export function classify(entries) {
  const players = [];
  const seen = [];
  const rest = [];
  for ( const e of entries ?? [] ) {
    if ( !e.creature || e.notCombatant || (e.summon === "none") ) continue;
    if ( e.player && e.online ) { players.push({ ...e, checked: e.alive }); continue; }
    if ( !e.alive ) continue;
    if ( e.seen ) { seen.push({ ...e, checked: true }); continue; }
    if ( !e.sameLevel ) continue;
    rest.push({ ...e, checked: false });
  }
  return { players, seen, rest };
}

/**
 * The NPCs that roll for themselves: one roll per combatant, or per actor when `grouped`. Summons "after" their master do not
 * roll. Returns `[{ roll, copies }]`: `roll` rolls, `copies` receive the same result.
 * @param {Array<{id: string, actorKey: string, summon?: string|null}>} npcs
 * @param {boolean} grouped
 */
export function initiativeGroups(npcs, grouped) {
  const own = (npcs ?? []).filter(n => n.summon !== "after");
  if ( !grouped ) return own.map(n => ({ roll: n.id, copies: [] }));
  const byActor = new Map();
  for ( const n of own ) {
    const group = byActor.get(n.actorKey);
    if ( group ) group.copies.push(n.id);
    else byActor.set(n.actorKey, { roll: n.id, copies: [] });
  }
  return [...byActor.values()];
}

/** Do all the combatants have an Initiative? (the first round can begin) */
export function allRolled(initiatives) {
  const list = initiatives ?? [];
  return list.length > 0 && list.every(n => Number.isFinite(n));
}
