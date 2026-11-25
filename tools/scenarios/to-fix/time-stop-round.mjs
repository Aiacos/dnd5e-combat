/**
 * Kept in tools/scenarios/to-fix/ (outside the full pass) until issue #274 is fixed: these checks expect the other creatures
 * frozen during the extra turns, and fail on the code merged from PR #231. Play: `node tools/scenario.mjs tools/scenarios/to-fix`.
 * Time Stop (`extraTurns`, PR #231) when the caster is the last of the round: his extra turns must not end the round for the
 * others. Zombi, Guerrier, Magicien in that order; the Magicien is given two extra turns (the flag the cast writes, checked by
 * `time-stop`).
 *  1. Each end of his turn brings him back, and the round number stays.
 *  2. No time passes for the others: no new round is announced (`combatRound`), the world clock does not move, and the Zombi
 *     (first of the next round) keeps its spent Reaction and its Dodge.
 *  3. After the last extra turn, the round ends for real: round + 1, one round announced, the clock moves one round, the Zombi
 *     plays with a fresh budget (control).
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Time Stop — the caster last in the round: the round does not end for the others",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Zombi or Guerrier missing: not applicable"); return; }
    const wizard = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    ctx.restore(() => script(`await canvas.tokens.get(args.id)?.actor?.unsetFlag("${MODULE_ID}", "extraTurns"); return true;`, { id: wizard.id }));

    await ctx.startCombat([wizard, zombi, fighter]);
    const cid = ctx.ownCombat;
    const ids = await script(`return Object.fromEntries(game.combats.get(args.cid).combatants.map(x => [x.tokenId, x.id]));`, { cid });
    for ( const [token, value] of [[zombi, 20], [fighter, 15], [wizard, 10]] ) {
      await ctx.call("set-initiative", { combatantId: ids[token.id], value, combatId: cid });
    }
    const state = () => script(`const c = game.combats.get(args.cid);
      return { round: c.round, turn: c.turn, current: c.combatant?.tokenId ?? null, time: game.time.worldTime };`, { cid });
    const next = async () => { await ctx.nextTurn(); await pause(2500); return state(); };
    for ( let i = 0; (i < 4) && ((await state()).current !== wizard.id); i++ ) await next();
    if ( !ctx.expect((await state()).current === wizard.id, "the Magicien's turn, last of the round") ) return;
    const s0 = await state();

    await script(`await canvas.tokens.get(args.id).actor.setFlag("${MODULE_ID}", "extraTurns", { combat: args.cid, left: 2, item: "Time Stop" }); return true;`,
      { id: wizard.id, cid });
    const zBudget = await ctx.engine("budget", { tokenId: zombi.id });
    const { combatantId: _c, cap: _cap, ...zb } = zBudget ?? {};
    await script(`await game.combats.get(args.cid).combatants.get(args.zc).setFlag("${MODULE_ID}", "turn", { ...args.budget, reaction: 0, dodging: true });
      window.__tsRounds = 0; window.__tsCombat = args.cid;
      if ( !window.__tsRoundHook ) window.__tsRoundHook = Hooks.on("combatRound", combat => { if ( combat.id === window.__tsCombat ) window.__tsRounds++; });
      return true;`, { cid, zc: ids[zombi.id], budget: zb });
    ctx.restore(() => script(`if ( window.__tsRoundHook ) Hooks.off("combatRound", window.__tsRoundHook); delete window.__tsRoundHook; return true;`));
    const rounds = () => script(`return window.__tsRounds;`);

    for ( let n = 1; n <= 2; n++ ) {
      const s = await next();
      ctx.expect((s.current === wizard.id) && (s.round === s0.round), `extra turn ${n}: the Magicien again, still round ${s0.round} (${JSON.stringify(s)})`);
      ctx.expect((await rounds()) === 0, `extra turn ${n}: no new round announced (${await rounds()})`);
      ctx.expect(s.time === s0.time, `extra turn ${n}: the world clock has not moved (${s.time - s0.time} s)`);
      const z = await ctx.engine("budget", { tokenId: zombi.id });
      ctx.expect((z?.reaction === 0) && (z?.dodging === true), `extra turn ${n}: the Zombi keeps its spent Reaction and its Dodge (${z?.reaction}, ${z?.dodging})`);
    }

    const s = await next();
    ctx.expect((s.current === zombi.id) && (s.round === s0.round + 1), `after the last extra turn: round ${s0.round + 1}, the Zombi plays (${JSON.stringify(s)})`);
    const roundTime = await script(`return CONFIG.time.roundTime;`);
    ctx.expect((await rounds()) === 1, `one round announced in all (control: ${await rounds()})`);
    ctx.expect(s.time - s0.time === roundTime, `the clock moved one round in all (control: +${s.time - s0.time} s, one round = ${roundTime} s)`);
    const z = await ctx.engine("budget", { tokenId: zombi.id });
    ctx.expect(((z?.reaction ?? 0) >= 1) && !z?.dodging, `the Zombi's turn: fresh budget (control: ${z?.reaction}, ${z?.dodging})`);
  }
};
