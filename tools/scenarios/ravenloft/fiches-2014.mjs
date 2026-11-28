/**
 * 2014-format sheets (inventory of 2026-10-03, world `ravenloft` / `ravenloft-test2`) — two general defects fixed:
 *  - Multiple attacks recognized by the RESOLVED identifier: Arrigal ("Multiattack" without identifier, readable English text:
 *    "makes two Shortsword attacks") opens 2 attacks; the Werewolf ("Attaque multiple", unreadable French text) is no
 *    longer capped at one attack (with no readable plan, the engine does not limit).
 *  - Save on hit in the 2014 format: Arrigal's Shortsword ("Hit: … and the target must make a DC 15 Constitution
 *    saving throw") and the Werewolf's Claws ("Hit: … it must succeed on a DC 13 Strength saving throw")
 *    chain their save.
 * Arrigal and a Werewolf are placed near the Zombie for the scenario, then removed. The rolls are random: we replay
 * until a hit.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "fiches 2014 — Attaques multiples sans identifiant ou traduites, sauvegarde au toucher",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Zombi") ) { ctx.log("Zombi absent : non applicable"); return; }
    const out = await ctx.call("list-actors", {});
    const actors = Array.isArray(out) ? out : (out.actors ?? Object.values(out).find(Array.isArray));
    const arrigalActor = actors.find(a => a.name === "Arrigal");
    const wolfActor = actors.find(a => a.name === "Loup-garou");
    if ( !arrigalActor || !wolfActor ) { ctx.log("Arrigal ou Loup-garou absent du monde : non applicable"); return; }

    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const at = await ctx.position(zombi);
    const hp = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp));
    for ( const s of ["prone", "poisoned", "dead", "unconscious"] ) ctx.restore(() => ctx.removeStatusEffects(zombi, s));

    const place = async (actorId, dx) => {
      const before = new Set((await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.map(t => t.id));
      await ctx.call("place-token", { actorId, x: at.x + dx * grid, y: at.y });
      const token = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.find(t => !before.has(t.id));
      ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: token.id }).catch(() => {}));
      return token;
    };
    const arrigal = await place(arrigalActor.id, 1);
    const wolf = await place(wolfActor.id, -1);
    const itemNamed = async (token, re) => ((await ctx.call("get-actor", { actorId: token.actorId })).items ?? []).find(i => re.test(i.name))?._id;
    const sword = await itemNamed(arrigal, /^(Shortsword|Épée courte)$/);
    const claws = await itemNamed(wolf, /^Griffes$/);
    const bite = await itemNamed(wolf, /^Morsure$/);
    if ( !ctx.expect(!!(sword && claws && bite), "Épée courte d'Arrigal, Griffes et Morsure du Loup-garou trouvées") ) return;

    await ctx.startCombat([arrigal, wolf, zombi]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[arrigal, 20], [wolf, 15], [zombi, 1]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => {
      for ( let i = 0; (i < 4) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1200); }
      return (await current()) === token.id;
    };
    const spentOn = async id => {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const m = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(x => x.id === id);
        const spent = m?.flags?.[MODULE_ID]?.spent ?? m?.flags?.spent;
        if ( spent ) return spent;
      }
      return null;
    };
    const strike = async (token, itemId) => {
      await ctx.setHp(zombi, 100);
      const used = await ctx.use({ tokenId: token.id, itemId, activityType: "attack", targetTokenIds: [zombi.id],
        usageConfig: { [MODULE_ID]: { saveChoice: "best" } } });
      const res = await ctx.settle(used.usageMessageId).catch(() => null);
      return { spent: await spentOn(used.usageMessageId), res };
    };

    // Arrigal: 2 attacks opened; the Shortsword chains its save.
    if ( !ctx.expect(await turnOf(arrigal), "tour d'Arrigal") ) return;
    const first = await strike(arrigal, sword);
    ctx.expect(!!first.spent?.after?.multi, `Arrigal : Attaques multiples ouvertes (${JSON.stringify(first.spent?.after?.multi?.plan?.options ?? null)})`);
    ctx.expect(first.spent?.after?.attacks?.granted === 2, `Arrigal : 2 attaques (${first.spent?.after?.attacks?.used}/${first.spent?.after?.attacks?.granted})`);
    const second = await strike(arrigal, sword);
    ctx.expect(second.spent?.after?.attacks?.used === 2, `Arrigal : seconde Épée courte dans le plan (${second.spent?.after?.attacks?.used}/${second.spent?.after?.attacks?.granted})`);
    const swordSave = [first, second].map(s => s.res?.plan?.save).find(Boolean);
    ctx.expect(swordSave?.chained === true, `Épée courte : sauvegarde enchaînée au toucher (${swordSave?.abilities?.join("/") ?? "—"} DD ${swordSave?.dc ?? "—"})`);

    // Werewolf: no longer capped at one attack; the Claws chain their Strength save.
    if ( !ctx.expect(await turnOf(wolf), "tour du Loup-garou") ) return;
    const claw = await strike(wolf, claws);
    ctx.expect((claw.spent?.after?.attacks?.granted ?? 0) >= 2, `Loup-garou : plus d'une attaque par action (${claw.spent?.after?.attacks?.used}/${claw.spent?.after?.attacks?.granted})`);
    const bitten = await strike(wolf, bite);
    ctx.expect((bitten.spent?.after?.attacks?.used ?? 0) === 2 && (bitten.spent?.after?.action ?? 0) === 0, `Loup-garou : la Morsure est sa deuxième attaque, sans nouvelle action (${bitten.spent?.after?.attacks?.used} attaques, action ${bitten.spent?.before?.action} → ${bitten.spent?.after?.action})`);
    ctx.expect(claw.res?.plan?.save?.chained === true, `Griffes : sauvegarde enchaînée au toucher (${claw.res?.plan?.save?.abilities?.join("/") ?? "—"} DD ${claw.res?.plan?.save?.dc ?? "—"})`);
  }
};
