/**
 * §555: the `combatEnded` and `creatureDefeated` signals, on the active GM. « Arène des refus », Mage and Dummy. Checks:
 *  1. the Dummy gets the `dead` status during a combat: `creatureDefeated` once, cause « dead », with this combat;
 *  2. placed again while still dead (a second dead effect): nothing more; status removed then placed again: announced again;
 *  3. the tracker's « defeated » ticked on the Mage: `creatureDefeated`, cause « tracker »;
 *  4. the combat ended: `combatEnded` once, round ≥ 1, both combatants listed, both defeated;
 *  5. a combat deleted before it began: no `combatEnded`.
 * Put back: statuses, tracker, hit points, combats.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "fin de combat et créature vaincue — signaux pour les voisins (§555)",
  scene: "Arène des refus",

  async run(ctx) {
    await ctx.scene();
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const hp0 = { mage: await ctx.hp(mage), dummy: await ctx.hp(dummy) };
    ctx.restore(async () => {
      for ( const t of [mage, dummy] ) await ctx.removeStatusEffects(t, "dead").catch(() => {});
      await ctx.setHp(mage, hp0.mage); await ctx.setHp(dummy, hp0.dummy);
    });
    await ctx.engine("combatOutcome", { action: "watch" });
    ctx.restore(() => ctx.engine("combatOutcome", { action: "stop" }).catch(() => {}));
    const heard = async (ms=1500) => { await pause(ms); return (await ctx.engine("combatOutcome", { action: "read" })).heard; };

    const started = await ctx.startCombat([mage, dummy]);
    let combat = await ctx.combat();
    if ( !(combat?.round > 0) ) { await ctx.nextTurn(); combat = await ctx.combat(); }
    ctx.log(`combat ${started?.id} round ${combat?.round}`);
    if ( !ctx.expect(combat?.round > 0, "le combat a commencé (round ≥ 1)") ) return;

    // 1. Dead during the combat.
    await ctx.call("set-status", { tokenId: dummy.id, statusId: "dead", active: true });
    let h = (await heard()).filter(e => e.hook === "creatureDefeated");
    ctx.log(JSON.stringify(h));
    ctx.expect((h.length === 1) && (h[0].token === dummy.id) && (h[0].cause === "dead") && (h[0].combat === ctx.ownCombat),
      "Mannequin mort : creatureDefeated une fois, cause « dead », avec ce combat");

    // 2. Still dead: nothing more; back then dead again: announced again.
    await ctx.call("set-status", { tokenId: dummy.id, statusId: "dead", active: true });
    h = (await heard()).filter(e => e.hook === "creatureDefeated");
    ctx.expect(h.length === 1, `déjà mort : rien de plus (${h.length})`);
    await ctx.removeStatusEffects(dummy, "dead");
    await ctx.setHp(dummy, hp0.dummy);
    await pause(1000);
    await ctx.call("set-status", { tokenId: dummy.id, statusId: "dead", active: true });
    h = (await heard()).filter(e => e.hook === "creatureDefeated" && e.token === dummy.id);
    ctx.expect(h.length === 2, `relevé puis mort de nouveau : annoncé de nouveau (${h.length})`);

    // 3. The tracker's « defeated » on the Mage.
    await ctx.engine("combatOutcome", { action: "tracker", combatId: ctx.ownCombat, tokenId: mage.id });
    h = (await heard()).filter(e => e.hook === "creatureDefeated" && e.token === mage.id);
    ctx.log(JSON.stringify(h));
    ctx.expect((h.length === 1) && (h[0].cause === "tracker"), "Mage marqué vaincu dans le suivi : creatureDefeated une fois, cause « tracker »");

    // 4. End of combat.
    const id = ctx.ownCombat;
    await ctx.call("end-combat", { combatId: id });
    ctx.ownCombat = null;
    const ends = (await heard(2000)).filter(e => e.hook === "combatEnded");
    ctx.log(JSON.stringify(ends));
    const end = ends[0];
    ctx.expect((ends.length === 1) && (end.combat === id) && (end.round >= 1), "combat terminé : combatEnded une fois, round ≥ 1");
    ctx.expect(!!end && [mage.id, dummy.id].every(t => end.combatants.some(x => x.token === t)), "les deux combattants sont listés");
    ctx.expect(!!end && end.defeated.includes(dummy.id), "le Mannequin est parmi les vaincus");

    // 5. A combat deleted before it began.
    await ctx.removeStatusEffects(dummy, "dead");
    await ctx.removeStatusEffects(mage, "dead");
    const before = (await heard(500)).filter(e => e.hook === "combatEnded").length;
    const made = await ctx.engine("combatOutcome", { action: "unstarted", tokenId: dummy.id })
      .catch(err => { ctx.log(`combat non commencé : ${err.message}`); return null; });
    const after = (await heard()).filter(e => e.hook === "combatEnded").length;
    ctx.expect(!!made && (after === before), `combat supprimé avant d'avoir commencé : pas de combatEnded (${before} → ${after})`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ (${JSON.stringify(errors).slice(0, 300)})`);
  }
};
