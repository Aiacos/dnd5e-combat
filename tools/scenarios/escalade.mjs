/**
 * §192 (batch 1): climbing walls, on the "Escalade" scene of `dnd-6` (a vertical wall, a Surface ceiling at 20 ft on the west
 * half, a Surface floor, the Fighter against the wall, the Zombie just south of him, against the wall too).
 *  1. On the ground near the wall: "Climb" is possible; under a ceiling at 20 ft, 3 cells at most (head included).
 *  2. Climb 2 cells: elevation +10 ft, `climb` mode, "Climbing" status.
 *  3. Walk along the wall at that height to above the Zombie (three-dimensional occupancy: its cell is free at 10 ft).
 *  4. Drop: dnd5e's fall ("Fell 10 ft" card, 1d6 applied by the engine, Prone), ground mode, status removed.
 *  5. Knocked Prone while climbing: he falls (active GM), without moving himself.
 *  6. In combat (Speed 30, no climb speed): 2 cells cost 20 ft (×2, dnd5e's cost); one cell remains;
 *     asking for two climbs only one; then nothing.
 *  7. "House" rules: DC 15 Strength (Athletics) to climb (a failure: no climb), then each turn in combat (the GM's roll window
 *     is answered by the scenario; closed, the engine rolls without a window).
 * Restores the mode, the elevation, the HP, the climbing rules; the runner's net takes the rest.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  scene: "Escalade",
  name: "escalade — grimper au mur, marcher le long, chute, budget, règles maison",

  async run(ctx) {
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const state = () => ctx.engine("climbState", { tokenId: hero.id });
    const reset = async () => {
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk", [`flags.${MODULE_ID}.climb`]: null } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false }).catch(() => {});
      await ctx.setHp(hero, hp0).catch(() => {});
      await pause(600);
    };
    const rules = await ctx.engine("setting", { key: "climbRules", value: "2024" });
    ctx.restore(() => ctx.engine("setting", { key: "climbRules", value: rules?.before ?? "2024" }));
    ctx.restore(reset);
    const statusesOf = async () => (await ctx.effects(hero)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    /** dnd5e's roll window on the GM side (house rules): we validate it; if missing, the engine rolls windowless after the delay. */
    const answerRoll = async () => {
      for ( let i = 0; i < 15; i++ ) {
        const { windows = [] } = await ctx.call("list-dialogs", {}).catch(() => ({}));
        const w = windows.find(w => /RollConfiguration/i.test(w.className ?? "") || /athl/i.test(w.title ?? ""));
        if ( w ) {
          for ( const button of ["roll", "normal", "Roll", "Normal"] ) {
            if ( await ctx.call("answer-dialog", { id: w.id, button }).then(() => true).catch(() => false) ) return true;
          }
          await ctx.call("answer-dialog", { id: w.id, close: true }).catch(() => {});
          return true;
        }
        await pause(400);
      }
      return false;
    };

    // 1. Near the wall, on the ground.
    let s = await state();
    if ( !ctx.expect(s.walls.length >= 1 && s.canClimb, `au sol contre un mur (${s.walls.length} mur), peut grimper`) ) return;
    ctx.expect((s.room?.max === 3) && (s.room?.ceiling === 15), `plafond à 20 ft : 3 cases au plus, pieds à 15 ft au plus (max ${s.room?.max}, plafond ${s.room?.ceiling})`);
    ctx.expect((s.speed?.native === false) && (s.room?.multiplier === 2), `sans vitesse d'escalade : chaque case coûte le double (×${s.room?.multiplier})`);

    // 2. Monter de deux cases.
    const up = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
    if ( !ctx.expect(up.done && (up.after.elevation === home.elevation + 10) && (up.after.movementAction === "climb"),
      `monte de 2 cases : élévation ${up.after.elevation}, mode ${up.after.movementAction}`) ) return;
    await pause(1200);
    s = await state();
    ctx.expect(s.climbing && s.status && s.canClimb, `en escalade : statut « En escalade » ${s.status ? "posé" : "absent"}, peut monter encore`);
    ctx.expect(s.room?.max === 1, `sous le plafond, une case de plus au plus (max ${s.room?.max})`);

    // 3. Walk along the wall, above the Zombie (its cell is free at 10 ft: three-dimensional occupancy).
    const zc = (await ctx.engine("movement", { tokenId: zombi.id })).position.cell;
    const along = await ctx.engine("move", { tokenId: hero.id, cell: zc });
    ctx.expect((along.after.cell.i === zc.i) && (along.after.cell.j === zc.j) && (along.after.elevation === up.after.elevation) && (along.after.movementAction === "climb"),
      `marche le long du mur au-dessus du Zombi : case (${along.after.cell.i}, ${along.after.cell.j}), élévation ${along.after.elevation}, mode ${along.after.movementAction}`);
    const back = await ctx.engine("move", { tokenId: hero.id, cell: up.after.cell });
    ctx.expect((back.after.cell.i === up.after.cell.i) && (back.after.cell.j === up.after.cell.j) && (back.after.elevation === up.after.elevation), `revient à sa case, toujours à ${back.after.elevation} ft`);

    // 4. Drop: dnd5e's fall, its damage applied, Prone.
    await pause(1500);
    const since = await ctx.lastMessageId();
    const drop = await ctx.engine("dropDown", { tokenId: hero.id });
    await pause(4000);
    const hp1 = await ctx.hp(hero);
    const card = (await ctx.messagesSince(since)).find(m => (m.type === "damage") && m.rolls?.length);
    const dmg = card?.rolls?.[0]?.total ?? null;
    ctx.expect(drop.done && (drop.after.elevation === home.elevation) && (drop.after.movementAction !== "climb"), `se laisse tomber : élévation ${drop.after.elevation}, mode ${drop.after.movementAction}`);
    ctx.expect(!!card && (hp0 - hp1 === dmg), `chute de 10 ft : carte de dégâts de dnd5e (${dmg ?? "aucune"}), appliquée (PV ${hp0} → ${hp1})`);
    let statuses = await statusesOf();
    s = await state();
    ctx.expect(statuses.includes("prone") && !s.status && !s.falling, `À terre après des dégâts de chute ; plus « En escalade » ni « En chute » (${statuses.join(", ") || "aucun état"})`);
    await reset();

    // 5. Knocked Prone mid-climb: he falls.
    const up2 = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
    if ( ctx.expect(up2.done && (up2.after.elevation === home.elevation + 10), `remonte de 2 cases (${up2.after.elevation} ft)`) ) {
      await pause(1500);
      await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: true });
      let fell = null;
      for ( let i = 0; (i < 30) && !fell; i++ ) { await pause(500); const now = await state(); if ( now.position.elevation === home.elevation ) fell = now; }
      // Damage follows the end of the 3D dice (waitForDice, 8 s at most): we wait for it.
      let hp2 = await ctx.hp(hero);
      for ( let i = 0; (i < 24) && (hp2 >= hp0); i++ ) { await pause(500); hp2 = await ctx.hp(hero); }
      ctx.expect(!!fell && !fell.climbing && !fell.status, `mis À terre au mur : tombe au sol (élévation ${fell?.position.elevation ?? "—"}, mode ${fell?.position.movementAction ?? "—"}, statut escalade ${fell?.status ?? "—"})`);
      ctx.expect(hp2 < hp0, `la chute blesse (PV ${hp0} → ${hp2})`);
    }
    await reset();

    // 6. In combat: the turn's budget.
    await ctx.startCombat([hero]);
    await pause(1000);
    const m0 = await ctx.engine("movement", { tokenId: hero.id });
    if ( ctx.expect(m0.combat && (m0.combat.speed === 30), `en combat, Vitesse ${m0.combat?.speed ?? "?"} ft`) ) {
      const up3 = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
      const m1 = await ctx.engine("movement", { tokenId: hero.id });
      ctx.expect(up3.done && (m1.combat.spent === 20), `2 cases montées en combat : 20 ft dépensés (×2) — dépensé ${m1.combat.spent}`);
      s = await state();
      ctx.expect(s.room?.max === 1, `il reste 10 ft : une case de plus au plus (max ${s.room?.max})`);
      const up4 = await ctx.engine("climb", { tokenId: hero.id, cells: 2 });
      const m2 = await ctx.engine("movement", { tokenId: hero.id });
      ctx.expect(up4.done && (up4.after.elevation === home.elevation + 15) && (m2.combat.spent === 30), `en demander deux n'en monte qu'une : élévation ${up4.after.elevation}, dépensé ${m2.combat.spent}`);
      s = await state();
      ctx.expect(s.room?.max === 0, `déplacement épuisé : plus rien à monter (max ${s.room?.max})`);
    }
    await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
    ctx.ownCombat = null;
    await reset();

    // 7. "House" rules: DC 15 to climb, then each turn.
    await ctx.engine("setting", { key: "climbRules", value: "house" });
    const seen = { success: false, failure: false };
    for ( let n = 0; (n < 8) && !(seen.success && seen.failure); n++ ) {
      const pending = ctx.engine("climb", { tokenId: hero.id, cells: 1 }, { timeoutMs: 90000 });
      await answerRoll();
      const r = await pending;
      await pause(800);
      const now = await state();
      if ( r.done ) {
        seen.success = true;
        ctx.expect(now.climbing && (now.position.elevation === home.elevation + 5), `test réussi : grimpe (${now.position.elevation} ft)`);
        // Each turn in combat: the check is asked again at the start of its turn — from the combat start (its turn begins), then
        // each following turn. Done: the last check's time changed, or the flag left with the fall from a failure.
        const before = now.checkedAt;
        const since = await ctx.lastMessageId();
        await ctx.startCombat([hero]);
        let checked = null;
        for ( let i = 0; (i < 30) && !checked; i++ ) { await pause(500); const c = await state(); if ( c.checkedAt !== before ) checked = c; }
        ctx.expect(!!checked, `au début de son tour, le test est redemandé (${checked ? "fait" : "non fait"})`);
        if ( checked ) {
          // A failure's fall takes time (climbing status removed by the GM, end of animation, dnd5e fall): we wait for either
          // stable state, up to 12 s, rather than a fixed delay.
          let after = null, held = false, fallen = false;
          for ( let i = 0; i < 24; i++ ) {
            await pause(500);
            after = await state();
            held = after.climbing && (after.position.elevation === home.elevation + 5);
            fallen = !after.climbing && (after.position.elevation === home.elevation);
            if ( (held && (i >= 5)) || fallen ) break;
          }
          ctx.expect(held || fallen, `après le test : ${held ? "tient au mur" : fallen ? "a lâché prise et chute" : `état inattendu (élévation ${after.position.elevation}, mode ${after.position.movementAction})`}`);
          if ( held ) {
            const again = after.checkedAt;
            await ctx.nextTurn();
            let second = null;
            for ( let i = 0; (i < 30) && !second; i++ ) { await pause(500); const c = await state(); if ( c.checkedAt !== again ) second = c; }
            ctx.expect(!!second, `au tour suivant, le test est redemandé (${second ? "fait" : "non fait"})`);
          }
        }
        const msgs = await ctx.messagesSince(since);
        ctx.log(`${msgs.length} message(s) du moteur pendant les tests`);
        await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
        ctx.ownCombat = null;
      }
      else {
        seen.failure = true;
        ctx.expect(!now.climbing && (now.position.elevation === home.elevation), `test raté : pas de montée (${now.position.elevation} ft, mode ${now.position.movementAction})`);
      }
      await reset();
    }
    ctx.log(`règles maison : succès ${seen.success ? "vu" : "non vu"}, échec ${seen.failure ? "vu" : "non vu"} (jets aléatoires)`);
  }
};
