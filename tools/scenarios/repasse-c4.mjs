/**
 * §299, batch C4 of the term-by-term pass: effects held by Rage, ends when the bearer or the caster is Incapacitated. Spell
 * arena (Caster, Undead, Ally). The Ally receives the Barbarian class (level 11) and the Manual's Rage, borrowed — the Hero
 * (pre-generated Barbarian) keeps its own items intact.
 * Each part borrows its items and puts everything back.
 *  - Blind Rage: the Frightened Hero enters Rage → the condition ends, the immunity activates; once the Rage ends, the
 *    immunity deactivates;
 *  - Predator's Rage: placed during Rage, the Bear's copy drops with it; §509 (Core#98): one option taken, a second
 *    during the same Rage is an issue (forceable); before the option and after the Rage, none;
 *  - Vitality of the Tree: entering Rage gives Temporary Hit Points;
 *  - Turn Undead: the Turned Undead no longer is when the Caster becomes Incapacitated;
 *  - Dragon Flight: the Ally loses its flight when it becomes Incapacitated.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = "Compendium.dnd-players-handbook";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "repasse-c4 — Rage (aptitudes tenues), fins sur Neutralisé (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Héros", "Lanceur", "Mort-vivant", "Allié"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [, caster, undead, ally] = await Promise.all(names.map(n => ctx.token(n)));
    const hero = ally;   // le barbare de l'essai
    const all = [caster, undead, ally];
    const homes = new Map();
    for ( const t of all ) homes.set(t.id, await ctx.position(t));

    const lent = [];
    const lend = async (t, uuid, extra={}) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
      const r = await ctx.call("upsert-actor-item", { actorId: t.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      lent.push([t, r.id]);
      return r.id;
    };
    const unlend = async () => { for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {}); };
    const actorOf = t => ctx.call("get-actor", { actorId: t.actorId });
    const rageItem = async () => (await actorOf(hero)).items.find(i => i.system?.identifier === "rage");
    /** End of Rage: the copies of its effect removed, the item's effect deactivated, its uses restored. */
    const calm = async () => {
      const rage = await rageItem();
      if ( !rage ) return;
      for ( const e of (await actorOf(hero)).effects ?? [] ) {
        if ( String(e._stats?.duplicateSource ?? "").includes(`Item.${rage._id}.`) || (e.origin ?? "").includes(`Item.${rage._id}`) ) {
          await ctx.call("remove-embedded-effect", { documentType: "Actor", id: hero.actorId, effectId: e._id }).catch(() => {});
        }
      }
      for ( const e of rage.effects ?? [] ) if ( !e.disabled ) {
        await ctx.call("upsert-embedded-effect", { uuid: `Actor.${hero.actorId}.Item.${rage._id}`, effectData: { disabled: true }, match: { path: "_id", value: e._id } }).catch(() => {});
      }
      await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: rage._id } });
      await pause(1500);
    };
    const enrage = async () => { const rage = await rageItem(); await ctx.use({ tokenId: hero.id, itemId: rage._id }); await pause(3000); };
    /** The Ally as a barbarian: level 11 class and Rage, borrowed (put back at the end of the scenario, not between parts). */
    const barbarian = async () => {
      const keep = [];
      for ( const [uuid, extra] of [[`${PHB}.classes.Item.phbbrbBarbarian0`, { "system.levels": 11 }], [`${PHB}.classes.Item.phbbrbRage000000`, { "system.uses.spent": 0 }]] ) {
        const { data } = await ctx.call("get-compendium-entry", { uuid });
        const { _id, folder, ownership, _stats, ...itemData } = data;
        setPath(itemData, "flags.dnd5e.sourceId", uuid);
        for ( const [k, v] of Object.entries(extra) ) setPath(itemData, k, v);
        const r = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
        keep.push(r.id);
      }
      ctx.restore(async () => { for ( const id of keep ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: id }).catch(() => {}); });
    };
    const clearStatuses = async () => {
      for ( const t of all ) for ( const s of ["frightened", "incapacitated"] ) await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {});
    };
    const reset = async () => {
      await calm();
      await unlend();
      await clearStatuses();
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: 0 }).catch(() => {});
        await ctx.setHp(t, 999);
      }
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.hp.temp": 0 } }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    await barbarian();
    await calm();
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const statuses = async t => (await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? [];
    /** Waits until a condition holds (the alignment goes through the active GM's queue), 8 s at most. */
    const until = async test => { for ( let n = 0; n < 16; n++ ) { if ( await test() ) return true; await pause(500); } return false; };
    const itemEffect = async (t, id, effectId) => ((await actorOf(t)).items.find(i => i._id === id)?.effects ?? []).find(e => e._id === effectId);

    await part("Rage aveugle", async () => {
      const item = await lend(hero, `${PHB}.classes.Item.phbbrbMindlessRa`);
      await pause(1500);
      await ctx.call("set-status", { tokenId: hero.id, statusId: "frightened", active: true });
      ctx.expect(await until(async () => (await statuses(hero)).includes("frightened")), `le Héros est Effrayé avant la Rage (${(await statuses(hero)).join(", ")})`);
      await enrage();
      ctx.expect(await until(async () => !(await statuses(hero)).includes("frightened")), `en Rage, l'Effroi cesse (${(await statuses(hero)).join(", ")})`);
      ctx.expect(await until(async () => (await itemEffect(hero, item, "Y9LOXK6Q4vot2cxi"))?.disabled === false), "en Rage, l'immunité de Rage aveugle est active");
      await calm();
      ctx.expect(await until(async () => (await itemEffect(hero, item, "Y9LOXK6Q4vot2cxi"))?.disabled === true), "la Rage finie, l'immunité se désactive");
    });

    await part("Rage du prédateur", async () => {
      const item = await lend(hero, `${PHB}.classes.Item.phbbrbRageOfTheW`);
      await pause(1500);
      // §509 (Core#98): the "only one option per Rage" issue, read through legality (api.mcp.issues).
      const second = async () => (await ctx.engine("issues", { tokenId: hero.id, itemId: item })).filter(l => /One option per Rage|Une seule option par Rage/i.test(l));
      await enrage();
      ctx.expect(!(await second()).length, "en Rage, avant toute option : pas de souci d'option");
      await ctx.use({ tokenId: hero.id, itemId: item, activityId: "vbZbZ5Hcu5SfsYnd", targetTokenIds: [hero.id] });
      await pause(2500);
      const bearCopies = async () => ((await actorOf(hero)).effects ?? []).filter(e => /Bear|Ours/i.test(e.name ?? "") && !e.disabled).length;
      ctx.expect(await until(async () => (await bearCopies()) >= 1), "en Rage, l'Ours choisi : sa copie est sur le Héros");
      const lines = await second();
      ctx.expect(lines.length === 1, `même Rage, une seconde option : le souci est relevé (${lines.join(" | ") || "aucun"})`);
      await calm();
      ctx.expect(await until(async () => (await bearCopies()) === 0), "la Rage finie, la copie de l'Ours tombe");
      ctx.expect(!(await second()).length, "la Rage finie : plus de souci d'option");
    });

    await part("Vitalité de l'Arbre", async () => {
      await lend(hero, `${PHB}.classes.Item.phbbrbVitalityOf`);
      await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.hp.temp": 0 } });
      await enrage();
      const temp = async () => Number((await actorOf(hero)).system?.attributes?.hp?.temp) || 0;
      ctx.expect(await until(async () => (await temp()) > 0), `l'entrée en Rage donne des PV temporaires (${await temp()})`);
    });

    await part("Renvoi des morts-vivants, lanceur Neutralisé", async () => {
      await lend(caster, `${PHB}.classes.Item.phbclcChannelDiv`, { "system.uses.max": "9", "system.uses.spent": 0 });
      // §438 : `channel-divinity` (Manuel 2.2.0), `channel-divinity-cleric` (Manuel 3.0.0, SRD de dnd5e 6.1).
      const channelItem = (await actorOf(caster)).items.find(i => ["channel-divinity", "channel-divinity-cleric"].includes(i.system?.identifier));
      const channel = channelItem?._id;
      const turnedOn = async () => (await ctx.effectsFrom(undead, channelItem?.system?.identifier ?? "channel-divinity")).length;
      let turned = false;
      for ( let n = 0; (n < 15) && !turned; n++ ) {
        const r = await ctx.engine("castPicked", { tokenId: caster.id, itemId: channel, activityId: "aOptL5pMaj3WtR8S", targetIds: [undead.id] });
        if ( r?.usageMessageId ) await ctx.settle(r.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
        await pause(1200);
        turned = (await turnedOn()) > 0;
      }
      if ( !ctx.expect(turned, "le Mort-vivant est Renvoyé (15 essais au plus)") ) return;
      await ctx.call("set-status", { tokenId: caster.id, statusId: "incapacitated", active: true });
      await pause(3000);
      ctx.expect((await turnedOn()) === 0, "le Lanceur Neutralisé : le Renvoi prend fin");
    });

    await part("Vol draconique, porteur Neutralisé", async () => {
      const item = await lend(ally, `${PHB}.origins.Item.phbsptDraconicFl`, { "system.uses.spent": 0 });
      await ctx.use({ tokenId: ally.id, itemId: item, activityId: "FrsJbUcch66Cr7OZ", targetTokenIds: [ally.id] });
      await pause(2000);
      ctx.expect((await ctx.effectsFrom(ally, "draconic-flight")).length > 0, "Vol draconique posé sur l'Allié");
      await ctx.call("set-status", { tokenId: ally.id, statusId: "incapacitated", active: true });
      await pause(3000);
      ctx.expect((await ctx.effectsFrom(ally, "draconic-flight")).length === 0, "l'Allié Neutralisé : le vol prend fin");
    });
  }
};
