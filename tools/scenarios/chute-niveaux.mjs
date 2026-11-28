/**
 * §218: fall from one level to a lower level, outside combat (automatic falling only acts in combat by default), on Restored
 * Keep: the stable's thatch roof is at 20 ft (Second Floor), the grassy yard to the east is at 0 (First Floor).
 *  1. Jump: from the roof, a long jump toward the yard — the Fighter lands above the void and immediately falls to the
 *     ground of the yard, on the ground floor, with dnd5e's fall damage (2d6 for 20 ft); it was left "Falling" in the air.
 *  2. Moving a "Falling" token: placed in the air above the yard, it first falls (damage included) instead of being snapped to the
 *     ground silently.
 * Resets position, level, HP, conditions.
 */
const MODULE_ID = "dnd5e-combat";
const FIRST = "rcWKCTvbgKJhN2DV";
const SECOND = "DlCYcaprf0tbAual";
const ROOF = { x: 4620, y: 4760 };        // the thatch roof, at the east edge
const YARD = { i: 34, j: 34 };            // the yard, to the east
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "keep",
  name: "chute d'un niveau à l'autre — après un saut, ou en bougeant un token en chute",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const reset = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      for ( const s of ["prone", "falling"] ) {
        await ctx.removeStatusEffects(hero, s);
        await ctx.call("set-status", { tokenId: hero.id, statusId: s, active: false }).catch(() => {});
      }
      await ctx.setHp(hero, hp0);
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await reset();
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: home.elevation ?? 0, levelId: home.level }).catch(() => {});
    });
    const tokenNow = async () => (await ctx.call("list-scene-objects", { type: "Token" })).objects.Token.find(t => t.id === hero.id);
    /** Waits for the arrival on the ground (dnd5e's fall waits for the end of the animation: up to 5 s, background window). */
    const landed = async () => {
      for ( let n = 0; n < 30; n++ ) {
        const t = await tokenNow();
        if ( (t.elevation ?? 0) === 0 ) { await pause(2500); return; }
        await pause(500);
      }
    };
    const fell = async (label, since) => {
      await landed();
      const pos = await tokenNow();
      // The damage follows the end of the 3D dice (waitForDice, 8 s at most): wait for them, otherwise they land after the reset
      // of the next step (seen on 2026-10-28: 13 → 13, then 13 → 0).
      let hp = await ctx.hp(hero);
      for ( let i = 0; (i < 24) && (hp >= hp0); i++ ) { await pause(500); hp = await ctx.hp(hero); }
      ctx.expect((pos.elevation ?? 0) === 0 && (pos.level === FIRST), `${label} : au sol de la cour (${pos.elevation} ft, niveau ${pos.level})`);
      ctx.expect((hp0 - hp >= 2) && (hp0 - hp <= 12), `${label} : 2d6 de chute appliqués (${hp0} → ${hp})`);
    };

    // 1. The jump from the roof to the yard.
    await ctx.call("move-token", { tokenId: hero.id, ...ROOF, elevation: 20, levelId: SECOND });
    await pause(1500);
    let since = await ctx.lastMessageId();
    const j = await ctx.engine("jump", { tokenId: hero.id, cell: YARD });
    ctx.expect(j.result?.done === true, `saut vers la cour (${JSON.stringify(j.result)}${j.warnings?.length ? ` — ${j.warnings.join(" ; ")}` : ""})`);
    await fell("après le saut", since);

    // 2. Moving a "Falling" token above the yard.
    await reset();
    await ctx.call("move-token", { tokenId: hero.id, x: 4760, y: 4760, elevation: 20, levelId: SECOND });
    await pause(1500);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "falling", active: true });
    await pause(800);
    since = await ctx.lastMessageId();
    await ctx.engine("move", { tokenId: hero.id, cell: { i: 34, j: 35 } }).catch(() => null);
    await fell("en bougeant un token en chute", since);

    // 3. §219: in combat, no run-up, Strength 8 (a 4 ft long jump) — the neighboring cell is lower: a step into the
    //    void, with no jump limit, one cell of movement, then the fall (the user's Warlock case, refused: "4 ft at most").
    await reset();
    const str0 = (await ctx.call("get-actor", { actorId: hero.actorId })).system?.abilities?.str?.value ?? null;
    ctx.restore(() => ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.abilities.str.value": str0 } }).catch(() => {}));
    await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.abilities.str.value": 8 } });
    await ctx.call("move-token", { tokenId: hero.id, ...ROOF, elevation: 20, levelId: SECOND });
    await pause(1500);
    await ctx.startCombat([hero]);
    await pause(1500);
    since = await ctx.lastMessageId();
    const step = await ctx.engine("jump", { tokenId: hero.id, cell: YARD });
    ctx.expect(step.result?.done === true, `en combat, Force 8, sans élan : le saut vers la case plus basse passe (${JSON.stringify(step.result)}${step.warnings?.length ? ` — ${step.warnings.join(" ; ")}` : ""})`);
    await fell("pas dans le vide en combat", since);
    const spent = (await ctx.engine("movement", { tokenId: hero.id })).combat?.spent;
    ctx.expect(spent === 5, `une case de déplacement dépensée (${spent})`);
  }
};
