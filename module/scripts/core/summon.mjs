/**
 * §197: who owns a summoned creature. dnd5e creates the summoned actor in the name of the user who summons
 * (documents/activity/summon.mjs → `Actor5e.fetchExisting`): a GM who casts the spell from a player's sheet keeps sole
 * ownership, and the player can neither move nor use their mount (table feedback, issue #9). The owners (players) of the
 * caster also become owners of the creature.
 *
 * Pure: no dependency on Foundry.
 */

/** Foundry's "Owner" level (`CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER`). */
export const OWNER = 3;

/**
 * The ownership to give the summoned actor, or null if there is nothing to change: its own, plus "Owner" for each player
 * who owns the caster (not the default level, not a GM).
 * @param {Record<string, number>} casterOwnership   The caster's ownership.
 * @param {Record<string, number>} current           That of the summoned actor.
 * @param {(userId: string) => boolean} isGM
 * @returns {Record<string, number>|null}
 */
export function summonOwnership(casterOwnership, current, isGM) {
  const players = Object.entries(casterOwnership ?? {})
    .filter(([id, level]) => (id !== "default") && (level >= OWNER) && !isGM(id))
    .map(([id]) => id);
  const missing = players.filter(id => (current?.[id] ?? 0) < OWNER);
  if ( !missing.length ) return null;
  return { ...(current ?? {}), ...Object.fromEntries(missing.map(id => [id, OWNER])) };
}

/**
 * §383 (issue #38): what a "summon" activity lets you choose — several profiles (Summon Celestial: Avenger / Defender),
 * several sizes (illusions) or several creature types (Find Familiar: celestial, fey, fiend). dnd5e only asks for it
 * in its usage window (applications/activity/summon-usage-dialog.mjs); a call that skips it (`configure: false`: action
 * bar, gamepad) keeps the first of each, asking nothing.
 * @param {{ profiles?: number, sizes?: number, types?: number }} counts
 * @returns {{ profile: boolean, size: boolean, type: boolean, any: boolean }}
 */
export function summonChoices({ profiles=0, sizes=0, types=0 }={}) {
  const profile = profiles > 1;
  const size = (profiles > 0) && (sizes > 1);
  const type = (profiles > 0) && (types > 1);
  return { profile, size, type, any: profile || size || type };
}

/**
 * §383: should the engine's "Choose the form" window be opened for this cast? Only if dnd5e does not show it (`configure`
 * false), there is a choice, something will be summoned (placement planned, summoning forced by the content, or resumption on
 * targets), and the caller has neither already chosen (`chosen`) nor confirmed outright (`confirmed`: engine retries, connector,
 * scenarios).
 */
export function asksSummonForm({ configure, choices, willSummon, chosen=false, confirmed=false, otherChoice=false, always=false }) {
  if ( chosen || confirmed || otherChoice ) return false;
  // §385: "up to N" creatures (content `chooseCount`) — the engine's window, even from the sheet: dnd5e does not ask how many.
  if ( always ) return !!willSummon;
  if ( configure !== false ) return false;
  return !!choices?.any && !!willSummon;
}

/**
 * §385: the summoning profiles allowed at a casting level (`level.min` / `level.max` of the profile, like `availableProfiles` of
 * dnd5e, documents/activity/summon.mjs, but for a level other than the item's).
 * @param {{_id: string, level?: {min?: number|null, max?: number|null}}[]} profiles
 * @param {number} level
 */
export function profilesAtLevel(profiles, level) {
  return (profiles ?? []).filter(p => {
    const min = p?.level?.min ?? null;
    const max = p?.level?.max ?? null;
    return ((min === null) || (level >= min)) && ((max === null) || (level <= max));
  });
}

/** §385: the numbers offered, from 1 to `max` (nothing to choose below 2). */
export function countChoices(max) {
  const n = Math.floor(Number(max) || 0);
  return (n >= 2) ? Array.from({ length: n }, (_, i) => i + 1) : [];
}

/**
 * §386 (issue #38, user request): the identifier of a creature in the 2024 Monster Manual compendium
 * (`dnd-monster-manual.actors`), from its English name — "mm" + the name in one word, padded with zeros to 16 characters
 * ("Ghoul" → `mmGhoul000000000`, "Ogre Zombie" → `mmOgreZombie0000`, "Ghast Gravecaller" → `mmGhastGravecall`).
 * @param {string} name
 * @returns {string|null}
 */
export function mmActorId(name) {
  const words = String(name ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if ( !words.length ) return null;
  const core = words.map(w => w[0].toUpperCase() + w.slice(1)).join("");
  return `mm${core}`.padEnd(16, "0").slice(0, 16);
}

/** §386: the actor id from a uuid of dnd5e's 2014 SRD monster compendium (`dnd5e.monsters`), or null. */
export function srdMonsterId(uuid) {
  const m = /^Compendium\.dnd5e\.monsters\.(?:Actor\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
  return m ? m[1] : null;
}

/**
 * §391 (issue #38, continued): should the engine's window be opened to choose an **enchantment** profile (Elemental Weapon:
 * the element; Magic Weapon, +1/+2/+3 weapons: the bonus) or a **transformation** profile (True Polymorph)? Like
 * `asksSummonForm`: only when dnd5e's window is skipped (`configure` false: bar; retry "Cast anyway"), several profiles,
 * neither already chosen, nor confirmed outright, nor an engine path that chooses by itself (`own`: Wild Shape).
 */
export function asksProfile({ configure, profiles=0, chosen=false, confirmed=false, own=false }) {
  if ( (configure !== false) || chosen || confirmed || own ) return false;
  return profiles > 1;
}

/** §392: the actor id (16 characters) at the end of a compendium uuid (`Compendium.p.k.Actor.<id>` or `Compendium.p.k.<id>`), or null. */
export function actorIdOf(uuid) {
  const m = /^Compendium\.[^.]+\.[^.]+\.(?:Actor\.)?([A-Za-z0-9]{16})$/.exec(String(uuid ?? ""));
  return m ? m[1] : null;
}
