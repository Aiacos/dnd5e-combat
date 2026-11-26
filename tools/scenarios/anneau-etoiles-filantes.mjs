/**
 * §550 (DF #233): Ring of Shooting Stars, Lightning Spheres — "On a failed save, the creature takes Lightning damage based on the
 * number of spheres you created" (SRD 5.2: 1 sphere 4d12, 2 → 5d4, 3 → 2d6, 4 → 2d4). Content key `damageByCount`.
 * The Wizard wears the ring (equipped, attuned) and creates 1 sphere, then the Zombie (Dexterity saves at −40) fails the
 * "Lightning Sphere Save": damage 4d12, applied. Then 3 spheres: damage 2d6.
 * Restores the Zombie's HP and effects; the lent ring is removed.
 */
const MODULE_ID = "dnd5e-combat";
const RING = "Compendium.dnd5e.equipment24.Item.dmgRingOfShootin";
const CREATE = "sZwpvVE0OpUNXe2B";
const SAVE = "GLyk6XaqTk5JOVQ8";
const MARK = "Shooting stars scenario: fails Dexterity saves";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "Ring of Shooting Stars — a lightning sphere's damage by the number created (4d12 for 1, 2d6 for 3)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Magicien", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Magicien or Zombi missing: not applicable"); return; }
    const mage = await ctx.token("Magicien");
    const zombie = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombie);
    ctx.restore(() => ctx.setHp(zombie, hp0));
    ctx.restore(() => ctx.removeEffectsNamed(zombie, new RegExp(MARK)));

    const ringId = await ctx.ensureItem(mage, RING, { ready: true, byUuid: true });
    // The Zombie fails every Dexterity save (the scenario checks the failed-save damage, not the dice).
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: zombie.id });
    const where = tok.actorLink ? { documentType: "Actor", id: tok.actorId }
      : { uuid: `Scene.${(await ctx.scene()).sceneId}.Token.${zombie.id}.Actor.${tok.actorId}` };
    await ctx.call("upsert-embedded-effect", { ...where, effectData: { name: MARK, img: "icons/svg/downgrade.svg", transfer: false,
      disabled: false, changes: [{ key: "system.abilities.dex.bonuses.save", mode: 2, value: "-40" }] } });
    await pause(500);

    const flagOf = async () => {
      const items = (await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [];
      return items.find(i => i._id === ringId)?.flags?.[MODULE_ID]?.countCreated?.[CREATE] ?? null;
    };

    for ( const [spheres, expected] of [[1, "4d12"], [3, "2d6"]] ) {
      await ctx.refill(mage, ringId);
      await ctx.setHp(zombie, 200);
      const created = await ctx.use({ tokenId: mage.id, itemId: ringId, activityId: CREATE, usageConfig: { scaling: spheres - 1 } });
      await pause(1500);
      const noted = await flagOf();
      ctx.expect(created.used && (noted === spheres), `${spheres} sphere(s) created: number noted on the ring (${noted})`);

      const since = await ctx.lastMessageId();
      const save = await ctx.use({ tokenId: mage.id, itemId: ringId, activityId: SAVE, targetTokenIds: [zombie.id] });
      const r = await ctx.settle(save.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      const msgs = await ctx.messagesSince(since);
      const saveRoll = msgs.filter(m => m.type === "save").flatMap(m => m.rolls ?? [])[0];
      const damage = msgs.filter(m => m.type === "damage").flatMap(m => m.rolls ?? [])[0];
      const formula = String(damage?.formula ?? "");
      // dnd5e applies damage to the prepared HP (capped at the maximum), so the check reads the engine's applied amount.
      const applied = r?.targets?.[0]?.damage?.applied;
      const after = await ctx.hp(zombie);
      ctx.expect(!!saveRoll && (Number(saveRoll.total) < 15), `${spheres} sphere(s): the Zombie fails its DC 15 save (${saveRoll?.total ?? "no save roll"})`);
      ctx.expect(formula.replace(/\s/g, "").startsWith(expected), `${spheres} sphere(s): damage ${expected} (${formula || "no damage roll"})`);
      ctx.expect((r?.step === "done") && (applied > 0) && (applied === Number(damage?.total)) && (after < 200),
        `${spheres} sphere(s): full damage applied (${applied} HP, roll ${damage?.total ?? "?"}, ${after} HP left, step ${r?.step ?? "?"})`);
    }
  }
};
