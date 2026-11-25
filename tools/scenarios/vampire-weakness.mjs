/**
 * PR #265 — Vampire Weakness (Vampire, Vampire Spawn; SRD 5.2): "takes 20 Radiant damage if it starts its turn in sunlight. While
 * in sunlight, it has Disadvantage on attack rolls and ability checks." / "takes 20 Acid damage if it ends its turn in running
 * water." Test arena (broad daylight), a Vampire Spawn placed from the Monster Manual; facts `self.inSunlight` /
 * `self.inRunningWater` as in `faits-soi-soleil-eau` (§484).
 *  1. In sunlight: an ability check rolls with Disadvantage.
 *  2. Its turn starts in sunlight: a self-damage card from `vampire-weakness`, 20 Radiant.
 *  3. It moves into a darkness region over running water: no Disadvantage; its turn ends: a self-damage card, 20 Acid.
 *  4. Its next turn starts there (shade, water): no Radiant damage.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "vampire-weakness — sunlight at turn start, running water at turn end, Disadvantage on checks (PR #265)",

  async run(ctx) {
    await ctx.cast({ "Vampirien": "mmVampireSpawn00" }, { near: "Bandit" });
    const { tokens, sceneId } = await ctx.scene();
    if ( !["Vampirien", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Vampire Spawn or Bandit missing: not applicable"); return; }
    const spawn = await ctx.token("Vampirien");
    const bandit = await ctx.token("Bandit");
    const grid = await ctx.gridSize();
    for ( const t of [spawn, bandit] ) {
      const p = await ctx.position(t);
      ctx.restore(() => ctx.call("move-token", { tokenId: t.id, x: p.x, y: p.y, elevation: p.elevation }).catch(() => {}));
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
    }

    // 1. In sunlight: Disadvantage on an ability check.
    const light = (await ctx.engine("stealth", { tokenId: spawn.id }))?.light;
    if ( light !== 2 ) ctx.log(`light at the start: ${light} (is the arena not in daylight?)`);
    const sunny = await ctx.engine("rollCheck", { tokenId: spawn.id, ability: "str" });
    ctx.expect(/kl|dis/.test(sunny?.formula ?? ""), `in sunlight: Strength check with Disadvantage ("${sunny?.formula}")`);

    // 2. Combat: Bandit first, then the Spawn — its turn starts in sunlight.
    await ctx.startCombat([bandit, spawn]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[bandit, 20], [spawn, 10]] ) {
      const c = combat.combatants.find(x => x.tokenId === token.id);
      await ctx.call("set-initiative", { combatantId: c.id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    for ( let i = 0; (i < 3) && ((await current()) !== bandit.id); i++ ) { await ctx.nextTurn(); await pause(800); }
    if ( !ctx.expect((await current()) === bandit.id, "Bandit's turn") ) return;
    const selfCards = async since => (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.selfDamage?.item === "vampire-weakness");
    await ctx.setHp(spawn, 60);
    let mark = await ctx.lastMessageId();
    await ctx.nextTurn();
    await pause(3000);
    let cards = await selfCards(mark);
    ctx.expect(cards.length === 1, `the Spawn's turn starts in sunlight: one Vampire Weakness damage card (${cards.length})`);
    ctx.expect(cards.some(m => m.flags[MODULE_ID].selfDamage.moment === "startOfTurn"), "the card is the start-of-turn one");
    await pause(800);
    let hp = await ctx.hp(spawn);
    ctx.expect(hp === 40, `Spawn's Hit Points: ${hp} (60 − 20 Radiant, no Regeneration in sunlight)`);

    // 3. Into a darkness region over running water, during its turn.
    const p = await ctx.position(spawn);
    const spot = { x: p.x + grid * 4, y: p.y };
    const water = await ctx.call("create-region", { sceneId, name: "Running water (test)", color: "#3a7bd5",
      shapes: [{ type: "rectangle", x: spot.x - grid, y: spot.y - grid, width: grid * 3, height: grid * 3 }], behaviors: [] });
    const waterId = water?.id ?? water?.regionId ?? water?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: waterId }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Region", objectId: waterId, data: { "flags.dnd5e-combat.runningWater": true } });
    const dark = await ctx.call("create-region", { sceneId, name: "Darkness (test)", color: "#000000",
      shapes: [{ type: "rectangle", x: spot.x - grid, y: spot.y - grid, width: grid * 3, height: grid * 3 }],
      behaviors: [{ type: "adjustDarknessLevel", name: "Darkness", system: { mode: 0, modifier: 1 } }] });
    const darkId = dark?.id ?? dark?.regionId ?? dark?.region?.id;
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: darkId }).catch(() => {}));
    await ctx.call("move-token", { tokenId: spawn.id, x: spot.x, y: spot.y, elevation: p.elevation });
    await pause(1500);
    ctx.log(`light in the shade: ${(await ctx.engine("stealth", { tokenId: spawn.id }))?.light}`);
    const shaded = await ctx.engine("rollCheck", { tokenId: spawn.id, ability: "str" });
    ctx.expect(!/kl|dis/.test(shaded?.formula ?? ""), `in the shade: Strength check without Disadvantage ("${shaded?.formula}")`);

    await ctx.setHp(spawn, 60);
    mark = await ctx.lastMessageId();
    await ctx.nextTurn();   // the Spawn's turn ends in running water
    await pause(3000);
    cards = await selfCards(mark);
    ctx.expect(cards.some(m => m.flags[MODULE_ID].selfDamage.moment === "endOfTurn"), `its turn ends in running water: an end-of-turn damage card (${cards.map(m => m.flags[MODULE_ID].selfDamage.moment).join(", ") || "none"})`);
    await pause(800);
    hp = await ctx.hp(spawn);
    ctx.expect(hp === 40, `Spawn's Hit Points: ${hp} (60 − 20 Acid)`);

    // 4. Its next turn starts in the shade, in the water: no Radiant damage (and no Regeneration, running water).
    await ctx.setHp(spawn, 60);
    mark = await ctx.lastMessageId();
    for ( let i = 0; (i < 3) && ((await current()) !== spawn.id); i++ ) { await ctx.nextTurn(); await pause(2000); }
    if ( !ctx.expect((await current()) === spawn.id, "the Spawn's turn again") ) return;
    await pause(1500);
    cards = (await selfCards(mark)).filter(m => m.flags[MODULE_ID].selfDamage.moment === "startOfTurn");
    ctx.expect(!cards.length, `its turn starts in the shade: no sunlight damage (${cards.length} card(s))`);
    ctx.expect((await ctx.hp(spawn)) === 60, `Spawn's Hit Points unchanged (${await ctx.hp(spawn)})`);
  }
};
