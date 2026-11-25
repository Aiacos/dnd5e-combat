/**
 * Kept in tools/scenarios/to-fix/ (outside the full pass) until issue #274 is fixed: these checks expect the other creatures
 * frozen during the extra turns, and fail on the code merged from PR #231. Play: `node tools/scenario.mjs tools/scenarios/to-fix`.
 * Time Stop (`extraTurns`, PR #231): the GM edits the combat in the middle of the caster's turns in a row. Zombi, Magicien,
 * Guerrier in that order; the Magicien is given two extra turns (the flag the cast writes, checked by `time-stop`).
 *  1. "Previous turn" during an extra turn goes back to the Zombi and consumes nothing; "next turn" gives the Magicien his turn
 *     again, still with one left; then the last one, then the Guerrier.
 *  2. The Zombi (before him in the order) is removed from the combat during an extra turn: the Magicien still gets his last
 *     turn, then the Guerrier plays.
 *  3. The Magicien dies during an extra turn (0 HP, Dead): his turns in a row stop, the next combatant plays.
 *  4. The Magicien is removed from the combat during an extra turn: the Guerrier plays, nothing is brought back.
 *  5. The combat ends during an extra turn: nothing is left on the caster.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Time Stop — previous turn, removed combatants, death and end of combat during the turns in a row",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Zombi or Guerrier missing: not applicable"); return; }
    const wizard = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    ctx.restore(() => script(`await canvas.tokens.get(args.id)?.actor?.unsetFlag("${MODULE_ID}", "extraTurns"); return true;`, { id: wizard.id }));
    const hp0 = await ctx.hp(wizard);
    ctx.restore(() => ctx.setHp(wizard, hp0));
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(wizard, s));

    const flag = () => script(`return canvas.tokens.get(args.id).actor.getFlag("${MODULE_ID}", "extraTurns") ?? null;`, { id: wizard.id });
    let cid = null;
    const state = () => script(`const c = game.combats.get(args.cid);
      return c ? { round: c.round, turn: c.turn, current: c.combatant?.tokenId ?? null } : null;`, { cid });
    const next = async () => { await ctx.nextTurn(); await pause(2500); return state(); };
    const name = id => ({ [wizard.id]: "Magicien", [zombi.id]: "Zombi", [fighter.id]: "Guerrier" }[id] ?? id);
    /** A fresh combat (Zombi, Magicien, Guerrier), at the Magicien's turn, with two extra turns given. */
    const setUp = async () => {
      if ( cid ) await ctx.call("end-combat", { combatId: cid }).catch(() => {});
      await pause(1000);
      await ctx.startCombat([wizard, zombi, fighter]);
      cid = ctx.ownCombat;
      const ids = await script(`return Object.fromEntries(game.combats.get(args.cid).combatants.map(x => [x.tokenId, x.id]));`, { cid });
      for ( const [token, value] of [[zombi, 20], [wizard, 15], [fighter, 10]] ) {
        await ctx.call("set-initiative", { combatantId: ids[token.id], value, combatId: cid });
      }
      for ( let i = 0; (i < 4) && ((await state()).current !== wizard.id); i++ ) await next();
      await script(`await canvas.tokens.get(args.id).actor.setFlag("${MODULE_ID}", "extraTurns", { combat: args.cid, left: 2, item: "Time Stop" }); return true;`,
        { id: wizard.id, cid });
      return ids;
    };
    const expectTurn = (s, who, label) => ctx.expect(s?.current === who.id, `${label}: ${name(who.id)} (${name(s?.current)}, ${JSON.stringify(s)})`);

    // 1. Previous turn.
    await setUp();
    if ( !ctx.expect((await state()).current === wizard.id, "1. the Magicien's turn") ) return;
    expectTurn(await next(), wizard, "1. end of the casting turn → extra turn 1");
    ctx.expect((await flag())?.left === 1, `1. one turn left (${JSON.stringify(await flag())})`);
    await script(`await game.combats.get(args.cid).previousTurn(); return true;`, { cid });
    await pause(2500);
    expectTurn(await state(), zombi, "1. previous turn → back to");
    ctx.expect((await flag())?.left === 1, `1. previous turn consumed nothing (${JSON.stringify(await flag())})`);
    expectTurn(await next(), wizard, "1. next turn → the Magicien's turn again");
    ctx.expect((await flag())?.left === 1, `1. ... still one turn left (${JSON.stringify(await flag())})`);
    expectTurn(await next(), wizard, "1. end of turn → his last extra turn");
    ctx.expect(!(await flag()), `1. no turn left (${JSON.stringify(await flag())})`);
    expectTurn(await next(), fighter, "1. end of his last turn → next in order");

    // 2. The Zombi, before him in the order, removed during an extra turn.
    let ids = await setUp();
    expectTurn(await next(), wizard, "2. extra turn 1");
    await script(`await game.combats.get(args.cid).combatants.get(args.zc).delete(); return true;`, { cid, zc: ids[zombi.id] });
    await pause(2000);
    expectTurn(await state(), wizard, "2. Zombi removed: still the turn of");
    expectTurn(await next(), wizard, "2. end of turn → his last extra turn");
    expectTurn(await next(), fighter, "2. then the next in order");

    // 3. The Magicien dies during an extra turn.
    ids = await setUp();
    expectTurn(await next(), wizard, "3. extra turn 1");
    await ctx.setHp(wizard, 0);
    await script(`const a = canvas.tokens.get(args.id).actor; if ( !a.statuses.has("dead") ) await a.toggleStatusEffect("dead", { active: true, overlay: true });
      await a.update({ "system.attributes.death.failure": 3 }); return true;`, { id: wizard.id });
    await pause(2000);
    const s3 = await next();
    ctx.expect(s3?.current !== wizard.id, `3. dead: his turns in a row stop, ${name(s3?.current)} plays (${JSON.stringify(s3)})`);
    ctx.log(`3. flag on the dead caster: ${JSON.stringify(await flag())}`);
    await script(`const a = canvas.tokens.get(args.id).actor; await a.update({ "system.attributes.death.failure": 0, "system.attributes.death.success": 0 }); return true;`, { id: wizard.id });
    await ctx.setHp(wizard, hp0);
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) await ctx.removeStatusEffects(wizard, s);

    // 4. The Magicien removed from the combat during an extra turn.
    ids = await setUp();
    expectTurn(await next(), wizard, "4. extra turn 1");
    await script(`await game.combats.get(args.cid).combatants.get(args.wc).delete(); return true;`, { cid, wc: ids[wizard.id] });
    await pause(2500);
    const s4 = await state();
    ctx.expect(s4?.current === fighter.id, `4. Magicien removed: the Guerrier plays (${name(s4?.current)})`);
    const s4b = await next();
    ctx.expect(s4b?.current !== wizard.id, `4. next turn: nothing brings him back (${name(s4b?.current)})`);
    ctx.log(`4. flag left on the removed caster: ${JSON.stringify(await flag())}`);

    // 5. The combat ends during an extra turn.
    await setUp();
    expectTurn(await next(), wizard, "5. extra turn 1");
    await ctx.call("end-combat", { combatId: cid });
    cid = null;
    await pause(2000);
    const left = await flag();
    ctx.expect(!left, `5. combat over: nothing left on the caster (${JSON.stringify(left)})`);
  }
};
