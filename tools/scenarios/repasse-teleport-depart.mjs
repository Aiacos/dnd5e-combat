/**
 * §462 (tri « déplacement » de l'ATLAS) : téléportation de soi dont la zone frappe l'espace QUITTÉ, lue dans le texte des créatures
 * (`teleport.area: "left"`). Arène des sorts : le Lanceur (PNJ) reçoit la Téléportation mortelle de la Liche (Monster Manual : dégâts
 * nécrotiques à 3 m de l'espace quitté, portée de l'activité 60 ft). La Cible est à 1 case (dans la zone), la Cible voisine à 4 cases
 * (dehors).
 *  - l'utilisation pose d'office une émanation fixe (non rattachée) autour du Lanceur, sans pose à la souris ;
 *  - la Cible subit des dégâts, ni la Cible voisine ni le Lanceur ;
 *  - le Lanceur se téléporte ensuite à 4 cases (accepté), la zone reste où il était ; 14 cases (70 ft) refusées.
 * La visée interactive de la téléportation est coupée le temps du scénario (réglage `teleportPlanning`) : le saut passe par `teleportTo`,
 * le même chemin que le clic du joueur.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MODULE_ID = "dnd5e-combat";
const DEATHLY = "Compendium.dnd-monster-manual.actors.Actor.mmLich0000000000.Item.43ZbhFhGR7uIY1j6";

export default {
  name: "repasse-teleport-depart — téléportation avec zone sur l'espace quitté : Téléportation mortelle (Arène des sorts)",
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
    const regions = [];
    ctx.restore(async () => {
      await ctx.call("set-setting", { namespace: MODULE_ID, key: "teleportPlanning", value: planning !== false }).catch(() => {});
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of [caster, near, far] ) { const h = homes.get(t.id); await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {}); }
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
      await ctx.setHp(caster, casterHp).catch(() => {});
      for ( const t of [near, far] ) await ctx.setHp(t, 999).catch(() => {});
    });

    const { data } = await ctx.call("get-compendium-entry", { uuid: DEATHLY });
    const { _id, folder, ownership, _stats, ...itemData } = data;
    ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = DEATHLY;
    const item = (await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: DEATHLY } })).id;
    lent.push(item);

    // Deux rangées sous la Cible : le Lanceur, la Cible à 1 case, la Cible voisine à 4 cases.
    const start = { x: homes.get(caster.id).x, y: homes.get(caster.id).y + 2 * grid };
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: near.id, x: start.x + grid, y: start.y, elevation: 0 });
    await ctx.call("move-token", { tokenId: far.id, x: start.x + 4 * grid, y: start.y, elevation: 0 });
    for ( const t of [near, far] ) await ctx.setHp(t, 999);
    await pause(1000);

    const used = await ctx.engine("use", { tokenId: caster.id, itemId: item, activityType: "damage" });
    regions.push(...(used.regions ?? []).map(r => r.id));
    ctx.expect(!used.dialog?.templateBox, "pas de case « Placer le gabarit » : la zone se pose d'office");
    const region = used.regions?.[0] ?? null;
    ctx.expect(region?.shapes?.[0] === "emanation", `une émanation est posée autour du Lanceur (${region?.shapes?.join(", ") ?? "aucune zone"})`);
    ctx.expect(region && !region.attachedTo, "la zone n'est pas rattachée au Lanceur (elle reste sur l'espace quitté)");
    if ( used.messageId ) await ctx.settle(used.messageId, { timeoutMs: 45000 }).catch(() => null);
    await pause(2500);
    const nearHp = await ctx.hp(near);
    ctx.expect(nearHp < 999, `la Cible, à 1 case, subit des dégâts (${999 - nearHp})`);
    ctx.expect(await ctx.hp(far) === 999, "la Cible voisine, à 4 cases, n'est pas touchée");
    ctx.expect(await ctx.hp(caster) === casterHp, "le Lanceur ne subit pas sa propre zone");

    const go = { x: start.x, y: start.y + 4 * grid };
    const r = await ctx.engine("teleport", { tokenId: caster.id, itemId: item, ...go }).catch(err => ({ error: err.message }));
    await pause(1500);
    const at = await ctx.position(caster);
    ctx.expect(!r?.error, `la Téléportation mortelle est reconnue comme téléportation de soi${r?.error ? ` (${r.error})` : ""}`);
    ctx.expect(r?.accepted && (at.x === go.x) && (at.y === go.y), "4 cases (20 ft, portée 60 ft) : téléporté");
    const tooFar = await ctx.engine("teleport", { tokenId: caster.id, itemId: item, x: go.x + 14 * grid, y: go.y }).catch(err => ({ error: err.message }));
    await pause(1000);
    const still = await ctx.position(caster);
    ctx.expect(!tooFar?.accepted && (still.x === go.x), "14 cases (70 ft, portée 60 ft) : refusé, reste sur place");
  }
};
