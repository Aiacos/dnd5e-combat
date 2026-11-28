/**
 * "castsSpell" gate (SPEC §16, B5 bis): Counterspell given to the Zombie for the duration of the scenario. The Wizard casts
 * Fire Bolt on it with `autoReact` (the NPC reacts without a window): the Zombie counters, the Wizard makes its
 * Constitution save (engine); on a failure → the spell is dispelled, no attack; on a success → the Fire Bolt
 * goes off. Replayed until both outcomes are seen; the gate card (flag `gate`) says what happened.
 */
export default {
  name: "contresort — un hostile contre le Rayon de givre du Magicien",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    // The counter-caster: the NPC Mage (MM 2024, hostile, Counterspell with a spell slot) if it is on the scene — its
    // level 3 spell slots are set back to 3 for the duration of the scenario (zero on the sheet as imported, and dnd5e
    // refuses the use without a slot); otherwise the Zombie, with an "at will" Counterspell.
    const { tokens } = await ctx.scene();
    let refill = null;
    const mageNpc = tokens.find(t => (t.name === "Mage") && !t.hidden);
    if ( mageNpc ) {
      // The MM 2024 Mage has no spell slots (max 0): Counterspell consumes one, dnd5e refuses without. We give it
      // three by override (`override`), as a GM would on the sheet, and give everything back at the end.
      const spell3 = (await ctx.call("get-actor", { actorId: mageNpc.actorId })).system?.spells?.spell3 ?? {};
      const before = { "system.spells.spell3.value": spell3.value ?? 0, "system.spells.spell3.override": spell3.override ?? null };
      await ctx.call("update-actor", { actorId: mageNpc.actorId, actorData: { "system.spells.spell3.override": 3, "system.spells.spell3.value": 3 } });
      ctx.restore(() => ctx.call("update-actor", { actorId: mageNpc.actorId, actorData: before }).catch(() => {}));
      // The arena's Mage is an UNLINKED token: its Protective Magic (§66, Counterspell without a slot) lives in its copy, which the
      // previous passes had exhausted (3/3 on 2026-10-06 — the safety net restores the state at the START, already exhausted):
      // no more Counterspell offered. We reset its uses to zero for the duration of the scenario, and give back what was there.
      const { data: mageToken } = await ctx.call("get-scene-object", { type: "Token", objectId: mageNpc.id });
      const uuid = `Scene.${(await ctx.scene()).sceneId}.Token.${mageNpc.id}.Actor.${mageNpc.actorId}`;
      const protective = (mageToken.delta?.items ?? []).find(i => i.system?.identifier === "protective-magic");
      if ( protective ) {
        const match = { path: "_id", value: protective._id };
        // Reset to zero on every cast as well: three identical outcomes in a row exhausted its three uses, and the
        // fourth cast no longer found a Counterspell (pass of 2026-10-28).
        refill = () => ctx.call("upsert-embedded-item", { uuid, itemData: { "system.uses.spent": 0 }, match });
        await refill();
        ctx.restore(() => ctx.call("upsert-embedded-item", { uuid, itemData: { "system.uses.spent": protective.system.uses.spent }, match }).catch(() => {}));
        ctx.log(`Magie protectrice du Mage (token) : ${protective.system.uses.spent} utilisation(s) dépensée(s) → 0 le temps du scénario`);
      }
      // "On seeing the caster": the Mage has no Darkvision (sight 0 ft); it sees by the scene's light
      // — which the simulated vision refused before the fix of 2026-09-24 (adapter/vision.mjs, lightRadius).
      ctx.log(`contre-lanceur : Mage (emplacements de niveau 3 : ${spell3.value ?? 0}/${spell3.override ?? "max 0"} → 3/3)`);
    } else {
      await ctx.ensureItem(zombi, "Compendium.dnd5e.spells24.Item.phbsplCounterspe", { system: { method: "atwill" } });
      ctx.log("contre-lanceur : Zombi (Contresort à volonté, pas de Mage sur la scène)");
    }
    // §298: in combat, on the Wizard's turn, the first dispelled spell costs it its action (Counterspell 2024: "the action used to
    // cast it is lost"). The combat ends after this check; the following casts happen outside combat.
    const counterer = mageNpc ? await ctx.token("Mage") : zombi;
    await ctx.startCombat([mage, counterer]);
    {
      const s = await ctx.combat(); const c = s.combat ?? s.combats?.[0] ?? s;
      await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === mage.id).id, value: 25, combatId: ctx.ownCombat });
      await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === counterer.id).id, value: 5, combatId: ctx.ownCombat });
      for ( let i = 0; i < 4; i++ ) {
        const now = (await ctx.combat()).combat ?? (await ctx.combat());
        if ( now.combatants?.find(x => x.id === now.currentCombatantId)?.tokenId === mage.id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await new Promise(r => setTimeout(r, 1200));
      }
    }
    let budgetChecked = false;
    // The Wizard does not have Fire Bolt: Ray of Frost, an attack spell as well.
    const seen = { dissipated: false, passed: false };
    for ( let i = 0; i < 20 && !(seen.dissipated && seen.passed); i++ ) {
      await ctx.setHp(zombi, hp0);
      if ( refill ) await refill();
      const before = await ctx.lastMessageId();
      const budgetBefore = ctx.ownCombat ? await ctx.engine("budget", { tokenId: mage.id }) : null;
      // The connector hands control back as soon as `use()` is cancelled by the gate: we read what follows in the chat.
      await ctx.use({ tokenId: mage.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { "dnd5e-combat": { autoReact: true } } });
      let gate = null;
      for ( const until = Date.now() + 40000; Date.now() < until && !gate; ) {
        await new Promise(r => setTimeout(r, 700));
        const messages = await ctx.messagesSince(before);
        gate = messages.map(m => m.flags?.["dnd5e-combat"]?.gate ?? m.flags?.gate).find(g => g?.kind === "counterspell") ?? null;
      }
      if ( !gate ) { ctx.expect(false, "aucune carte de porte : personne n'a contré"); return; }
      const counter = await ctx.settle(gate.message);
      const t = counter.targets.find(x => x.name === "Magicien");
      ctx.expect(!!t?.save && (t.save.success === (t.save.total >= counter.plan.save.dc)), `Contresort résolu : sauvegarde de Constitution du Magicien ${t?.save?.total} contre DD ${counter.plan.save.dc}`);
      ctx.expect(gate.dissipated === (t?.save?.success === false), `carte de porte cohérente : ${gate.dissipated ? "sort dissipé" : "le sort passe"}`);
      await new Promise(r => setTimeout(r, 2500));
      const attack = (await ctx.messagesSince(before)).find(m => m.type === "attack");
      if ( gate.dissipated ) {
        ctx.expect(!attack, "sort dissipé : aucun jet d'attaque"); seen.dissipated = true;
        if ( ctx.ownCombat && !budgetChecked && (budgetBefore?.action === 1) ) {
          const after = await ctx.engine("budget", { tokenId: mage.id });
          ctx.expect(after?.action === 0, `sort contré au tour du Magicien : son action est perdue (action ${budgetBefore.action} → ${after?.action})`);
          budgetChecked = true;
          await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null;
        }
      }
      else {
        ctx.expect(!!attack, "sort tenu : le jet d'attaque a eu lieu"); seen.passed = true;
        // In combat, the passed spell cost the action: a full turn gives the Wizard a fresh budget for the next cast.
        if ( ctx.ownCombat ) for ( let k = 0; k < 2; k++ ) { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await new Promise(r => setTimeout(r, 2500)); }
      }
    }
    if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
    ctx.expect(budgetChecked || !seen.dissipated, "l'action perdue a été vérifiée au tour du Magicien");
    ctx.expect(seen.dissipated && seen.passed, `les deux issues vues (dissipé : ${seen.dissipated}, tenu : ${seen.passed})`);
  }
};
