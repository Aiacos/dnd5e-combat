/**
 * The Reaction window BEFORE the attack roll (SPEC §34), world `dnd-6`. The Bandit attacks the Fighter; in each game, only one
 * creature has what it takes to react, lent from the Player's Handbook compendium:
 *  - "Shadow Dodge" (Ranger) to the Fighter, the target: the Bandit's roll has Disadvantage;
 *  - Warding Flare (Cleric) to the Cleric, 9 m from the Bandit: the roll has Disadvantage;
 *  - Cosmic Omen (Druid), Woe, to the Druid: 1d6 subtracted from the roll;
 *  - §36: Cosmic Omen, Weal — the Fighter attacks the Bandit, the Druid adds 1d6 to his roll.
 * The Reaction is taken automatically (`autoReact: "first"`); the connector hands back control as soon as the gate suspends the
 * use, the rest is read in the chat. Resets positions, HP, uses; removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const CLASSES = "dnd-players-handbook.classes";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function setPath(obj, path, value) {
  const keys = path.split(".");
  let o = obj;
  for ( const k of keys.slice(0, -1) ) o = (o[k] ??= {});
  o[keys.at(-1)] = value;
}

export default {
  name: "avant l'attaque — Esquive des ombres, Éclat protecteur, Présage cosmique (Péril, Fortune)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit", "Clerc", "Druide"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const cleric = await ctx.token("Clerc");
    const druid = await ctx.token("Druide");
    const homes = new Map();
    for ( const t of [fighter, bandit, cleric, druid] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    // Standing for the length of the scenario: a Fighter left Prone in the world (seen on 2026-11-18, since 11/11) gives the Bandit
    // Advantage, which cancels the Reaction's Disadvantage — the roll stayed "1d20" depending on the order of the pass. Restored as
    // found at the end.
    for ( const t of [fighter, bandit] ) {
      if ( !(await ctx.effects(t)).some(e => (e.statuses ?? []).includes("prone")) ) continue;
      await ctx.removeStatusEffects(t, "prone");
      ctx.restore(() => ctx.call("set-status", { tokenId: t.id, statusId: "prone", active: true }).catch(() => {}));
      ctx.log(`${t.name} relevé le temps du scénario (À terre dans le monde)`);
    }
    // Restored Keep, column x = 3080: the Cleric and the Druid at 4760 and 4900 (9 m from the Bandit), the Fighter at 5040, the
    // Bandit at 5180.
    const spot = { cleric: { x: 3080, y: 4760 }, druid: { x: 3080, y: 4900 }, fighter: { x: 3080, y: 5040 }, bandit: { x: 3080, y: 5180 } };
    const place = async (t, p) => { await ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: 0 }); await pause(600); };
    const lend = async (who, pack, id) => {
      const uuid = `Compendium.${pack}.Item.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      setPath(itemData, "flags.dnd5e.sourceId", uuid);
      const r = await ctx.call("upsert-actor-item", { actorId: who.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      const remove = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: who.actorId, itemId: r.id }).catch(() => {});
      ctx.restore(remove);
      return remove;
    };

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      if ( process.env.PART && !name.includes(process.env.PART) ) return;
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /** The Bandit attacks the Fighter, Reaction taken automatically; returns the roll formula and the cards produced. */
    const banditAttacks = async () => {
      await place(cleric, spot.cleric); await place(druid, spot.druid); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: bandit.id, identifier: "scimitar", activityType: "attack", targetTokenIds: [fighter.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      let attack = null;
      for ( const stop = Date.now() + 25000; !attack && (Date.now() < stop); await pause(800) ) {
        attack = (await ctx.messagesSince(since)).find(m => (m.type === "attack") && (m.alias === "Bandit"));
      }
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      return { formula: attack?.rolls?.[0]?.formula ?? "", msgs };
    };

    await part("Esquive des ombres", async () => {
      const remove = await lend(fighter, CLASSES, "phbrgrShadowyDod");
      const { formula, msgs } = await banditAttacks();
      const reacted = msgs.some(m => (m.type === "usage") && (m.alias === fighter.name || m.alias === "Guerrier"));
      ctx.expect(reacted && /dis|kl/.test(formula), `le Guerrier réagit (${reacted}) ; jet du Bandit : ${formula}`);
      await remove();
    });

    await part("Éclat protecteur", async () => {
      const remove = await lend(cleric, CLASSES, "phbclcWardingFla");
      const { formula, msgs } = await banditAttacks();
      const reacted = msgs.some(m => (m.type === "usage") && /Clerc/.test(m.alias ?? ""));
      ctx.expect(reacted && /dis|kl/.test(formula), `le Clerc réagit (${reacted}) ; jet du Bandit : ${formula}`);
      await remove();
    });

    await part("Présage cosmique", async () => {
      const remove = await lend(druid, CLASSES, "phbdrdCosmicOmen");
      const { formula, msgs } = await banditAttacks();
      const woe = msgs.find(m => (m.rolls ?? []).some(r => /^1d6$/.test(r.formula)) && /Druide/.test(m.alias ?? ""));
      const n = woe?.rolls?.[0]?.total;
      ctx.expect(!!woe && formula.includes(`- ${n}`), `le Druide réagit : 1d6 = ${n} ; jet du Bandit : ${formula}`);
      await remove();
    });

    // §36: Weal — the Fighter attacks the Bandit; the Druid, his ally within 1.50 m, adds 1d6 to the roll (only the Weal activity
    // is offered in this window, `autoReact: "first"` takes it).
    await part("Fortune", async () => {
      const remove = await lend(druid, CLASSES, "phbdrdCosmicOmen");
      await place(cleric, spot.cleric); await place(druid, spot.druid); await place(fighter, spot.fighter); await place(bandit, spot.bandit);
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: fighter.id, identifier: "greatsword", activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      let attack = null;
      for ( const stop = Date.now() + 25000; !attack && (Date.now() < stop); await pause(800) ) {
        attack = (await ctx.messagesSince(since)).find(m => (m.type === "attack") && (m.alias === "Guerrier"));
      }
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const formula = attack?.rolls?.[0]?.formula ?? "";
      const weal = msgs.find(m => (m.rolls ?? []).some(r => /^1d6$/.test(r.formula)) && /Druide/.test(m.alias ?? ""));
      const n = weal?.rolls?.[0]?.total;
      ctx.expect(!!weal && formula.includes(`+ ${n}`), `le Druide réagit : 1d6 = ${n} ; jet du Guerrier : ${formula}`);
      const reactions = msgs.filter(m => (m.type === "usage") && /Druide/.test(m.alias ?? ""));
      ctx.expect(reactions.length === 1, `une seule réaction du Druide (${reactions.length})`);
      await remove();
    });
  }
};
