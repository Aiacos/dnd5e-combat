/**
 * §461 (ATLAS "movement" triage): the creatures' self-teleport, read from their text (`monsterSelfTeleport`) — the distance
 * is the activity's range, or the one the text gives when the activity has none. Spell arena: the Caster (NPC) receives the
 * ability lent from the compendium sheet.
 *  - Blink Dog's Teleport (Monster Manual, activity range 40 ft): 7 cells accepted; 10 cells refused (too far);
 *    the Target's cell refused (occupied);
 *  - "Teleporting Whip" of the "Minor Emissary" (Ravenloft, range "self", "up to 30 feet" in the text): 6 cells accepted,
 *    8 refused.
 * The path is the player's click (`teleportTo`: `dnd5e.teleport` validation, then "blink"); only the core's interactive
 * planning is not played.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const BLINK_DOG = "Compendium.dnd-monster-manual.actors.Actor.mmBlinkDog000000.Item.mmTeleport000000";
const LASH = "Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwLesserStarSpa.Item.jL8ftBCKdxnfF6OL";

export default {
  name: "repasse-teleport — téléportation de soi des créatures à la portée de leur action (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") ) { ctx.log("Monster Manual absent : non applicable"); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const home = await ctx.position(caster);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      ((itemData.flags ??= {}).dnd5e ??= {}).sourceId = uuid;
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    ctx.restore(async () => {
      await ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    // Start two rows below the Target: the row is free toward the east.
    const start = { x: home.x, y: home.y + 2 * grid };
    const jump = async (itemId, cells, label) => {
      const from = await ctx.position(caster);
      const to = { x: from.x + cells * grid, y: from.y };
      const r = await ctx.engine("teleport", { tokenId: caster.id, itemId, ...to }).catch(err => ({ error: err.message }));
      await pause(1500);
      const at = await ctx.position(caster);
      const arrived = (at.x === to.x) && (at.y === to.y);
      if ( r?.error ) ctx.log(`${label} : ${r.error}`);
      return { accepted: !!r?.accepted, arrived, still: (at.x === from.x) && (at.y === from.y), error: r?.error ?? null };
    };

    // Blink Dog: activity range 40 ft.
    const dog = await lend(BLINK_DOG);
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await pause(800);
    const near = await jump(dog, 7, "7 cases");
    ctx.expect(!near.error, "la Téléportation du Chien clignotant est reconnue comme téléportation de soi (portée de l'activité)");
    ctx.expect(near.accepted && near.arrived, "7 cases (35 ft, portée 40 ft) : téléporté");
    const far = await jump(dog, 10, "10 cases");
    ctx.expect(!far.accepted && far.still, "10 cases (50 ft, portée 40 ft) : refusé, reste sur place");
    const t = await ctx.position(target);
    const busy = await ctx.engine("teleport", { tokenId: caster.id, itemId: dog, x: t.x, y: t.y }).catch(err => ({ error: err.message }));
    await pause(1000);
    const after = await ctx.position(caster);
    ctx.expect(!busy?.accepted && !((after.x === t.x) && (after.y === t.y)), "la case de la Cible : refusée (occupée)");

    // Minor Emissary: range "self", 30 ft in the text.
    if ( !packs.includes("dnd-ravenloft-horrors-within.actors") ) { ctx.log("Ravenloft absent : Fouet téléporteur non joué"); return; }
    const lash = await lend(LASH);
    await ctx.call("move-token", { tokenId: caster.id, x: start.x, y: start.y, elevation: 0 });
    await pause(800);
    const ok = await jump(lash, 6, "6 cases");
    ctx.expect(!ok.error, "le Fouet téléporteur est reconnu (distance lue dans le texte)");
    ctx.expect(ok.accepted && ok.arrived, "6 cases (30 ft) : téléporté");
    const tooFar = await jump(lash, 8, "8 cases");
    ctx.expect(!tooFar.accepted && tooFar.still, "8 cases (40 ft, limite 30 ft) : refusé, reste sur place");
  }
};
