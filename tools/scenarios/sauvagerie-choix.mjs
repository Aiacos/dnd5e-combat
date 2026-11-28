/**
 * §516: optional Savage Attacker (Discord question), world `dnd-6`. The Fighter receives the feat for the scenario if he does
 * not have it, the Bandit 300 HP, next to him; greatsword hits.
 *  - "ask" setting, in combat: on the first hit, the "On Hit" window offers Savage Attacker; "None of the above" keeps it
 *    (damage without it); on the second hit of the turn, offered again and accepted; on the third, no question or Savage Attacker;
 *  - "automatic" setting: no question, the first hit of the turn has it, the second does not.
 * Puts back the setting, the feat, positions, HP.
 */
const MODULE_ID = "dnd5e-combat";
const HIT_TITLE = /Au toucher|On hit/i;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "sauvagerie-choix — Sauvagerie martiale au choix, réglage automatique",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Guerrier", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [fighter, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const f0 = homes.get(fighter.id).pos;

    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const remettre = async () => {
      for ( const [id, h] of homes ) {
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        if ( id !== bandit.id ) await ctx.setHp(tokens.find(x => x.id === id), h.hp);
      }
    };
    ctx.restore(remettre);
    const setting = async (key, value) => { const r = await ctx.engine("setting", { key, value }); ctx.restore(() => ctx.engine("setting", { key, value: r.before })); return r; };

    // The feat, if missing (an origin feat "savage-attacker", read by its identifier).
    const actor = await ctx.call("get-actor", { actorId: fighter.actorId });
    if ( !(actor.items ?? []).some(i => ["savage-attacker", "soldier-feature"].includes(i.system?.identifier)) ) {
      const made = await ctx.call("upsert-actor-item", { actorId: fighter.actorId,
        itemData: { name: "Savage Attacker (test)", type: "feat", system: { identifier: "savage-attacker" } }, match: { path: "name", value: "Savage Attacker (test)" } });
      const id = made?.item?._id ?? made?._id ?? made?.itemId ?? null;
      ctx.restore(() => (id ? ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: id }).catch(() => {}) : null));
    }
    await ctx.call("update-actor", { actorId: fighter.actorId, data: { [`flags.${MODULE_ID}.-=savageAttacker`]: null } }).catch(() => {});
    const sword = await ctx.itemId(fighter.id, "greatsword");
    if ( !ctx.expect(!!sword, "le Guerrier a son épée à deux mains") ) return;

    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const hitDialog = async (ids, waitMs) => {
      for ( const until = Date.now() + waitMs; Date.now() < until; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 2000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => HIT_TITLE.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };
    /** A sword hit; `answer`: "strike" (validate, box checked), "none" (none of the above) or null (no window expected). */
    const attack = async answer => {
      const since = await ctx.lastMessageId();
      const ids = await known();
      const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
      let hit = null;
      let dialog = null;
      for ( const until = Date.now() + 20000; Date.now() < until; await pause(400) ) {
        const res = await ctx.resolution(u.usageMessageId);
        const t = res?.targets?.find(x => x.name === bandit.name);
        if ( (t?.hit === false) || ["missed", "undone"].includes(res?.step) ) { hit = false; break; }
        if ( t?.hit === true ) {
          hit = true;
          dialog = await hitDialog(ids, answer ? 8000 : 3000);
          if ( dialog ) await ctx.call("answer-dialog", { id: dialog.id, button: answer ?? "strike" });
          break;
        }
      }
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const damage = (await ctx.messagesSince(since)).find(m => m.type === "damage");
      return { hit, dialog, savage: damage?.flags?.[MODULE_ID]?.savageAttacker === true, formula: damage?.rolls?.[0]?.formula ?? damage?.formula ?? "" };
    };
    const hitUntil = async answer => {
      for ( let n = 0; n < 20; n++ ) { const a = await attack(answer); if ( a.hit ) return a; }
      return null;
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      await ctx.startCombat([fighter, bandit]);
      const combat = await state();
      for ( const [t, v] of [[fighter, 20], [bandit, 5]] ) {
        await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 3) && ((await current()) !== fighter.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }).catch(() => ctx.nextTurn()); await pause(1500); }
      return (await current()) === fighter.id;
    };
    const setup = async () => {
      await tough();
      await ctx.call("move-token", { tokenId: bandit.id, x: f0.x + grid, y: f0.y, elevation: 0 });
      await pause(600);
    };

    await part("demander : gardée, puis acceptée, une fois par tour", async () => {
      await setting("savageAttackerMode", "ask");
      await setup();
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const kept = await hitUntil("none");
      if ( !ctx.expect(!!kept, "premier coup (20 essais au plus)") ) return;
      ctx.expect(!!kept.dialog, `la question s'ouvre (${kept.dialog?.title ?? "aucune"})`);
      ctx.expect(!kept.savage, `« Rien de tout cela » : pas de Sauvagerie sur ce coup (${kept.formula})`);
      const taken = await hitUntil("strike");
      if ( !ctx.expect(!!taken, "second coup (20 essais au plus)") ) return;
      ctx.expect(!!taken.dialog && taken.savage, `second coup : reproposée et acceptée (${taken.dialog?.title ?? "aucune"}, ${taken.formula})`);
      const third = await hitUntil(null);
      if ( !ctx.expect(!!third, "troisième coup (20 essais au plus)") ) return;
      ctx.expect(!third.dialog && !third.savage, `troisième coup du tour : ni question ni Sauvagerie (${third.formula})`);
    });

    await part("automatique : le premier coup du tour, sans question", async () => {
      await setting("savageAttackerMode", "auto");
      await setup();
      if ( !ctx.expect(await fight(), "combat : au tour du Guerrier") ) return;
      const first = await hitUntil(null);
      if ( !ctx.expect(!!first, "premier coup (20 essais au plus)") ) return;
      ctx.expect(!first.dialog && first.savage, `premier coup : sans question, avec la Sauvagerie (${first.formula})`);
      const second = await hitUntil(null);
      if ( !ctx.expect(!!second, "second coup (20 essais au plus)") ) return;
      ctx.expect(!second.dialog && !second.savage, `second coup : ni question ni Sauvagerie (${second.formula})`);
    });
  }
};
