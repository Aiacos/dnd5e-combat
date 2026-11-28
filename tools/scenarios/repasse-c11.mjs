/**
 * §306, batch C11 of the term-by-term review: subclass magic. Spells Arena (Caster, Target).
 * Each part lends its items from the Player's Handbook (with their source) and restores everything.
 *  - Third Eye, See Invisibility: the Caster sees the Invisible Target (no more "target not seen" Disadvantage);
 *  - Improved Illusions: the range of Phantasmal Force (Illusion, 18 m) goes to 36 m.
 * Spell Breaker (proficiency bonus on the Dispel check): unit tests and code reading (SPEC §306).
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
  name: "repasse-c11 — Troisième œil, Illusions améliorées (Arène des sorts)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const names = ["Lanceur", "Cible"];
    const { tokens } = await ctx.scene();
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis (tools/arene-sorts.mjs) : non applicable`); return; }
    const [caster, target] = await Promise.all(names.map(n => ctx.token(n)));
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
    const reset = async () => {
      for ( const [t, id] of lent.splice(0) ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: t.actorId, itemId: id }).catch(() => {});
      for ( const t of [caster, target] ) for ( const e of (await ctx.call("get-actor", { actorId: t.actorId })).effects ?? [] ) {
        await ctx.call("remove-embedded-effect", { documentType: "Actor", id: t.actorId, effectId: e._id ?? e.id }).catch(() => {});
      }
      await ctx.call("set-status", { tokenId: target.id, statusId: "invisible", active: false }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };

    await part("Troisième œil", async () => {
      const eye = await lend(caster, `${PHB}.classes.Item.phbwzdTheThirdEy`, { "system.uses.spent": 0 });
      const club = await lend(caster, `${PHB}.equipment.Item.phbwepClub000000`, { "system.equipped": true, "system.proficient": 1 });
      await ctx.call("set-status", { tokenId: target.id, statusId: "invisible", active: true });
      await pause(1200);
      const before = await ctx.engine("attackReasons", { attackerId: caster.id, targetId: target.id, itemId: club });
      // §438: Handbook 2.2.0, "utility" activity `lbwgWyEQ7Zc9kz1N`; Handbook 3.0.0, "cast" activity
      // `AJ9aBhuLHOiy0mqg` (casts See Invisibility).
      const acts = Object.keys(((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === eye)?.system?.activities ?? {});
      const see = ["lbwgWyEQ7Zc9kz1N", "AJ9aBhuLHOiy0mqg"].find(id => acts.includes(id));
      if ( !ctx.expect(!!see, `Troisième œil : une activité Voir l'invisible (${acts.join(", ")})`) ) return;
      await ctx.use({ tokenId: caster.id, itemId: eye, activityId: see, targetTokenIds: [caster.id] });
      await pause(2500);
      // The 3.0.0 form casts the spell (copy then use): the effect arrives later — awaited 10 s at most.
      for ( let i = 0; (i < 10) && !(await ctx.effects(caster)).some(e => /See Invisib|invisibilit/i.test(e.name ?? "")); i++ ) await pause(1000);
      const after = await ctx.engine("attackReasons", { attackerId: caster.id, targetId: target.id, itemId: club });
      ctx.expect(before.disadvantage.includes("target.unseen"), `sans le Troisième œil, la Cible Invisible n'est pas vue (${before.disadvantage.join(", ")})`);
      ctx.expect(!after.disadvantage.includes("target.unseen"), `avec Détection de l'invisibilité, elle l'est (${after.disadvantage.join(", ") || "rien"})`);
    });

    await part("Illusions améliorées", async () => {
      const spell = await lend(caster, `${PHB}.spells.Item.phbPhantasmalFor`, { "system.method": "atwill" });
      const base = await ctx.engine("range", { tokenId: caster.id, itemId: spell, activityType: "save" });
      await lend(caster, `${PHB}.classes.Item.phbwzdImprovedIl`);
      await pause(1000);
      const more = await ctx.engine("range", { tokenId: caster.id, itemId: spell, activityType: "save" });
      ctx.expect((more?.value ?? 0) === (base?.value ?? 0) + 60, `portée de Force fantasmagorique : ${base?.value} → ${more?.value} ${more?.units ?? ""} (+60 attendus)`);
    });
  }
};
