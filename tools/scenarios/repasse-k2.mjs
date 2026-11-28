/**
 * §323, batch K2 of the creature pass: the death that the text of a monster ability promises (`core/monster-text.mjs`,
 * `monsterDeaths`). Spell arena: the Caster (NPC) receives abilities borrowed from the Monster Manual and Ravenloft sheets;
 * the Hero (a character) and the Target (999 HP).
 *  - Rotting Fist (Mummy): a character reduced to 0 HP by the hit dies (Dead, not Unconscious);
 *  - Death Gaze (Sea Hag): at 20 HP or less, a failed saving throw drops to 0 HP — a character Unconscious, not Dead;
 *  - Death Touch (Ankhtepot): at 80 HP or less, Dead without damage; above, the damage alone, not the data's Dead effect.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-k2 — mort à 0 PV et paliers de PV lus dans le texte des monstres (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Héros", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const packs = JSON.stringify((await ctx.call("list-compendiums", {}).catch(() => null)) ?? "");
    if ( !packs.includes("dnd-monster-manual.actors") || !packs.includes("dnd-ravenloft-horrors-within.actors") ) { ctx.log("Monster Manual ou Ravenloft absent : non applicable"); return; }
    const [caster, hero, target] = await Promise.all(names.map(n => ctx.token(n)));
    const grid = ARENE_SORTS.grid;
    const homes = new Map();
    for ( const t of [caster, hero] ) homes.set(t.id, await ctx.position(t));
    const heroHp = await ctx.hp(hero);
    const lent = [];
    const lend = async uuid => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: caster.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push(r.id);
      return r.id;
    };
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];
    const raise = async t => {
      for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(t, s).catch(() => {});
      await ctx.call("update-actor", { actorId: t.actorId, actorData: { "system.attributes.death.success": 0, "system.attributes.death.failure": 0 } }).catch(() => {});
    };
    const reset = async () => {
      await raise(hero);
      await ctx.setHp(hero, heroHp).catch(() => {});
      await ctx.setHp(target, 999).catch(() => {});
      for ( const s of ["dead"] ) await ctx.removeStatusEffects(target, s).catch(() => {});
      for ( const t of [caster, hero] ) { const h = homes.get(t.id); await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {}); }
      await pause(800);
    };
    ctx.restore(async () => {
      await reset();
      for ( const id of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: caster.actorId, itemId: id }).catch(() => {});
    });
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    // The Caster in contact with the Hero.
    const beside = async () => {
      const h = homes.get(hero.id);
      await ctx.call("move-token", { tokenId: caster.id, x: h.x + grid, y: h.y, elevation: 0 });
      await pause(800);
    };

    await part("Poing putréfié", async () => {
      const fist = await lend("Compendium.dnd-monster-manual.actors.Actor.mmMummy000000000.Item.mmRottingFist000");
      await beside();
      let hit = false;
      for ( let i = 0; (i < 20) && !hit; i++ ) {
        await raise(hero);
        await ctx.setHp(hero, 1);
        await pause(500);
        const u = await ctx.use({ tokenId: caster.id, itemId: fist, activityId: "8A7HEjh4kbkf9WwX", activityType: "attack", targetTokenIds: [hero.id] });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        hit = r?.targets?.find(t => t.name === "Héros")?.hit === true;
      }
      if ( !ctx.expect(hit, "le Poing touche le Héros (20 essais au plus)") ) return;
      await pause(2500);
      const st = await statuses(hero);
      // The 0 HP rule may have placed Unconscious just before: Dead is enough (no death saving throws).
      ctx.expect(st.includes("dead"), `Héros réduit à 0 PV par le Poing : Mort (${st.join(", ")})`);
    });

    await part("Regard mortel", async () => {
      const glare = await lend("Compendium.dnd-monster-manual.actors.Actor.mmSeaHag00000000.Item.mmDeathGlare0000");
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await raise(hero);
        await ctx.setHp(hero, 15);
        await pause(500);
        const u = await ctx.use({ tokenId: caster.id, itemId: glare, activityId: "3uA75vqvubgY300I", activityType: "save", targetTokenIds: [hero.id], consume: false });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        failed = r?.targets?.find(t => t.name === "Héros")?.save?.success === false;
      }
      if ( !ctx.expect(failed, "le Héros rate la sauvegarde du Regard (20 essais au plus)") ) return;
      await pause(2500);
      const hp = await ctx.hp(hero);
      const st = await statuses(hero);
      ctx.expect((hp === 0) && st.includes("unconscious") && !st.includes("dead"), `à 15 PV : tombe à 0 PV, Inconscient, pas Mort (${hp} PV ; ${st.join(", ")})`);
    });

    await part("Toucher de la mort", async () => {
      const touch = await lend("Compendium.dnd-ravenloft-horrors-within.actors.Actor.rhwAnkhtepot0000.Item.IOli1HmJk2aN4oL0");
      await beside();
      await ctx.setHp(hero, 50);
      await pause(500);
      let u = await ctx.use({ tokenId: caster.id, itemId: touch, activityId: "JLSlEpy0dYrg4Rbo", activityType: "damage", targetTokenIds: [hero.id], consume: false, rollDamage: true });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const st = await statuses(hero);
      ctx.expect(st.includes("dead"), `Héros à 50 PV : Mort (${st.join(", ")})`);
      // The Target (999 HP): the damage alone.
      const t = await ctx.position(target);
      await ctx.call("move-token", { tokenId: caster.id, x: t.x - grid, y: t.y, elevation: 0 });
      await pause(800);
      u = await ctx.use({ tokenId: caster.id, itemId: touch, activityId: "JLSlEpy0dYrg4Rbo", activityType: "damage", targetTokenIds: [target.id], consume: false, rollDamage: true });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const hp = await ctx.hp(target);
      const ts = await statuses(target);
      ctx.expect((hp < 999) && !ts.includes("dead"), `Cible à 999 PV : dégâts seuls (${hp} PV ; ${ts.join(", ") || "aucun état"})`);
    });
  }
};
