/**
 * §554: Flame Blade cast by a player — from a real player client (« claude player », opened by the test bench:
 * `players: true`), the player's own character (claude, a wizard with level 3 slots, token « Magicien » on the
 * « Arène de test ») casts « Evoke Blade »: the slot level window opens on the player's client, with « roll without dialog »
 * on and off (§106). The window is closed without casting. Its level 2 and 3 slots are refilled for the scenario. Off the
 * bench (no player client), not applicable.
 */
const MODULE_ID = "dnd5e-combat";
const FLAME_BLADE = "Compendium.dnd-players-handbook.spells.Item.phbsplFlameBlade";
const EVOKE = "OIU1htXAoSF0cU3U";

export default {
  name: "Flame Blade cast by a player: the slot level window opens (§554)",
  players: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien missing: not applicable"); return; }
    const wizard = await ctx.token("Magicien");
    const itemId = await ctx.ensureItem(wizard, FLAME_BLADE);
    // Slots of level 2 and 3 full for the scenario (the copied world may have spent them: the engine would refuse, rightly).
    const gm = code => ctx.call("run-script", { code: `const actor = game.actors.get(${JSON.stringify(wizard.actorId)});
${code}` });
    const slots0 = (await gm(`return { s2: actor.system.spells.spell2?.value ?? 0, s3: actor.system.spells.spell3?.value ?? 0,
      m3: actor.system.spells.spell3?.max ?? 0 };`))?.result ?? {};
    if ( !(slots0.m3 > 0) ) { ctx.log("the Magicien has no level 3 slot: not applicable"); return; }
    ctx.restore(() => gm(`await actor.update({ "system.spells.spell2.value": ${slots0.s2}, "system.spells.spell3.value": ${slots0.s3} }); return true;`));
    await gm(`await actor.update({ "system.spells.spell2.value": actor.system.spells.spell2.max, "system.spells.spell3.value": actor.system.spells.spell3.max }); return true;`);
    const auto0 = (await ctx.call("run-script", { code: `return game.settings.get("${MODULE_ID}", "autoUsage");` }))?.result;
    ctx.restore(() => ctx.call("run-script", { code: `await game.settings.set("${MODULE_ID}", "autoUsage", ${JSON.stringify(auto0)}); return true;` }));
    for ( const auto of [true, false] ) {
      await ctx.call("run-script", { code: `await game.settings.set("${MODULE_ID}", "autoUsage", ${auto}); return true;` });
      const r = await ctx.asPlayer(`
        const actor = game.actors.get(args.actorId);
        if ( !actor?.isOwner ) return { owner: false };
        // The lent spell reaches this client a moment after the GM created it.
        for ( let n = 0; (n < 50) && !actor.items.get(args.itemId); n++ ) await new Promise(r => setTimeout(r, 100));
        const activity = actor.items.get(args.itemId)?.system.activities?.get(args.evoke);
        if ( !activity ) return { owner: true, user: game.user.name, seen: [], missing: actor.items.map(i => i.id).includes(args.itemId) ? "activity" : "item" };
        const seen = [];
        const others = [];
        const id = Hooks.on("renderActivityUsageDialog", app => { seen.push(app.element?.querySelector?.("[name='spell.slot']") ? "slot" : "no-slot"); app.close(); });
        const any = Hooks.on("renderApplicationV2", app => { if ( app.constructor.name !== "ActivityUsageDialog" ) others.push(app.constructor.name + ":" + (app.title ?? "")); });
        let result;
        try { result = await Promise.race([activity.use().then(r => r ? "used" : "cancelled"), new Promise(r => setTimeout(() => r("timeout"), 6000))]); }
        finally { Hooks.off("renderActivityUsageDialog", id); Hooks.off("renderApplicationV2", any); }
        return { owner: true, user: game.user.name, seen, others, result };`, { actorId: wizard.actorId, itemId, evoke: EVOKE });
      if ( !r?.owner ) { ctx.log("the player does not own the Magicien: not applicable"); return; }
      ctx.expect((r.seen.length === 1) && (r.seen[0] === "slot"),
        `${r.user}, rolls without dialog ${auto ? "on" : "off"}: the slot level window opens (${JSON.stringify(r.seen)}${r.missing ? `, ${r.missing} missing` : ""}; use: ${r.result}; other windows: ${JSON.stringify(r.others ?? [])})`);
    }
  }
};
