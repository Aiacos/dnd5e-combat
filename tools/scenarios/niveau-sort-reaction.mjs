/**
 * §481: the "cast spell level" fact in the `castsSpell` gate. The Zombie receives an at-will Counterspell (caster's Constitution
 * saving throw, 2024) whose declaration is replaced, for the scenario, by a Reaction reserved for level 1 spells
 * or lower (`spell.castLevelAtMost: 1`, world overlay). The Wizard casts Magic Missile:
 *  1. at level 1 → the Zombie reacts (gate card `counterspell`, caster's saving throw, either outcome);
 *  2. at level 2 (slot chosen at use) → no Reaction: the level comes from the use configuration, not from
 *     the spell's base level.
 * The arena's NPC Mage, if present, is hidden for the scenario (their own Counterspell would react to everything).
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "niveau du sort lancé — réaction réservée aux sorts de niveau 1 ou moins (§481)",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    // Nobody else counters: the NPC Mage hidden for the scenario (`counterCandidates` skips hidden tokens).
    const { tokens } = await ctx.scene();
    for ( const other of tokens.filter(t => (t.name === "Mage") && !t.hidden) ) {
      await ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: true } });
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: other.id, data: { hidden: false } }).catch(() => {}));
      ctx.log(`${other.name} caché le temps du scénario`);
    }

    // The level-bounded Reaction: at-will Counterspell, its declaration replaced in the world overlay for the scenario.
    // Not by an item flag: a Foundry update expands the dotted keys of the conditions (`"spell.castLevelAtMost"` becomes
    // `{ spell: { castLevelAtMost } }`), which validation refuses ("unknown fact "spell"", test bench of 2026-11-20).
    await ctx.ensureItem(zombi, "Compendium.dnd5e.spells24.Item.phbsplCounterspe", { system: { method: "atwill" } });
    const RULE = { triggers: [{ on: "castsSpell", if: { "target.seesSource": true, "spell.castLevelAtMost": 1 }, do: [{ type: "use", target: "source" }] }] };
    const { before: rule0 } = await ctx.engine("overrideContent", { identifier: "counterspell", entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: "counterspell", entry: rule0 }).catch(() => {}));

    // Level 1 and 2 slots for the Wizard, given back at the end.
    const { data: mTok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const spells = (await ctx.call("get-actor", { actorId: mTok.actorId })).system?.spells ?? {};
    const before = {};
    for ( const k of ["spell1", "spell2"] ) {
      before[`system.spells.${k}.value`] = spells[k]?.value ?? 0;
      before[`system.spells.${k}.override`] = spells[k]?.override ?? null;
    }
    await ctx.call("update-actor", { actorId: mTok.actorId, actorData: {
      "system.spells.spell1.override": 3, "system.spells.spell1.value": 3, "system.spells.spell2.override": 3, "system.spells.spell2.value": 3 } });
    ctx.restore(() => ctx.call("update-actor", { actorId: mTok.actorId, actorData: before }).catch(() => {}));

    /** Magic Missile at level `level` on the Zombie; returns the `counterspell` gate card (or null) and the cards seen. */
    const cast = async (level, waitMs) => {
      await ctx.setHp(zombi, hp0);
      const start = await ctx.lastMessageId();
      await ctx.use({ tokenId: mage.id, identifier: "magic-missile", targetTokenIds: [zombi.id],
        usageConfig: { spell: { slot: `spell${level}` }, [MODULE_ID]: { autoReact: true } } });
      let gate = null;
      for ( const until = Date.now() + waitMs; (Date.now() < until) && !gate; ) {
        await pause(700);
        gate = (await ctx.messagesSince(start)).map(m => m.flags?.[MODULE_ID]?.gate ?? m.flags?.gate).find(g => g?.kind === "counterspell") ?? null;
      }
      await pause(3000);   // the chained missiles (or the spell recast after the saving throw) finish going off
      return { gate, messages: await ctx.messagesSince(start) };
    };

    // 1. Level 1: the condition holds, the Zombie reacts.
    const low = await cast(1, 40000);
    ctx.expect(!!low.gate, `niveau 1 : le Zombi réagit (carte de porte ${low.gate ? (low.gate.dissipated ? "« sort dissipé »" : "« le sort passe »") : "absente"})`);
    if ( low.gate?.message ) {
      const counter = await ctx.settle(low.gate.message);
      const t = counter.targets.find(x => x.name === "Magicien");
      ctx.expect(!!t?.save, `réaction résolue par la sauvegarde du lanceur (${t?.save?.total ?? "?"} contre DD ${counter.plan?.save?.dc ?? "?"})`);
      ctx.expect(low.gate.dissipated === (t?.save?.success === false), "carte de porte cohérente avec la sauvegarde");
    }

    // 2. Level 2: same spell, higher slot — the condition no longer holds, no Reaction, the spell goes off.
    const high = await cast(2, 10000);
    ctx.expect(!high.gate, "niveau 2 : aucune réaction (sort au-delà du niveau 1)");
    ctx.expect(high.messages.some(m => m.type === "usage"), `niveau 2 : le sort part (${high.messages.filter(m => m.type === "usage").length} carte(s) d'utilisation)`);
  }
};
