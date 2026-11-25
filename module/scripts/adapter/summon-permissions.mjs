/**
 * §542 (issue #43): the facts behind core/summon-permissions.mjs, read from Foundry and dnd5e.
 *  - `User#can` (Foundry 14 common/documents/user.mjs:137) works for any user, not only this client's: it reads the role table.
 *  - "Allow Summoning" is the world setting `dnd5e.allowSummoning` (dnd5e 6.1.1 dnd5e.mjs:58849, default false).
 *  - dnd5e imports a compendium creature on its first summon unless an owned world copy marked `isAutoImported` / `summonedCopy`
 *    and sourced from that uuid exists (`Actor5e.fetchExisting`, dnd5e.mjs:43861-43886) — `needsImport` mirrors that search.
 */

/** The dnd5e setting, false when it cannot be read. */
export function allowSummoning() {
  try { return game.settings.get("dnd5e", "allowSummoning") === true; } catch { return false; }
}

/** The rights of one user that matter to a summon. */
export function summonRightsOf(user) {
  return {
    name: user?.name ?? "",
    isGM: user?.isGM === true,
    tokenCreate: user?.can?.("TOKEN_CREATE") === true,
    actorCreate: user?.can?.("ACTOR_CREATE") === true
  };
}

/** The facts of the world: the setting and the rights of every non-GM user. */
export function summonFacts() {
  const players = (game.users?.contents ?? [...(game.users ?? [])]).filter(u => !u.isGM).map(summonRightsOf);
  return { allowSummoning: allowSummoning(), players };
}

/** True when summoning this profile would make dnd5e import a compendium creature (no reusable world copy yet). */
export function needsImport(activity, profileId=null) {
  if ( activity?.summon?.mode === "cr" ) return false;   // the creature is picked later (`queryActor`): unknown here
  const profile = activity?.profiles?.find(p => p._id === profileId) ?? activity?.availableProfiles?.[0] ?? null;
  const uuid = profile?.uuid;
  if ( !uuid || !String(uuid).startsWith("Compendium.") ) return false;
  return !game.actors?.some(a => (a.getFlag?.("dnd5e", "isAutoImported") || a.getFlag?.("dnd5e", "summonedCopy")) && a.isOwner
    && ((a._stats?.compendiumSource === uuid) || (a._stats?.duplicateSource === uuid)));
}
