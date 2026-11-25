/**
 * Kept in tools/scenarios/to-fix/ (outside the full pass) until issue #274 is fixed: these checks expect the other creatures
 * frozen during the extra turns, and fail on the code merged from PR #231. Play: `node tools/scenario.mjs tools/scenarios/to-fix`.
 * Time Stop (SRD 5.2, `extraTurns`, PR #231): "No time passes for other creatures, while you take 1d4 + 1 turns in a row, during
 * which you can use actions and move as normal." Magicien, Zombi, Guerrier on the test arena; initiative Magicien, Zombi, Guerrier.
 *  1. Cast on the Magicien's turn: a visible roll of 2 to 5 turns, noted on the caster (then set to 2, so the run is repeatable).
 *  2. Each end of his turn brings the combat back to him, in the same round; his action and his movement are fresh each time.
 *  3. Meanwhile the Zombi is frozen: its spent Reaction and its Dodge stay;
 *     with Regeneration (lent from the Monster Manual Troll, when installed), it heals nothing. No turn of the Zombi is announced
 *     (`combatTurnChange` to the Zombi) while the Magicien plays.
 *  4. After the last turn the Zombi plays normally (control): its budget is fresh, it regenerates once.
 *  Logged, not checked (a ruling for the GM): whether the Zombi still threatens an opportunity attack during the extra turns.
 */
const MODULE_ID = "dnd5e-combat";
const TIME_STOP = "Compendium.dnd5e.spells24.Item.phbsplTimeStop00";
const TROLL = "Compendium.dnd-monster-manual.actors.Actor.mmTroll000000000";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Time Stop — turns in a row, the others frozen meanwhile",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi", "Guerrier"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien, Zombi or Guerrier missing: not applicable"); return; }
    const wizard = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const fighter = await ctx.token("Guerrier");
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 15000 }))?.result;
    const grid = await ctx.gridSize();
    const home = await ctx.position(wizard);
    const zHome = await ctx.position(zombi);
    ctx.restore(() => ctx.call("move-token", { tokenId: wizard.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.call("move-token", { tokenId: zombi.id, x: zHome.x, y: zHome.y, elevation: zHome.elevation }).catch(() => {}));
    ctx.restore(() => script(`await canvas.tokens.get(args.id)?.actor?.unsetFlag("${MODULE_ID}", "extraTurns"); return true;`, { id: wizard.id }));
    const zHp = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, zHp));

    await ctx.ensureItem(wizard, TIME_STOP, { system: { method: "atwill" } });

    // The Zombi next to the Magicien.
    await ctx.call("move-token", { tokenId: zombi.id, x: home.x + grid, y: home.y, elevation: home.elevation });

    // Regeneration lent to the Zombi (heals at the start of its turn), when the Monster Manual is there.
    let regen = false;
    const troll = await ctx.call("get-compendium-entry", { uuid: TROLL }).catch(() => null);
    const regenItem = troll?.data?.items?.find(i => i.system?.identifier === "regeneration");
    if ( regenItem ) {
      const { data: ztok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
      const { _id, folder, ownership, _stats, ...itemData } = regenItem;
      const up = await ctx.call("upsert-actor-item", { actorId: ztok.actorId, itemData, match: { path: "system.identifier", value: "regeneration" } });
      const itemId = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(zombi.id, "regeneration"));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: ztok.actorId, itemId }).catch(() => {}));
      regen = true;
    } else ctx.log("Monster Manual Troll not found: Regeneration not checked");

    await ctx.startCombat([wizard, zombi, fighter]);
    const cid = ctx.ownCombat;
    const ids = await script(`const c = game.combats.get(args.cid);
      return Object.fromEntries(c.combatants.map(x => [x.tokenId, x.id]));`, { cid });
    for ( const [token, value] of [[wizard, 20], [zombi, 15], [fighter, 10]] ) {
      await ctx.call("set-initiative", { combatantId: ids[token.id], value, combatId: cid });
    }
    const state = () => script(`const c = game.combats.get(args.cid);
      return { round: c.round, turn: c.turn, current: c.combatant?.tokenId ?? null };`, { cid });
    const next = async () => { await ctx.nextTurn(); await pause(2500); return state(); };
    const flag = () => script(`return canvas.tokens.get(args.id).actor.getFlag("${MODULE_ID}", "extraTurns") ?? null;`, { id: wizard.id });
    for ( let i = 0; (i < 4) && ((await state()).current !== wizard.id); i++ ) await next();
    if ( !ctx.expect((await state()).current === wizard.id, "the Magicien's turn") ) return;
    const round0 = (await state()).round;

    // A probe on the Zombi's turns: every turn start announced to it is counted.
    await script(`window.__tsStarts = 0; window.__tsCombat = args.cid; window.__tsZombi = args.z;
      if ( !window.__tsHook ) window.__tsHook = Hooks.on("combatTurnChange", (combat, prior, current) => {
        if ( (combat.id === window.__tsCombat) && (current?.combatantId === window.__tsZombi) ) window.__tsStarts++; });
      return true;`, { cid, z: ids[zombi.id] });
    ctx.restore(() => script(`if ( window.__tsHook ) Hooks.off("combatTurnChange", window.__tsHook); delete window.__tsHook; return true;`));

    // 1. The cast: a visible roll, the count noted on the caster.
    const before = await script(`return game.messages.contents.length;`);
    const used = await ctx.use({ tokenId: wizard.id, identifier: "time-stop" });
    ctx.expect(used?.used !== false, "Time Stop cast");
    await pause(2500);
    const rolled = await script(`return game.messages.contents.slice(args.before).filter(m => m.isRoll && /turns in a row|tours d'affilée/i.test(m.flavor ?? ""))
      .map(m => ({ flavor: m.flavor, total: m.rolls?.[0]?.total ?? null }));`, { before });
    ctx.expect(rolled.length === 1, `one roll card for the turns (${JSON.stringify(rolled)})`);
    const noted = await flag();
    ctx.expect(noted && (noted.combat === cid) && (noted.left >= 2) && (noted.left <= 5) && (noted.left === rolled[0]?.total),
      `the count is noted on the caster, 2 to 5 and equal to the roll (${JSON.stringify(noted)})`);
    // Repeatable from here: two extra turns.
    await script(`await canvas.tokens.get(args.id).actor.setFlag("${MODULE_ID}", "extraTurns", { combat: args.cid, left: 2, item: "Time Stop" }); return true;`,
      { id: wizard.id, cid });

    // The Zombi carries "until the start of its next turn" things: a spent Reaction, a Dodge.
    const zBudget = await ctx.engine("budget", { tokenId: zombi.id });
    const { combatantId: _c, cap: _cap, ...zb } = zBudget ?? {};
    await script(`const c = game.combats.get(args.cid).combatants.get(args.zc);
      await c.setFlag("${MODULE_ID}", "turn", { ...args.budget, reaction: 0, dodging: true });
      return true;`, { cid, zc: ids[zombi.id], budget: zb });
    if ( regen ) await ctx.setHp(zombi, 5);
    const zombiNow = async () => ({
      budget: await ctx.engine("budget", { tokenId: zombi.id }),
      hp: await ctx.hp(zombi),
      starts: await script(`return window.__tsStarts ?? null;`)
    });
    const z0 = await zombiNow();
    ctx.log(`Zombi before the extra turns: ${JSON.stringify({ ...z0, budget: { reaction: z0.budget?.reaction, dodging: z0.budget?.dodging } })}`);

    // The Magicien walks two squares on his casting turn.
    await ctx.engine("move", { tokenId: wizard.id, point: { x: home.x - 2 * grid + grid / 2, y: home.y + grid / 2 } }).catch(e => ctx.log(`move: ${e.message}`));
    const moved = await ctx.engine("movement", { tokenId: wizard.id });
    ctx.log(`casting turn: movement spent ${moved?.combat?.spent} ${moved?.combat?.units ?? ""}`);

    // 2. Two extra turns, in the same round.
    for ( let n = 1; n <= 2; n++ ) {
      const s = await next();
      ctx.expect((s.current === wizard.id) && (s.round === round0), `end of turn → the Magicien again, round ${round0} (extra turn ${n}: ${JSON.stringify(s)})`);
      const b = await ctx.engine("budget", { tokenId: wizard.id });
      ctx.expect(b?.action === 1, `extra turn ${n}: his action is back (${b?.action})`);
      const m = await ctx.engine("movement", { tokenId: wizard.id });
      ctx.expect((m?.combat?.spent ?? 0) === 0, `extra turn ${n}: his movement is fresh (spent ${m?.combat?.spent})`);
      const f = await flag();
      ctx.expect((n === 1) ? (f?.left === 1) : !f, `extra turn ${n}: ${(n === 1) ? "one turn left" : "no turn left, the flag is gone"} (${JSON.stringify(f)})`);
      if ( n === 1 ) {
        // Back next to the Zombi (placed, not walked), then: would a step away provoke it?
        await ctx.call("move-token", { tokenId: wizard.id, x: home.x, y: home.y, elevation: home.elevation });
        const threats = await ctx.engine("threats", { tokenId: wizard.id, point: { x: home.x - 3 * grid + grid / 2, y: home.y + grid / 2 } }).catch(() => null);
        ctx.log(`ruling for the GM, not checked: leaving the Zombi's reach during an extra turn, threats = ${JSON.stringify(threats)}`);
      }
      // 3. The Zombi stays frozen.
      const z = await zombiNow();
      ctx.expect((z.budget?.reaction === 0) && (z.budget?.dodging === true),
        `extra turn ${n}: the Zombi's spent Reaction and its Dodge stay (reaction ${z.budget?.reaction}, dodging ${z.budget?.dodging})`);
      if ( regen ) ctx.expect(z.hp === 5, `extra turn ${n}: the Zombi does not regenerate (5 → ${z.hp} HP)`);
      ctx.expect(z.starts === 0, `extra turn ${n}: no turn of the Zombi was announced (${z.starts})`);
    }

    // 4. Control: the Zombi's real turn.
    const s = await next();
    ctx.expect((s.current === zombi.id) && (s.round === round0), `after the last extra turn: the Zombi plays, round ${round0} (${JSON.stringify(s)})`);
    const z = await zombiNow();
    ctx.expect(((z.budget?.reaction ?? 0) >= 1) && !z.budget?.dodging, `the Zombi's turn starts: Reaction back, Dodge over (control: ${z.budget?.reaction}, ${z.budget?.dodging})`);
    if ( regen ) ctx.expect((z.hp > 5) && (z.hp <= 5 + 20), `the Zombi's turn starts: it regenerates once (control: 5 → ${z.hp} HP)`);
    ctx.expect(z.starts === 1, `exactly one turn of the Zombi announced in all (${z.starts})`);
  }
};
