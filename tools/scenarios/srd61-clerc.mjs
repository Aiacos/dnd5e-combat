/**
 * §434: SRD 6.1 dnd5e Disciple of Life played in game (§433, point 6). SRD 6.1 makes it an enchantment of the healing spell
 * (`2 + @item.level` on the activity's healing); the engine, which itself added 2 + the spell's level, must no longer do so for an
 * enchanted spell. Test arena: the Cleric goes to level 3 (level 2 spell slots) and receives, lent from `dnd5e.classes24` and
 * `dnd5e.spells24` (SRD 6.1, not the Handbook), Supreme Healing (dice at maximum: the amount reads exactly) and Cure Wounds.
 * The Fighter, next to him, receives 60 more max HP and drops to 1 HP before each healing. Checks that the healing equals:
 *  - SRD 6.1 Disciple of Life, Cure Wounds enchanted by its activity: level 1 → 16 + Wisdom + 3, level 2 → 32 + Wisdom + 4
 *    (the bonus only once); the spell carries the enchantment;
 *  - SRD 6.1 Disciple of Life, Cure Wounds not enchanted: 16 + Wisdom + 3 (the engine adds the bonus);
 *  - old form (the same item without its activity or its enchantment effect, like a sheet made before dnd5e 6.1): 16 + Wisdom + 3.
 * Puts back level, HP; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e";
const DISCIPLE = `${SRD}.classes24.Item.phbclcDiscipleOf`;
const PROFILE = "SJswY9WWGfmNXW2E";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "srd61-clerc — Disciple de la vie du SRD 6.1 : sort enchanté, non enchanté, ancienne forme (bonus compté une fois)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Clerc", "Guerrier"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [cleric, fighter] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(cleric.id).pos;
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);

    const actor = await ctx.call("get-actor", { actorId: cleric.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "cleric"));
    if ( !ctx.expect(!!cls, "le Clerc a sa classe de clerc") ) return;
    await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData: { "system.levels": 3 }, match: { path: "_id", value: cls._id } });
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData: { "system.levels": cls.system.levels }, match: { path: "_id", value: cls._id } }).catch(() => {}));
    // The spent spell slots put back to full at the end.
    ctx.restore(() => ctx.call("update-actor", { actorId: cleric.actorId, actorData: { "system.spells.spell1.value": 9, "system.spells.spell2.value": 9 } }).catch(() => {}));

    const lend = async (uuid, edit=null) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      if ( edit ) edit(itemData);
      const r = await ctx.call("upsert-actor-item", { actorId: cleric.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    const unlend = id => ctx.call("remove-embedded-item", { documentType: "Actor", id: cleric.actorId, itemId: id }).catch(() => {});
    await lend(`${SRD}.classes24.Item.phbclcSupremeHea`);

    await ctx.call("move-token", { tokenId: fighter.id, x: g.x + grid, y: g.y, elevation: 0 });
    await ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.hp.bonuses.overall": "60" } });
    ctx.restore(() => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { "system.attributes.hp.bonuses.overall": "" } }).catch(() => {}));
    await pause(800);
    const wis = (await ctx.engine("stats", { tokenId: cleric.id }))?.mods?.wis ?? 0;
    const fmax = (await ctx.engine("stats", { tokenId: fighter.id }))?.hp?.max;

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** Cure Wounds on the Fighter at 1 HP, at this spell slot level; returns the HP gained and the roll's formula. */
    const heal = async (cure, level) => {
      await ctx.call("update-actor", { actorId: cleric.actorId, actorData: { [`system.spells.spell${level}.value`]: 2 } });
      await ctx.setHp(fighter, 1);
      await pause(500);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: cleric.id, itemId: cure, activityType: "heal", targetTokenIds: [fighter.id],
        usageConfig: { spell: { slot: `spell${level}` }, [MODULE_ID]: { confirmed: true } } });
      await pause(1500);
      await ctx.engine("rollCard", { messageId: u.usageMessageId });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      const roll = (await ctx.messagesSince(since)).find(m => m.rolls?.length && (m.type !== "usage"));
      const formula = (roll?.rolls ?? []).map(x => `${x.formula} = ${x.total}`).join(" + ");
      return { gained: (await ctx.hp(fighter)) - 1, formula };
    };
    const expected = (dice, bonus) => Math.min(fmax - 1, dice + wis + bonus);

    await part("Disciple de la vie (SRD 6.1), Soins enchanté", async () => {
      const disciple = await lend(DISCIPLE);
      const cure = await lend(`${SRD}.spells24.Item.phbsplCureWounds`, d => { d.system.prepared = 1; });
      // In game, the player drops the spell on the activity's card (dnd5e: EnchantActivity#applyEnchantment);
      // `enchant` makes the same call.
      await ctx.engine("enchant", { tokenId: cleric.id, itemId: disciple, activityId: "7BzRpy5Nw0guVN1y", targetItemId: cure, profile: PROFILE });
      await pause(1500);
      const item = ((await ctx.call("get-actor", { actorId: cleric.actorId })).items ?? []).find(i => i._id === cure);
      const ench = (item?.effects ?? []).find(e => e.type === "enchantment");
      if ( !ctx.expect(!!ench, `Soins porte l'enchantement de Disciple de la vie (${item?.name} ; ${(item?.effects ?? []).map(e => e.name).join(", ") || "aucun effet"})`) ) return;
      const one = await heal(cure, 1);
      ctx.expect(one.gained === expected(16, 3), `niveau 1 : +${one.gained} PV (attendu ${expected(16, 3)} = 16 + ${wis} + 3) — ${one.formula}`);
      const two = await heal(cure, 2);
      ctx.expect(two.gained === expected(32, 4), `niveau 2 : +${two.gained} PV (attendu ${expected(32, 4)} = 32 + ${wis} + 4) — ${two.formula}`);
      await unlend(cure); await unlend(disciple);
    });

    await part("Disciple de la vie (SRD 6.1), Soins non enchanté", async () => {
      const disciple = await lend(DISCIPLE);
      const cure = await lend(`${SRD}.spells24.Item.phbsplCureWounds`, d => { d.system.prepared = 1; });
      const one = await heal(cure, 1);
      ctx.expect(one.gained === expected(16, 3), `+${one.gained} PV (attendu ${expected(16, 3)} = 16 + ${wis} + 3, bonus du moteur) — ${one.formula}`);
      await unlend(cure); await unlend(disciple);
    });

    await part("Disciple de la vie, ancienne forme", async () => {
      const disciple = await lend(DISCIPLE, d => { d.system.activities = {}; d.effects = []; });
      const cure = await lend(`${SRD}.spells24.Item.phbsplCureWounds`, d => { d.system.prepared = 1; });
      const one = await heal(cure, 1);
      ctx.expect(one.gained === expected(16, 3), `+${one.gained} PV (attendu ${expected(16, 3)} = 16 + ${wis} + 3) — ${one.formula}`);
      await unlend(cure); await unlend(disciple);
    });
  }
};
