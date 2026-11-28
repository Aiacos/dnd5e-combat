/**
 * §210: knocking out (non-lethal blows) and surprise — `dnd-6` Paladin against the Bandit (AC 5, 1 HP for the test).
 *  1. Non-lethal blows enabled: a longsword hit that would drop the Bandit to 0 HP leaves him at 1 HP, Unconscious,
 *     "knocked out".
 *  2. HP regained wake him: no longer Unconscious, no longer "knocked out".
 *  3. Non-lethal blows off: the same hit drops him to 0 HP.
 *  4. Surprise: the Paladin Hidden (the engine's Stealth), the Bandit's Initiative is rolled with Disadvantage;
 *     the "Surprised" condition placed on the Bandit disappears once his Initiative is rolled.
 * Resets flag, AC, HP, conditions, positions, Stealth.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "assommer — coups non létaux, réveil, surprise à l'initiative",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( ["Paladin", "Bandit"].some(n => !tokens.some(t => t.name === n)) ) { ctx.log("Paladin et Bandit requis : non applicable"); return; }
    const pal = await ctx.token("Paladin");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const homes = new Map();
    for ( const t of [pal, bandit] ) homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
    const g = homes.get(pal.id).pos;

    const palActor = await ctx.call("get-actor", { actorId: pal.actorId });
    const flag0 = palActor.flags?.[MODULE_ID]?.nonLethal ?? null;
    const setNonLethal = on => ctx.call("update-actor", { actorId: pal.actorId, actorData: { [`flags.${MODULE_ID}.nonLethal`]: on } });
    ctx.restore(() => ctx.call("update-actor", { actorId: pal.actorId,
      actorData: { [`flags.${MODULE_ID}.nonLethal`]: flag0 } }).catch(() => {}));

    const banditData = async () => (await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id })).data;
    const ac0 = (await banditData()).delta?.system?.attributes?.ac ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: { "delta.system.attributes.ac": ac0 } }).catch(() => {}));
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { [`delta.flags.${MODULE_ID}.knockedOut`]: null } }).catch(() => {}));
    ctx.restore(() => ctx.removeEffectsNamed(pal, /Furtivité \(scénario assommer\)/));
    const knockedOut = async () => !!(await banditData()).delta?.flags?.[MODULE_ID]?.knockedOut;
    const statuses = async () => new Set((await ctx.effects(bandit)).flatMap(e => e.statuses ?? []));

    const remettre = async () => {
      for ( const [id, h] of homes ) {
        const t = tokens.find(x => x.id === id);
        await ctx.call("move-token", { tokenId: id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation ?? 0 }).catch(() => {});
        for ( const s of ["unconscious", "prone", "dead", "surprised"] ) {
          await ctx.removeStatusEffects(t, s);
          await ctx.call("set-status", { tokenId: id, statusId: s, active: false }).catch(() => {});
        }
        await ctx.setHp(t, h.hp);
      }
      await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { [`delta.flags.${MODULE_ID}.knockedOut`]: null } }).catch(() => {});
    };
    ctx.restore(remettre);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await remettre();
      await pause(1000);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${name} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const fight = async () => {
      await ctx.startCombat([pal, bandit]);
      const combat = await state();
      for ( const [t, v] of [[pal, 20], [bandit, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; (i < 3) && ((await current()) !== pal.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
      return (await current()) === pal.id;
    };
    const weak = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.ac": { calc: "flat", flat: 5 } } });
      await ctx.setHp(bandit, 1);
    };
    const sword = await ctx.itemId(pal.id, "longsword");
    /** Strikes the Bandit until a hit lands (10 tries at most, passing the turn to regain the action). */
    const hit = async () => {
      for ( let n = 0; n < 10; n++ ) {
        const u = await ctx.use({ tokenId: pal.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id], usageConfig: { [MODULE_ID]: { confirmed: true } } });
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === bandit.name)?.hit === true ) { await pause(2500); return true; }
        await ctx.nextTurn(); await pause(1200); await ctx.nextTurn(); await pause(1500);
      }
      return false;
    };
    const place = async () => { await ctx.call("move-token", { tokenId: bandit.id, x: g.x + grid, y: g.y, elevation: 0 }); await pause(700); };

    await part("Assommer puis réveiller", async () => {
      await setNonLethal(true); await place(); await weak();
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      if ( !ctx.expect(await hit(), "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const hp = await ctx.hp(bandit);
      const s = await statuses();
      ctx.expect(hp === 1, `coup non létal : le Bandit reste à 1 PV (${hp})`);
      ctx.expect(s.has("unconscious") && !s.has("dead"), `Inconscient, pas mort (${[...s].join(", ")})`);
      ctx.expect(await knockedOut(), "drapeau « assommé » posé");
      // A real heal (applyDamage → sheet update): writing the HP into the token does not go through `updateActor`.
      await ctx.engine("heal", { tokenId: bandit.id, amount: 4 });
      await pause(2500);
      const after = await statuses();
      ctx.expect(!after.has("unconscious"), `PV regagnés : réveillé (${[...after].join(", ") || "aucun état"})`);
      ctx.expect(!(await knockedOut()), "drapeau « assommé » retiré");
    });

    await part("Coups létaux", async () => {
      await setNonLethal(false); await place(); await weak();
      if ( !ctx.expect(await fight(), "combat : au tour du Paladin") ) return;
      if ( !ctx.expect(await hit(), "l'épée longue touche le Bandit (10 essais au plus)") ) return;
      const hp = await ctx.hp(bandit);
      ctx.expect(hp === 0, `coup létal : le Bandit tombe à 0 PV (${hp})`);
      ctx.expect(!(await knockedOut()), "pas de drapeau « assommé »");
    });

    /** The Bandit's Initiative in a fresh combat: returns the roll formula. */
    const banditInitiative = async () => {
      await ctx.startCombat([pal, bandit]);
      const cid = (await state()).combatants.find(x => x.tokenId === bandit.id).id;
      const since = await ctx.lastMessageId();
      await ctx.call("roll-initiative", { combatId: ctx.ownCombat, combatantIds: [cid] });
      await pause(3000);
      return (await ctx.messagesSince(since)).flatMap(m => m.rolls ?? []).find(r => /d20/.test(r.formula ?? ""))?.formula ?? "aucun jet";
    };
    const disadvantage = formula => /kl|dis/.test(formula);

    await part("Surprise par la Furtivité", async () => {
      await setNonLethal(false); await place();
      await ctx.call("upsert-embedded-effect", { documentType: "Actor", id: pal.actorId, effectData: {
        name: "Furtivité (scénario assommer)", img: "icons/svg/cowled.svg", transfer: false, disabled: false, changes: [],
        flags: { [MODULE_ID]: { hidden: { dc: 20 } } } } });
      await pause(500);
      const st = await ctx.engine("stealth", { tokenId: pal.id });
      if ( !ctx.expect(st.hidden, "Paladin caché") ) return;
      const formula = await banditInitiative();
      ctx.expect(disadvantage(formula), `Paladin caché : initiative du Bandit avec le Désavantage (${formula})`);
      await ctx.removeEffectsNamed(pal, /Furtivité \(scénario assommer\)/);
    });

    await part("État Surpris", async () => {
      await place();
      await ctx.call("set-status", { tokenId: bandit.id, statusId: "surprised", active: true });
      const formula = await banditInitiative();
      ctx.expect(disadvantage(formula), `Surpris : initiative avec le Désavantage (${formula})`);
      const s = await statuses();
      ctx.expect(!s.has("surprised"), `« Surpris » retiré après l'initiative (${[...s].join(", ") || "aucun état"})`);
      await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
      const plain = await banditInitiative();
      ctx.expect(!disadvantage(plain), `sans surprise : initiative normale (${plain})`);
    });
  }
};
