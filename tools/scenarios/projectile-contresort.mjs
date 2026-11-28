/**
 * §119: Magic Missile and Counterspell. The engine replays the spell for each chained missile; these casts also went
 * through the "castsSpell" gate, and a Mage whose GM had declined the Counterspell (reaction kept) was offered it again
 * on the next missile (seen on 2026-10-10: two windows, one missile lost). Here the GM declines the window: it must
 * open only once, and the three missiles go off.
 */
export default {
  name: "Projectile magique — Contresort refusé, une seule fenêtre (§119)",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    // The counter-caster: the NPC Mage (MM 2024, hostile, Counterspell with a slot) if it is on the scene — its
    // level 3 spell slots are reset to 3 for the scenario (zero on the sheet as imported, and dnd5e
    // refuses the use without a slot); otherwise the Zombie, with an "at will" Counterspell.
    const { tokens } = await ctx.scene();
    const mageNpc = tokens.find(t => (t.name === "Mage") && !t.hidden);
    if ( mageNpc ) {
      // The MM 2024 Mage has no spell slots (max 0): Counterspell consumes one, dnd5e refuses without. We give it
      // three by override (`override`), as a GM would on the sheet, and give everything back at the end.
      const spell3 = (await ctx.call("get-actor", { actorId: mageNpc.actorId })).system?.spells?.spell3 ?? {};
      const before = { "system.spells.spell3.value": spell3.value ?? 0, "system.spells.spell3.override": spell3.override ?? null };
      await ctx.call("update-actor", { actorId: mageNpc.actorId, actorData: { "system.spells.spell3.override": 3, "system.spells.spell3.value": 3 } });
      ctx.restore(() => ctx.call("update-actor", { actorId: mageNpc.actorId, actorData: before }).catch(() => {}));
      // The arena Mage is an UNLINKED token: its Protective Magic (§66, Counterspell without a slot) lives in its copy, which the
      // previous passes had exhausted (3/3 on 2026-10-06 — the safety net restores the state at the START, already exhausted):
      // no more Counterspell offered. We reset its uses to zero for the scenario, and give back what was there.
      const { data: mageToken } = await ctx.call("get-scene-object", { type: "Token", objectId: mageNpc.id });
      const uuid = `Scene.${(await ctx.scene()).sceneId}.Token.${mageNpc.id}.Actor.${mageNpc.actorId}`;
      const protective = (mageToken.delta?.items ?? []).find(i => i.system?.identifier === "protective-magic");
      if ( protective?.system?.uses?.spent ) {
        const match = { path: "_id", value: protective._id };
        await ctx.call("upsert-embedded-item", { uuid, itemData: { "system.uses.spent": 0 }, match });
        ctx.restore(() => ctx.call("upsert-embedded-item", { uuid, itemData: { "system.uses.spent": protective.system.uses.spent }, match }).catch(() => {}));
        ctx.log(`Magie protectrice du Mage (token) : ${protective.system.uses.spent} utilisation(s) dépensée(s) → 0 le temps du scénario`);
      }
      // "On seeing the caster": the Mage has no Darkvision (sight 0 ft); it sees by the light of the
      // scene — which the simulated vision refused before the fix of 2026-09-24 (adapter/vision.mjs, lightRadius).
      ctx.log(`contre-lanceur : Mage (emplacements de niveau 3 : ${spell3.value ?? 0}/${spell3.override ?? "max 0"} → 3/3)`);
    } else {
      await ctx.ensureItem(zombi, "Compendium.dnd5e.spells24.Item.phbsplCounterspe", { system: { method: "atwill" } });
      ctx.log("contre-lanceur : Zombi (Contresort à volonté, pas de Mage sur la scène)");
    }
    // §119: Magic Missile, the GM DECLINES the Counterspell (its reaction is not spent): the window must open only once.
    const ids = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    const before = await ctx.lastMessageId();
    await ctx.use({ tokenId: mage.id, identifier: "magic-missile", targetTokenIds: [zombi.id], usageConfig: { "dnd5e-combat": { autoReact: false } } });
    const seen = [];
    for ( const stop = Date.now() + 30000; Date.now() < stop; ) {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...ids, ...seen.map(d => d.id)], waitMs: 1500, details: true }).catch(() => null);
      for ( const d of r?.windows ?? [] ) {
        const text = `${d.title ?? ""} | ${(d.content ?? d.text ?? "").slice(0, 120)}`;
        const labels = (d.buttons ?? []).map(b => `${b.action ?? ""}:${b.label ?? ""}`);
        const b = (d.buttons ?? []).find(x => x.action === "none") ?? null;   // "Do not react"
        ctx.log(`fenêtre : ${text} — boutons ${labels.join(", ")} → ${b ? (b.action ?? b.label) : "fermée"}`);
        if ( b ) await ctx.call("answer-dialog", { id: d.id, button: b.action ?? b.label }).catch(() => {});
        else await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
        seen.push(d);
      }
    }
    const usages = (await ctx.messagesSince(before)).filter(m => m.type === "usage").length;
    ctx.expect(seen.length === 1, `une seule fenêtre de réaction pour tout le sort (${seen.length})`);
    ctx.expect(usages >= 3, `les trois projectiles sont partis (${usages} cartes d'utilisation)`);
  }
};
