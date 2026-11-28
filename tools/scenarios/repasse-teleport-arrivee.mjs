/**
 * §463 ("movement" sort of the ATLAS): self-teleportation whose area hits the ARRIVAL space, read in the creatures' text
 * (`teleport.area: "arrival"`). Spell arena: the Caster (NPC) receives the Solar's Radiant Teleportation (Monster Manual:
 * Dexterity saving throw, radiant damage in a 10 ft Emanation around it on arrival, activity range 60 ft).
 *  - the use places no area (neither a "Place the template" cell, nor a mouse placement);
 *  - the 4-cell jump done (accepted), the Emanation is placed around the arrived Caster: the Target, 1 cell from the arrival,
 *    takes damage; the Neighbouring Target, at 4 cells, and the Caster, nothing.
 * The interactive teleport aiming is turned off for the duration of the scenario (`teleportPlanning` setting): the jump
 * goes through `teleportTo` then `afterTeleport`, the same path as the player's click.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MODULE_ID = "dnd5e-combat";
const RADIANT = "Compendium.dnd-monster-manual.actors.Actor.mmSolar000000000.Item.mmRadiantTelepor";

export default {
  name: "repasse-teleport-arrivee — téléportation avec zone à l'arrivée : Téléportation radieuse (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible", "Cible voisine"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, near, far] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, near, far] ) homes.set(t.id, await ctx.position(t));
    const casterHp = await ctx.hp(caster);
    const planning = await ctx.call("get-setting", { namespace: MODULE_ID, key: "teleportPlanning" }).then(r => r?.value ?? r).catch(() => true);
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "teleportPlanning", value: false });
    const lent = [];
    ctx.restore(async () => {
      await ctx.call("set-setting", { namespace: MODULE_ID, key: "teleportPlanning", value: planning !== false }).catch(() => {});
      for ( const t of [caster, near, far] ) { const h = homes.get(t.id); await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {}); }
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await ctx.setHp(caster, casterHp).catch(() => {});
      for ( const t of [near, far] ) await ctx.setHp(t, 999).catch(() => {});
    });

    const { data } = await ctx.call("get-compendium-entry", { uuid: RADIANT });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = RADIANT;
    const item = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: RADIANT } })).id;
    lent.push(item);

    // Start two rows below the Target; arrival 4 cells lower. The Target 1 cell from the arrival, the Neighbouring Target at
    // 4 cells.
    const start = { x: homes.get(caster.id).x, y: homes.get(caster.id).y + 2 * grid };
    const go = { x: start.x, y: start.y + 4 * grid };
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: near.id, x: go.x + grid, y: go.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: far.id, x: go.x + 4 * grid, y: go.y, elevation: 0 });
    for ( const t of [near, far] ) await ctx.setHp(t, 999);
    await pause(1000);

    const used = await ctx.engine("use", { tokenId: caster.id, itemId: item, activityType: "save" });
    ctx.expect(!used.dialog?.templateBox, "pas de case « Placer le gabarit »");
    ctx.expect(!(used.regions ?? []).length, "aucune zone posée avant le saut");

    const r = await ctx.engine("teleport", { tokenId: caster.id, itemId: item, ...go }).catch(err => ({ error: err.message }));
    await pause(1500);
    const at = await ctx.position(caster);
    ctx.expect(!r?.error, `la Téléportation radieuse est reconnue comme téléportation de soi${r?.error ? ` (${r.error})` : ""}`);
    ctx.expect(r?.accepted && (at.x === go.x) && (at.y === go.y), "4 cases (20 ft, portée 60 ft) : téléporté");
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(3000);
    const nearHp = await ctx.hp(near);
    ctx.expect(nearHp < 999, `la Cible, à 1 case de l'arrivée, subit des dégâts radiants (${999 - nearHp})`);
    ctx.expect(await ctx.hp(far) === 999, "la Cible voisine, à 4 cases de l'arrivée, n'est pas touchée");
    ctx.expect(await ctx.hp(caster) === casterHp, "le Lanceur ne subit pas sa propre zone");
  }
};
