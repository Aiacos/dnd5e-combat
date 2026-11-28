/**
 * B01 (§483) — Multiattack: declared plan (`multiattackPlan`, set as a flag on the item) and exclusion group. The Brown
 * Bear from the Monster Manual receives the plan of "makes two melee attacks, only one of which can be a Bite attack":
 * two melee attacks, a single Bite (`kind:melee`, `except: ["identifier:bite"]`). On its turn: the Bite opens Multiattack
 * (1/2); a second Bite does not fit in the plan (legality flags it, the scenario confirms it automatically, the plan
 * stays at 1 use); the Claw fits (2/2).
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PLAN = { options: [[{ n: 1, refs: ["kind:melee"] }, { n: 1, refs: ["kind:melee"], except: ["identifier:bite"] }]] };

export default {
  name: "Attaques multiples — plan déclaré : deux attaques de mêlée, une seule Morsure",

  async run(ctx) {
    await ctx.cast({ "Ours brun": "mmBrownBear00000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Ours brun", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun ou Zombi absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const home = await ctx.position(zombi);
    const hp = await ctx.hp(zombi);
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.setHp(zombi, hp));
    ctx.restore(() => ctx.removeStatusEffects(zombi, "prone"));
    const at = await ctx.position(bear);
    await ctx.call("move-token", { tokenId: zombi.id, x: at.x + 2 * grid, y: at.y, elevation: at.elevation });

    // The declared plan, on the Multiattack item of the placed bear (item flag: the highest layer of `contentOf`).
    const flagged = await ctx.call("run-script", { code: `const item = canvas.tokens.get("${bear.id}").actor.items.find(i => i.system.identifier === "multiattack");
      if ( !item ) return null; await item.setFlag("${MODULE_ID}", "multiattackPlan", ${JSON.stringify(PLAN)}); return item.id;` });
    ctx.restore(() => ctx.call("run-script", { code: `const item = canvas.tokens.get("${bear.id}")?.actor?.items.find(i => i.system.identifier === "multiattack");
      await item?.unsetFlag("${MODULE_ID}", "multiattackPlan");` }).catch(() => {}));
    ctx.expect(!!(flagged?.result ?? flagged), `plan posé sur l'item Attaques multiples (${JSON.stringify(flagged)})`);

    await ctx.startCombat([bear, zombi]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === bear.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }
    const spentOn = async id => {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const m = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(x => x.id === id);
        const spent = m?.flags?.[MODULE_ID]?.spent ?? m?.flags?.spent;
        if ( spent ) return spent;
      }
      return null;
    };
    const strike = async identifier => {
      await ctx.setHp(zombi, 100);
      const used = await ctx.use({ tokenId: bear.id, identifier, activityType: "attack", targetTokenIds: [zombi.id] });
      await ctx.settle(used.usageMessageId).catch(() => null);
      return spentOn(used.usageMessageId);
    };

    const bite = await strike("bite");
    const options = bite?.after?.multi?.plan?.options ?? null;
    ctx.expect(!!bite?.after?.multi, `Morsure : Attaques multiples ouvertes (${JSON.stringify(options)})`);
    ctx.expect(JSON.stringify(options ?? []).includes("except"), "le plan ouvert est le plan déclaré (groupe à exclusion), pas la lecture du texte");
    ctx.expect((bite?.after?.attacks?.used === 1) && (bite?.after?.attacks?.granted === 2), `attaques ${bite?.after?.attacks?.used}/${bite?.after?.attacks?.granted}`);

    const second = await strike("bite");
    ctx.expect(second?.after?.multi?.used?.length === 1, `seconde Morsure : hors du plan, qui reste à 1 utilisation (${second?.after?.multi?.used?.length})`);

    const claw = await strike("claw");
    ctx.expect(claw?.after?.multi?.used?.length === 2, `Griffe : tient dans le plan (${claw?.after?.multi?.used?.length} utilisation(s))`);
  }
};
