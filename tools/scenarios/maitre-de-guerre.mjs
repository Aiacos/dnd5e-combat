/**
 * §87 — Battle Master maneuvers played on a hit. The Fighter goes to level 3 and receives, lent from the Player's Handbook
 * compendium, the Battle Master (superiority dice scale: 4d8), Combat Superiority, Trip Attack and Menacing Attack; the Bandit
 * (300 HP) in contact. Checks, for each maneuver:
 *  - on a hit, the question offers the maneuvers; once chosen, +1d8 to the damage roll, a superiority die spent;
 *  - then the maneuver's saving throw on the Bandit: Trip Attack — Strength, Prone ⇔ failed; Menacing Attack — Wisdom,
 *    Frightened ⇔ failed, and no extra damage (the save's share is not rolled: `noDamage`).
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.classes.Item";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "Maître de guerre — Croc-en-jambe, Attaque provocante (dé de supériorité, sauvegarde)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    const g = await ctx.position(fighter), b0 = await ctx.position(bandit);
    ctx.restore(() => ctx.call("move-token", { tokenId: bandit.id, x: b0.x, y: b0.y, elevation: 0 }));
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const clearBandit = async () => { await ctx.removeStatusEffects(bandit, "prone"); await ctx.removeEffectsNamed(bandit, /Goaded|Provoqu/i); };
    ctx.restore(clearBandit);
    await ctx.call("move-token", { tokenId: bandit.id, x: g.x + grid, y: g.y, elevation: 0 });
    await pause(700);

    // Fighter level 3, for the duration of the scenario.
    const actor = await ctx.call("get-actor", { actorId: fighter.actorId });
    const cls = (actor.items ?? []).find(i => (i.type === "class") && (i.system?.identifier === "fighter"));
    if ( !ctx.expect(!!cls, "le Guerrier a sa classe de guerrier") ) return;
    const levels0 = cls.system.levels;
    ctx.restore(() => ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.levels": levels0 }, match: { path: "_id", value: cls._id } }).catch(() => {}));
    await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.levels": Math.max(3, levels0) }, match: { path: "_id", value: cls._id } });
    const lend = async id => {
      const uuid = `${PHB}.${id}`;
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...itemData } = data;
      itemData.flags = { ...(itemData.flags ?? {}), dnd5e: { ...(itemData.flags?.dnd5e ?? {}), sourceId: uuid } };
      const r = await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData, match: { path: "flags.dnd5e.sourceId", value: uuid } });
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: fighter.actorId, itemId: r.id }).catch(() => {}));
      return r.id;
    };
    await lend("phbftrBattleMast");
    const superiority = await lend("phbftrCombatSupe");
    await lend("phbmnvTripAttack");
    await lend("phbmnvGoadingAtt");
    await pause(1500);
    const spent = async () => ((await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? []).find(i => i._id === superiority)?.system?.uses?.spent ?? null;
    await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    const sword = await ctx.itemId(fighter.id, "greatsword");

    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const answer = async (ids, re, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        for ( const d of r?.windows ?? [] ) {
          // §516: the "On hit" window of the Fighter's "Martial Savagery" (ticked in advance) comes before the maneuvers' one;
          // confirmed as is, it does not count as the expected answer.
          if ( /Savage Attacker|Sauvagerie martiale/i.test(`${d.title ?? ""} ${d.content ?? d.text ?? ""}`) ) {
            const s = (d.buttons ?? []).find(x => /Confirm|Frapper|Valider/i.test(x.label ?? ""));
            await ctx.call("answer-dialog", { id: d.id, button: s?.action ?? s?.label }).catch(() => {});
            ids.push(d.id);
            continue;
          }
          const b = (d.buttons ?? []).find(x => re.test(x.label ?? ""));
          if ( b ) { await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }); return { labels: (d.buttons ?? []).map(x => x.label) }; }
          // Many options: a dropdown list (adapter/choices.mjs, §113) and a "Confirm" button.
          for ( const f of (d.fields ?? []).filter(x => x.type === "select") ) {
            const o = (f.options ?? []).find(x => re.test(x.label ?? ""));
            if ( !o ) continue;
            await ctx.call("answer-dialog", { id: d.id, fields: { [f.name]: o.value }, button: "list" });
            return { labels: (f.options ?? []).map(x => x.label) };
          }
        }
      }
      return null;
    };
    /** Strikes until a hit, choosing the maneuver; returns what was seen. */
    const maneuver = async re => {
      for ( let n = 0; n < 15; n++ ) {
        await tough(); await clearBandit();
        const before = await spent();
        const ids = await known();
        const since = await ctx.lastMessageId();
        const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
        const asked = await answer(ids, re);
        const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Bandit")?.hit !== true ) continue;
        await pause(4000);
        const msgs = await ctx.messagesSince(since);
        const damage = msgs.find(m => m.type === "damage");
        const save = msgs.find(m => (m.type === "usage") && (m.id !== u.usageMessageId));
        return { asked, damage, save, msgs, before, after: await spent() };
      }
      return null;
    };

    // 1. Croc-en-jambe.
    const trip = await maneuver(/Croc|Trip/i);
    if ( ctx.expect(!!trip, "le Guerrier touche le Bandit (15 essais au plus)") ) {
      ctx.expect((trip.asked?.labels ?? []).some(l => /Croc|Trip/i.test(l)) && (trip.asked?.labels ?? []).some(l => /provoc|Goading/i.test(l)),
        `la question propose les manœuvres (${(trip.asked?.labels ?? []).join(", ")})`);
      const formula = (trip.damage?.rolls ?? []).map(x => x.formula).join(" | ");
      ctx.expect(/[12]d8/.test(formula), `+1d8 au jet de dégâts, 2d8 sur un critique (${formula})`);
      ctx.expect(trip.after === trip.before + 1, `un dé de supériorité dépensé (${trip.before} → ${trip.after})`);
      const res = trip.save ? await ctx.settle(trip.save.id).catch(() => null) : null;
      const t = res?.targets?.find(x => x.name === "Bandit");
      await pause(1200);
      const prone = (await ctx.effects(bandit)).some(e => !e.disabled && (e.statuses ?? []).includes("prone"));
      ctx.expect(res?.plan?.save?.ability === "str" && !!t?.save, `sauvegarde de Force du Bandit : ${t?.save?.total} contre DD ${res?.plan?.save?.dc}`);
      ctx.expect(prone === (t?.save?.success === false), `À terre ${prone ? "posé" : "absent"}, cohérent avec la sauvegarde (${t?.save?.success ? "réussie" : "ratée"})`);
    }

    // 2. Attaque provocante.
    const goad = await maneuver(/provoc|Goading/i);
    if ( ctx.expect(!!goad, "le Guerrier touche le Bandit (Attaque provocante)") ) {
      const res = goad.save ? await ctx.settle(goad.save.id).catch(() => null) : null;
      const t = res?.targets?.find(x => x.name === "Bandit");
      await pause(1500);
      const goaded = (await ctx.effects(bandit)).some(e => !e.disabled && /Goaded|Provoqu/i.test(e.name ?? ""));
      ctx.expect(res?.plan?.save?.ability === "wis" && !!t?.save, `sauvegarde de Sagesse du Bandit : ${t?.save?.total} contre DD ${res?.plan?.save?.dc}`);
      ctx.expect(goaded === (t?.save?.success === false), `Provoqué ${goaded ? "posé" : "absent"}, cohérent avec la sauvegarde (${t?.save?.success ? "réussie" : "ratée"})`);
      const damages = (await ctx.messagesSince(goad.damage?.id ?? goad.save?.id)).filter(m => m.type === "damage");
      ctx.expect(!damages.length, `la sauvegarde n'ajoute pas de dégâts (${damages.length} jet(s) de plus)`);
    }

    // 3. §88: Parry and Riposte, as Reactions to the Bandit's attacks (taken automatically: `autoReact: "first"`).
    await lend("phbmnvParry00000");
    await lend("phbmnvRiposte000");
    await pause(1200);
    await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    const hp0 = await ctx.hp(fighter);
    ctx.restore(() => ctx.setHp(fighter, hp0));
    const scimitar = await ctx.itemId(bandit.id, "scimitar");
    const banditAttack = async () => {
      await ctx.setHp(fighter, hp0); await tough(); await clearBandit();
      // Dice reset at each attack: the Ripostes of missed hits would use them up before the hit (Parry).
      await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
      const before = await spent();
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: bandit.id, itemId: scimitar, activityType: "attack", targetTokenIds: [fighter.id],
        usageConfig: { [MODULE_ID]: { autoReact: "first" } } });
      const ids = await known();
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      // A Riposte that hits opens the on-hit maneuvers question: "Nothing", otherwise its damage waits for the end of the delay
      // and lands during the next part.
      await answer(ids, /^Rien$|^Aucune|^None/i, 9000);   // same delay as `swing`: the default choice would replace the Riposte's die
      await pause(3000);
      // §438 continued: nothing from this attempt must land in the next one (Riposte damage arriving after the next attempt's
      // boundary was read as its own) — the chat quiet (no new message for 3 s), every maneuvers question answered.
      await quiet(ids);
      return { r, since, before, after: await spent(), hit: r?.targets?.find(t => t.name === "Guerrier")?.hit ?? null };
    };
    /** Waits until the chat stops moving for 3 s (20 s at most), answering "Nothing" to any maneuvers question. */
    async function quiet(ids) {
      let last = await ctx.lastMessageId(), still = Date.now();
      for ( const stop = Date.now() + 20000; (Date.now() < stop) && (Date.now() - still < 3000); ) {
        await answer(ids, /^Rien$|^Aucune|^None/i, 500);
        await pause(500);
        const now = await ctx.lastMessageId();
        if ( now !== last ) { last = now; still = Date.now(); }
      }
    }
    /** The Fighter's messages following their Riposte (their attack), up to their next attack: the attack, then its damage. */
    const riposteOf = msgs => {
      const mine = m => (m.alias === "Guerrier") || (m.speaker?.alias === "Guerrier");
      const at = msgs.findIndex(m => (m.type === "attack") && mine(m));
      if ( at < 0 ) return { counter: null, dmg: null };
      const rest = msgs.slice(at + 1);
      const end = rest.findIndex(m => (m.type === "attack") && mine(m));
      return { counter: msgs[at], dmg: (end < 0 ? rest : rest.slice(0, end)).find(m => (m.type === "damage") && mine(m)) ?? null };
    };

    // Parry: a hit — a die spent, the damage reduced by the Parry roll.
    let parried = null;
    for ( let n = 0; (n < 20) && !parried; n++ ) { const a = await banditAttack(); if ( a.hit === true ) parried = a; }
    if ( ctx.expect(!!parried, "le Bandit touche le Guerrier (20 essais au plus)") ) {
      const msgs = await ctx.messagesSince(parried.since);
      const reaction = msgs.find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.reaction && /Parade|Parry/i.test(m.flavor ?? m.speaker?.alias ?? JSON.stringify(m.system?.activity ?? "")));
      const t = parried.r?.targets?.find(x => x.name === "Guerrier");
      ctx.expect(parried.after === parried.before + 1, `Parade : un dé de supériorité dépensé (${parried.before} → ${parried.after})`);
      ctx.expect((t?.damage?.reduced ?? t?.reduced ?? 0) > 0 || (t?.damage?.applied ?? 99) < (t?.damage?.total ?? 0),
        `Parade : dégâts réduits (${JSON.stringify(t?.damage ?? null)})`);
      ctx.log(`carte de réaction : ${reaction ? "présente" : "non trouvée par le libellé"}`);
    }

    // Riposte: a miss — a die spent, an attack by the Fighter against the Bandit; on a hit, +1d8 damage.
    // Until a Riposte that hits (to see the die in the damage); failing that, the last one that took place.
    let riposted = null;
    for ( let n = 0; n < 25; n++ ) {
      const a = await banditAttack();
      if ( a.hit !== false ) continue;
      riposted = a;
      if ( riposteOf(await ctx.messagesSince(a.since)).dmg ) break;
      await ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    }
    if ( ctx.expect(!!riposted, "le Bandit rate le Guerrier (20 essais au plus)") ) {
      ctx.expect(riposted.after === riposted.before + 1, `Riposte : un dé de supériorité dépensé (${riposted.before} → ${riposted.after})`);
      const { counter, dmg } = riposteOf(await ctx.messagesSince(riposted.since));
      ctx.expect(!!counter, "Riposte : le Guerrier attaque le Bandit avec son arme");
      if ( dmg ) {
        const formula = (dmg.rolls ?? []).map(x => x.formula).join(" | ");
        ctx.expect(/1d8/.test(formula), `Riposte qui touche : +1d8 aux dégâts (${formula})`);
      } else ctx.log("la Riposte a raté : pas de jet de dégâts à contrôler");
    }

    // 4. §89: Bonus Action maneuvers (out of combat: the turn budget is not at stake here).
    await lend("phbmnvFeintingAt");
    await lend("phbmnvLungingAtt");
    await lend("phbmnvEvasiveFoo");
    await lend("phbmnvRally00000");
    await pause(1200);
    const refill = () => ctx.call("upsert-actor-item", { actorId: fighter.actorId, itemData: { "system.uses.spent": 0 }, match: { path: "_id", value: superiority } });
    const pendingFlag = async () => (await ctx.call("get-actor", { actorId: fighter.actorId })).flags?.[MODULE_ID]?.pendingDie ?? null;
    ctx.restore(() => ctx.call("update-actor", { actorId: fighter.actorId, actorData: { [`flags.${MODULE_ID}.-=pendingDie`]: null } }).catch(() => {}));
    const swing = async () => {
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: fighter.id, itemId: sword, activityType: "attack", targetTokenIds: [bandit.id] });
      // The on-hit maneuvers question: nothing. 9 s: past the delay, its default choice (Trip Attack) went off and, one maneuver
      // per attack, replaced the die promised to Feinting Attack.
      await answer(await known(), /^Rien$|^Aucune|^None/i, 9000);
      const r = await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const msgs = await ctx.messagesSince(since);
      return { hit: r?.targets?.find(t => t.name === "Bandit")?.hit ?? null, mode: msgs.find(m => m.type === "attack")?.rolls?.[0]?.options?.advantageMode ?? null,
        damage: (msgs.find(m => m.type === "damage")?.rolls ?? []).map(x => x.formula).join(" | ") };
    };

    // Feinting Attack: on the Bandit — no damage, the effect applied; the next attack has Advantage; if it hits, +1d8.
    const feint = await ctx.itemId(fighter.id, "feinting-attack");
    // The Bandit's hits (Parry, Riposte) may have left the Fighter at 0 HP, hence Prone: their Disadvantage would cancel the
    // Advantage of Feinting Attack. They are stood up beforehand.
    await ctx.setHp(fighter, hp0);
    for ( const s of ["unconscious", "prone"] ) await ctx.call("set-status", { tokenId: fighter.id, statusId: s, active: false }).catch(() => {});
    await pause(800);
    let feinted = null;
    for ( let n = 0; (n < 15) && !feinted; n++ ) {
      await tough(); await refill(); await clearBandit();
      const hpBefore = await ctx.hp(bandit);
      await ctx.use({ tokenId: fighter.id, itemId: feint, targetTokenIds: [bandit.id] });
      await pause(2500);
      const marked = (await ctx.effects(bandit)).some(e => /Feint/i.test(e.name ?? ""));
      const hpAfter = await ctx.hp(bandit);
      if ( n === 0 ) {
        ctx.expect(marked, "Feinte : l'effet est posé sur le Bandit");
        ctx.expect(hpAfter === hpBefore, `Feinte : aucun dégât à l'utilisation (${hpBefore} → ${hpAfter})`);
        ctx.expect((await pendingFlag())?.against === "target", "Feinte : le dé est promis contre le Bandit");
      }
      const a = await swing();
      if ( n === 0 ) ctx.expect(a.mode === 1, `Feinte : l'attaque suivante a l'Avantage (mode ${a.mode})`);
      if ( a.hit === true ) feinted = a;
      else if ( n === 0 ) ctx.expect(!(await pendingFlag()), "Feinte : l'attaque a raté, le dé promis est perdu");
    }
    if ( ctx.expect(!!feinted, "Feinte suivie d'un coup qui touche (15 essais au plus)") ) {
      ctx.expect(/[12]d8/.test(feinted.damage), `Feinte : +1d8 aux dégâts, 2d8 sur un critique (${feinted.damage})`);
    }
    await ctx.removeEffectsNamed(bandit, /Feint/i);

    // Lunging Attack: the die promised to the next melee hit.
    const lunge = await ctx.itemId(fighter.id, "lunging-attack");
    let lunged = null;
    for ( let n = 0; (n < 15) && !lunged; n++ ) {
      await tough(); await refill();
      if ( !(await pendingFlag()) ) await ctx.use({ tokenId: fighter.id, itemId: lunge });
      await pause(1500);
      if ( n === 0 ) ctx.expect((await pendingFlag())?.against === "melee", "Fente : le dé est promis au prochain coup au corps à corps");
      const a = await swing();
      if ( a.hit === true ) lunged = a;
    }
    if ( ctx.expect(!!lunged, "Fente suivie d'un coup qui touche (15 essais au plus)") ) {
      ctx.expect(/[12]d8/.test(lunged.damage), `Fente : +1d8 aux dégâts, 2d8 sur un critique (${lunged.damage})`);
      ctx.expect(!(await pendingFlag()), "Fente : la promesse est consommée");
    }

    // Evasive Footwork: the AC increases by the die.
    await refill();
    const ac0 = (await ctx.engine("stats", { tokenId: fighter.id }))?.ac ?? null;
    ctx.restore(() => ctx.removeEffectsNamed(fighter, /Evasive|évasif/i));
    await ctx.use({ tokenId: fighter.id, itemId: await ctx.itemId(fighter.id, "evasive-footwork") });
    await pause(4000);
    const ac1 = (await ctx.engine("stats", { tokenId: fighter.id }))?.ac ?? null;
    ctx.expect((ac0 !== null) && (ac1 > ac0) && (ac1 - ac0 <= 8), `Jeu de jambes évasif : CA ${ac0} → ${ac1} (+1d8)`);

    // Rally: Temporary Hit Points to the Cleric (ally).
    const ally = tokens.find(t => t.name === "Clerc") ? await ctx.token("Clerc") : null;
    if ( ally ) {
      await refill();
      const a0 = await ctx.call("get-actor", { actorId: ally.actorId });
      const temp0 = a0.system?.attributes?.hp?.temp ?? 0;
      ctx.restore(() => ctx.call("update-actor", { actorId: ally.actorId, actorData: { "system.attributes.hp.temp": temp0 } }).catch(() => {}));
      // Temporary Hit Points do not stack: without a reset to 0, a higher leftover than the roll would mask Rally.
      await ctx.call("update-actor", { actorId: ally.actorId, actorData: { "system.attributes.hp.temp": 0 } }).catch(() => {});
      const before = await spent();
      // `consume: true`: the die is spent as on click; the healing roll is made by the card (the connector cuts dnd5e's chaining:
      // `subsequentActions: false`), like `sorts-lot-1`.
      const u = await ctx.use({ tokenId: fighter.id, itemId: await ctx.itemId(fighter.id, "rally"), targetTokenIds: [ally.id], consume: true });
      await pause(800);
      if ( u.usageMessageId ) await ctx.engine("rollCard", { messageId: u.usageMessageId }).catch(() => null);
      // Awaited up to 12 s (healing roll by the card, then application by the active GM) rather than a fixed pause.
      const tempNow = async () => (await ctx.call("get-actor", { actorId: ally.actorId })).system?.attributes?.hp?.temp ?? 0;
      for ( let n = 0; (n < 24) && !((await tempNow()) > 0); n++ ) await pause(500);
      const temp1 = await tempNow();
      ctx.expect(temp1 > 0, `Ralliement : PV temporaires du Clerc 0 → ${temp1}`);
      ctx.expect((await spent()) === before + 1, "Ralliement : un dé de supériorité dépensé");
    }
  }
};
