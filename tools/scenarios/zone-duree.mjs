/**
 * Lasting area: the Wizard's Moonbeam placed on a Zombie, then a combat where the Zombie ends
 * its turn inside → the engine replays the spell against it (`turnEnd` trigger, `moonbeam`
 * content): saving throw rolled by the engine, damage, consistent HP. The placement itself does
 * nothing (nobody enters); the area stays as long as Concentration holds.
 */
export default {
  name: "zone qui dure — Rayon de lune, fin de tour du Zombi dedans",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    // The Monster Manual Zombie has only 15 HP: a failed Moonbeam (radiant, without Undead Fortitude) drops it right at
    // placement, and there is no end of turn to observe. High HP for the test; the counts start from there.
    const hp1 = 100;
    await ctx.setHp(zombi, hp1);

    const box = await ctx.box(zombi);
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const used = await ctx.use({ tokenId: mage.id, identifier: "moonbeam", activityType: "save", area: { shape: "circle", ...centre, radius: box.width } });
    ctx.expect(used.used && !!used.regionId, "Rayon de lune posé sur le Zombi");
    if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
    // The Concentration placed on the Wizard is removed at the end of the scenario (it holds the area).
    ctx.restore(async () => {
      const actor = await ctx.call("get-actor", { actorId: mage.actorId });
      const effects = actor.effects ?? actor.actor?.effects ?? [];
      for ( const e of effects.filter(e => /concentr/i.test(e.name ?? "")) ) {   // "Concentré: …" in FR, "Concentrating: …" in EN
        await ctx.call("remove-embedded-effect", { uuid: `Actor.${mage.actorId}`, effectId: e._id ?? e.id }).catch(() => {});
      }
    });

    // At placement, the area acts on those it already covers (SPEC §11, 0.3.0: "Zombie and caster
    // already hit not replayed"): the Zombie takes the saving throw a first time.
    const since = used.usageMessageId;
    const cast = await ctx.settle(since);
    const hitAtCast = cast.targets.find(t => t.name === "Zombi");
    ctx.expect(cast.step === "done" && !!hitAtCast, `la pose agit sur le Zombi déjà dedans (sauvegarde ${hitAtCast?.save?.total}, ${hitAtCast?.damage?.applied ?? 0} PV)`);
    const atCast = hitAtCast?.damage?.applied ?? 0;

    await ctx.startCombat([mage, zombi]);
    // Two turns: the Wizard's, then the Zombie's; at its end, the spell replays against it.
    let replayed = null;
    for ( let i = 0; i < 4 && !replayed; i++ ) {
      await ctx.nextTurn();
      await new Promise(r => setTimeout(r, 2500));
      const messages = await ctx.messagesSince(since);
      replayed = messages.find(m => (m.type === "usage") && (m.flags?.["dnd5e-combat"]?.areaTick ?? m.flags?.areaTick));
    }
    ctx.expect(!!replayed, "fin du tour du Zombi dans la zone : le sort a rejoué (message d'utilisation marqué areaTick)");
    if ( !replayed ) return;

    const r = await ctx.settle(replayed.id);
    ctx.expect(r.step === "done", `résolution du rejeu tranchée (« ${r.step} »)`);
    const target = r.targets.find(t => t.name === "Zombi");
    ctx.expect(!!target, `le Zombi est la cible du rejeu (${r.targets.map(t => t.name).join(", ")})`);
    if ( !target ) return;
    const { dc } = r.plan.save;
    ctx.expect(target.save?.total !== null && target.save?.success === (target.save?.total >= dc), `sauvegarde ${target.save?.total} contre DD ${dc} : ${target.save?.success ? "réussie" : "ratée"}`);
    const after = await ctx.hp(zombi);
    const total = atCast + (target.damage?.applied ?? 0);
    ctx.expect(hp1 - after === total, `PV lus sur le token ${hp1} → ${after}, = ${atCast} (pose) + ${target.damage?.applied ?? 0} (rejeu)`);
  }
};
