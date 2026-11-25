/**
 * In to-fix/ until PR #264 is rebased and merged: on main the effect never ends.
 * PR #264 — Flesh Golem's Aversion to Fire and Water Elemental's Freeze (Monster Manual 2024 / SRD 5.2): the effect placed when the
 * creature takes Fire (Cold) damage lasts "until the end of its next turn". The copy the engine places keeps its source
 * (`_stats.duplicateSource`), so the entries' `effectEnds: bearerTurnEnd` applies to it.
 * Combat: Bandit, then the Golem, then the Elemental.
 *  1. On the Bandit's turn the Golem takes Fire damage, the Elemental Cold damage: each carries its effect.
 *  2. The Golem's turn: still there. Its turn ends: the Golem's effect is gone. Same for the Elemental.
 *  3. Fire damage during the Golem's own turn: the effect stays when that turn ends, and is gone when its next turn ends.
 */
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "damage-trait-effect-ends — Aversion to Fire, Freeze: until the end of the bearer's next turn (PR #264)",

  async run(ctx) {
    await ctx.cast({ "Golem de chair": "mmFleshGolem0000", "Élémentaire de l'eau": "mmWaterElemental" }, { near: "Bandit" });
    const { tokens } = await ctx.scene();
    const names = ["Golem de chair", "Élémentaire de l'eau", "Bandit"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log("Flesh Golem, Water Elemental or Bandit missing: not applicable"); return; }
    const golem = await ctx.token("Golem de chair");
    const elemental = await ctx.token("Élémentaire de l'eau");
    const bandit = await ctx.token("Bandit");
    for ( const t of [golem, elemental] ) {
      const hp = await ctx.hp(t);
      ctx.restore(() => ctx.setHp(t, hp));
      ctx.restore(async () => {
        for ( const e of await ctx.effectsFrom(t, "aversion-to-fire", "freeze") ) {
          await ctx.call("remove-embedded-effect", { uuid: `Actor.${t.actorId}`, effectId: e.id }).catch(() => {});
        }
      });
    }
    const averse = async () => (await ctx.effectsFrom(golem, "aversion-to-fire")).filter(e => !e.disabled);
    const frozen = async () => (await ctx.effectsFrom(elemental, "freeze")).filter(e => !e.disabled);

    await ctx.startCombat([bandit, golem, elemental]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[bandit, 30], [golem, 20], [elemental, 10]] ) {
      const c = combat.combatants.find(x => x.tokenId === token.id);
      await ctx.call("set-initiative", { combatantId: c.id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => { for ( let i = 0; (i < 4) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await pause(1200); } return (await current()) === token.id; };

    // 1. Damage on the Bandit's turn.
    if ( !ctx.expect(await turnOf(bandit), "Bandit's turn") ) return;
    await ctx.engine("hurt", { tokenId: golem.id, amount: 3, type: "fire" });
    await ctx.engine("hurt", { tokenId: elemental.id, amount: 3, type: "cold" });
    await pause(1500);
    ctx.expect((await averse()).length === 1, `Fire damage: the Golem carries Aversion to Fire's effect (${(await averse()).length})`);
    ctx.expect((await frozen()).length === 1, `Cold damage: the Elemental carries Freeze's effect (${(await frozen()).length})`);

    // 2. Their next turns.
    if ( !ctx.expect(await turnOf(golem), "Golem's turn") ) return;
    await pause(1500);
    ctx.expect((await averse()).length === 1, "during the Golem's next turn: the effect is still there");
    if ( !ctx.expect(await turnOf(elemental), "Elemental's turn (the Golem's has ended)") ) return;
    await pause(1500);
    ctx.expect(!(await averse()).length, "the Golem's turn has ended: Aversion to Fire's effect is gone");
    ctx.expect((await frozen()).length === 1, "during the Elemental's next turn: Freeze's effect is still there");
    await ctx.nextTurn();
    await pause(2000);
    ctx.expect(!(await frozen()).length, "the Elemental's turn has ended: Freeze's effect is gone");

    // 3. Fire damage during the Golem's own turn: it lasts until the end of its NEXT turn.
    if ( !ctx.expect(await turnOf(golem), "Golem's turn, round 2") ) return;
    await ctx.engine("hurt", { tokenId: golem.id, amount: 3, type: "fire" });
    await pause(1500);
    ctx.expect((await averse()).length === 1, "Fire damage during its own turn: the effect is placed");
    await ctx.nextTurn();
    await pause(2000);
    ctx.expect((await averse()).length === 1, "the turn it was placed in has ended: the effect stays");
    if ( !ctx.expect(await turnOf(golem), "Golem's turn, round 3") ) return;
    await ctx.nextTurn();
    await pause(2000);
    ctx.expect(!(await averse()).length, "its next turn has ended: the effect is gone");
  }
};
