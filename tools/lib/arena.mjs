/**
 * §393: the shared setup of the test arenas (a flat, empty, lit scene; test actors in a folder of their own; their
 * tokens on fixed cells), taken from `tools/arene-sorts.mjs` to also serve `tools/arene-invocations.mjs`. Idempotent: an actor
 * is found by its name in its folder, the scene by its name; nothing outside the folder is touched.
 *
 *   spec: { stage (tools/lib/stages.mjs), folder, flag (flags.dnd5e-combat.arena), actors: { name: { pack, base, keepItems,
 *            disposition, system, statuses } } }
 * `statuses`: the conditions set on the token after placement ("dead": a corpse that darsh-loot recognizes).
 * `owners`: names of users who own the actor (issue #42: `claude player`, to see the scene through their eyes).
 * `scene` (next to `actors`): data added to the scene.
 * `token`: data of the placed token and of the prototype (issue #42: `{ sight: { enabled: true } }`, so a commoner has a view).
 * `items`: uuids (or { uuid, system }) of compendium items added to the sheet (issue #42: the Player's Handbook's Devil's
 * Sight), kept at reset.
 */
import { connect } from "./connector.mjs";

const MM = "Compendium.dnd-monster-manual.actors.";

const mergeCopy = (a, b) => merge(structuredClone(a), b);
const merge = (a, b) => {
  for ( const [k, v] of Object.entries(b) ) {
    if ( v && (typeof v === "object") && !Array.isArray(v) ) a[k] = merge(a[k] && (typeof a[k] === "object") ? a[k] : {}, v);
    else a[k] = v;
  }
  return a;
};

export async function buildArena({ stage, folder: FOLDER, flag, actors: ACTORS, scene: sceneExtra={} }) {
const mcp = await connect();
try {
  const folder = await mcp.call("create-folder", { name: FOLDER, type: "Actor" });
  const folderId = folder.id ?? folder.folderId ?? folder.folder?.id;
  const listed = await mcp.call("list-actors", {});
  const existing = (Array.isArray(listed) ? listed : Object.values(listed).find(Array.isArray)) ?? [];
  const ids = {};
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    const { data } = await mcp.call("get-compendium-entry", { uuid: (spec.pack ?? MM) + spec.base });
    const { _id, folder: f, ownership, _stats, items, effects, ...rest } = data;
    const actorData = merge(rest, { name, system: spec.system, prototypeToken: { name, actorLink: true, disposition: spec.disposition,
      displayName: 30, appendNumber: false, prependAdjective: false, ...(spec.token ?? {}) } });
    // The item ids kept: a character's `details.race` designates its species by id — without it, no more Speed (prepareRace).
    const extra = [];
    for ( const entry of spec.items ?? [] ) {
      // A uuid, or { uuid, system }: the system partly replaced (an at-will spell).
      const { uuid, system: patch } = (typeof entry === "string") ? { uuid: entry } : entry;
      const { data: item } = await mcp.call("get-compendium-entry", { uuid });
      const { _id: _i, folder: _f, ownership: _o, ...itemData } = item;
      if ( patch ) merge(itemData.system, patch);
      extra.push({ ...itemData, _stats: { ...(itemData._stats ?? {}), compendiumSource: uuid } });
    }
    const baseItems = [...(spec.keepItems ? (items ?? []) : []), ...extra];
    actorData.items = baseItems;
    actorData.effects = [];
    const found = existing.find(a => (a.name === name) && (a.folderId === folderId));
    if ( found ) {
      // Reset to the reference state: HP, slots, no item or effect left by an interrupted sweep.
      const actor = await mcp.call("get-actor", { actorId: found.id });
      // An actor that keeps its items only loses those that a sweep or a scenario lent (absent from its base).
      const own = new Set(baseItems.map(i => `${i.type}|${i.name}`));
      for ( const i of actor.items ?? [] ) {
        if ( own.has(`${i.type}|${i.name}`) ) continue;
        await mcp.call("remove-embedded-item", { documentType: "Actor", id: found.id, itemId: i._id ?? i.id });
      }
      for ( const e of actor.effects ?? [] ) await mcp.call("remove-embedded-effect", { documentType: "Actor", id: found.id, effectId: e._id ?? e.id });
      // A character's species, designated by id (`details.race`): realigned on the sheet's species item.
      const race = spec.keepItems ? (actor.items ?? []).find(i => i.type === "race") : null;
      const system = race ? mergeCopy(spec.system, { details: { race: race._id ?? race.id } }) : spec.system;
      await mcp.call("update-actor", { actorId: found.id, actorData: { system, prototypeToken: actorData.prototypeToken } });
      // An added item (`items`) that a trial would have removed comes back.
      const present = new Set((actor.items ?? []).map(i => `${i.type}|${i.name}`));
      for ( const item of extra ) {
        if ( !present.has(`${item.type}|${item.name}`) ) await mcp.call("upsert-embedded-item", { documentType: "Actor", id: found.id, itemData: item });
      }
      ids[name] = found.id;
      console.log(`acteur « ${name} » remis en état (${found.id})`);
    }
    else {
      const r = await mcp.call("create-actor", { actorData, folderId });
      ids[name] = r.id ?? r.actorId ?? r.actor?.id;
      console.log(`acteur « ${name} » créé (${ids[name]})`);
    }
  }

  // The owners (`owners`): the connector ignores `ownership` — the engine's test function handles it ("Test tools").
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    if ( !spec.owners?.length ) continue;
    await mcp.call("call-module-api", { moduleId: "dnd5e-combat", fn: "setOwners", args: { actorId: ids[name], users: spec.owners } })
      .catch(err => console.log(`propriétaires de « ${name} » : ${err.message}`));
  }

  const scenes = await mcp.call("list-scenes", {});
  let scene = (Array.isArray(scenes) ? scenes : Object.values(scenes).find(Array.isArray)).find(s => s.name === stage.name);
  const { cols, rows, grid } = stage;
  const sceneData = {
    backgroundColor: "#5a5a5a", tokenVision: true, fog: { exploration: false },
    environment: { darknessLevel: 0, darknessLock: true, globalLight: { enabled: true, bright: true } },
    flags: { "dnd5e-combat": { arena: flag } }
  };
  // Issue #42: what an arena adds to the scene (the darkness range of the global light, so that a dark region is dark).
  merge(sceneData, sceneExtra);
  if ( !scene ) {
    const r = await mcp.call("create-scene", { name: stage.name, kind: "battlemap", width: cols * grid, height: rows * grid, gridSize: grid, padding: 0.1, sceneData });
    scene = { id: r.id ?? r.sceneId ?? r.scene?.id };
    console.log(`scène « ${stage.name} » créée (${scene.id})`);
  }
  else await mcp.call("update-scene", { sceneId: scene.id, sceneData });
  // A single level, with no ceiling (the level created by default is capped at 20 ft: §83).
  const levels = await mcp.call("list-levels", { sceneId: scene.id }).catch(() => null);
  const level = (levels?.levels ?? levels ?? [])[0];
  if ( level?.id ) await mcp.call("update-level", { sceneId: scene.id, levelId: level.id, name: "Sol", bottom: 0, top: null }).catch(err => console.log(`niveau : ${err.message}`));

  const objects = await mcp.call("list-scene-objects", { sceneId: scene.id, type: "Token" });
  const tokens = objects.objects?.Token ?? [];
  for ( const [name, [cx, cy]] of Object.entries(stage.tokens) ) {
    const x = cx * grid, y = cy * grid;
    const found = tokens.find(t => t.name === name);
    const extra = ACTORS[name]?.token ?? {};
    if ( found ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: found.id, data: { x, y, elevation: 0, ...(level?.id ? { level: level.id } : {}), ...extra } });
    else {
      const r = await mcp.call("place-token", { sceneId: scene.id, actorId: ids[name], x, y });
      const tokenId = r.id ?? r.tokenId ?? r.token?.id;
      if ( tokenId && (level?.id || Object.keys(extra).length) ) await mcp.call("update-scene-object", { sceneId: scene.id, type: "Token", objectId: tokenId, data: { x, y, ...(level?.id ? { level: level.id } : {}), ...extra } });
      console.log(`token « ${name} » posé`);
    }
  }
  // The reference conditions (a corpse: "dead"), set on the linked actor — idempotent.
  for ( const [name, spec] of Object.entries(ACTORS) ) {
    for ( const statusId of spec.statuses ?? [] ) {
      await mcp.call("set-status", { actorId: ids[name], statusId, active: true }).catch(err => console.log(`état ${statusId} de « ${name} » : ${err.message}`));
    }
  }
  console.log(`arène prête : ${stage.name} (${scene.id})`);
  return { sceneId: scene.id, actorIds: ids };
}
finally { await mcp.close?.(); }
}
