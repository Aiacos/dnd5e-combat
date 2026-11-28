/**
 * Time Stop (`extraTurns`, PR #231) played by a PLAYER (real "claude player" client, owner of the Mage des refus, opened by the
 * test bench: `players: true`). "Arène des refus" (`node tools/arene-refus.mjs`): Mage des refus, Mannequin des refus,
 * Guerrier des refus.
 *  1. The player casts Time Stop from their client: the roll card is there, the count is noted on the Mage (written by the GM).
 *  2. The player ends their turn from their client ("End Turn" = `combat.nextTurn()`): the active GM brings the combat back to the
 *     Mage — seen the same way on the GM and on the player client —, until the turns are spent, then the Mannequin plays.
 */
const MODULE_ID = "dnd5e-combat";
const TIME_STOP = "Compendium.dnd5e.spells24.Item.phbsplTimeStop00";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Time Stop — cast and played by a player, the GM gives the turns back",
  scene: "Arène des refus",
  players: true,

  async run(ctx) {
    const { sceneId, tokens } = await ctx.scene();
    if ( !["Mage des refus", "Mannequin des refus", "Guerrier des refus"].every(n => tokens.some(t => t.name === n)) ) {
      ctx.log("Mage, Mannequin or Guerrier des refus missing: not applicable"); return;
    }
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const guard = await ctx.token("Guerrier des refus");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    ctx.restore(() => script(`await canvas.tokens.get(args.id)?.actor?.unsetFlag("${MODULE_ID}", "extraTurns"); return true;`, { id: mage.id }));
    const itemId = await ctx.ensureItem(mage, TIME_STOP, { system: { method: "atwill" } });
    const { data: mtok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });

    await ctx.startCombat([mage, dummy, guard]);
    const cid = ctx.ownCombat;
    const ids = await script(`return Object.fromEntries(game.combats.get(args.cid).combatants.map(x => [x.tokenId, x.id]));`, { cid });
    for ( const [token, value] of [[mage, 20], [dummy, 15], [guard, 10]] ) {
      await ctx.call("set-initiative", { combatantId: ids[token.id], value, combatId: cid });
    }
    const gmState = () => script(`const c = game.combats.get(args.cid); return { round: c.round, turn: c.turn, current: c.combatant?.tokenId ?? null };`, { cid });
    for ( let i = 0; (i < 4) && ((await gmState()).current !== mage.id); i++ ) { await ctx.nextTurn(); await pause(2000); }
    if ( !ctx.expect((await gmState()).current === mage.id, "the Mage's turn") ) return;
    const round0 = (await gmState()).round;

    const who = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) { await scene.view(); await new Promise(r => setTimeout(r, 4000)); }
      const c = game.combats.get(args.cid);
      return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null,
        owner: !!c?.combatant?.isOwner, active: !!game.modules.get("${MODULE_ID}")?.api?.active };`, { scene: sceneId, cid });
    ctx.log(`player client: ${JSON.stringify(who)}`);
    if ( !ctx.expect(!who.gm && who.owner && who.activeGM && who.active, "a player client owning the Mage, an active GM, the Core active") ) return;

    // 1. The player casts Time Stop.
    const before = await script(`return game.messages.contents.length;`);
    const cast = await ctx.asPlayer(`
      try {
        const item = game.actors.get(args.actor).items.get(args.item);
        const activity = item.system.activities.contents[0];
        const r = await activity.use({ "${MODULE_ID}": { confirmed: true, autoReact: "none" } }, { configure: false }, {});
        return { ok: true, message: r?.message?.id ?? null };
      } catch(err) { return { error: String(err?.stack ?? err).slice(0, 600) }; }`, { actor: mtok.actorId, item: itemId });
    ctx.expect(cast?.ok, `the player casts Time Stop (${JSON.stringify(cast)})`);
    await pause(3000);
    const rolled = await script(`return game.messages.contents.slice(args.before).filter(m => m.isRoll && /turns in a row|tours d'affilée/i.test(m.flavor ?? ""))
      .map(m => ({ total: m.rolls?.[0]?.total ?? null, author: m.author?.name ?? null }));`, { before });
    ctx.expect(rolled.length === 1, `one roll card for the turns (${JSON.stringify(rolled)})`);
    const noted = await script(`return canvas.tokens.get(args.id).actor.getFlag("${MODULE_ID}", "extraTurns") ?? null;`, { id: mage.id });
    ctx.expect(noted?.left >= 2, `the count is noted on the Mage (${JSON.stringify(noted)})`);
    // Repeatable: two extra turns.
    await script(`await canvas.tokens.get(args.id).actor.setFlag("${MODULE_ID}", "extraTurns", { combat: args.cid, left: 2, item: "Time Stop" }); return true;`,
      { id: mage.id, cid });

    // 2. The player ends their turn, three times.
    const playerEnds = () => ctx.asPlayer(`
      try { await game.combats.get(args.cid).nextTurn(); } catch(err) { return { error: String(err?.message ?? err) }; }
      await new Promise(r => setTimeout(r, 3000));
      const c = game.combats.get(args.cid);
      return { round: c.round, turn: c.turn, current: c.combatant?.tokenId ?? null, mine: !!c.combatant?.isOwner };`, { cid });
    for ( let n = 1; n <= 2; n++ ) {
      const p = await playerEnds();
      const g = await gmState();
      ctx.expect((p?.current === mage.id) && (p?.round === round0) && p?.mine, `player ends turn → their Mage again on the player client (extra turn ${n}: ${JSON.stringify(p)})`);
      ctx.expect((g.current === mage.id) && (g.round === round0), `... and on the GM client (${JSON.stringify(g)})`);
    }
    const p = await playerEnds();
    const g = await gmState();
    ctx.expect((p?.current === dummy.id) && (g.current === dummy.id), `turns spent: the Mannequin plays, on both clients (player ${JSON.stringify(p)}, GM ${JSON.stringify(g)})`);
  }
};
