/**
 * 2026-11-28 (user's request): the turn skips defeated NPCs — world setting `skipDefeatedNpcs`, on by default. On a temporary scene, a
 * hero (character) and three NPCs in initiative order: Hero 20, Goblin A at 0 HP 15, Goblin B dead 12, Ogre 10. Checks:
 *  1. the setting exists, world, in the Combat tab of the DAS settings window, on by default (its default value as registered);
 *  2. setting on: « next turn » from the Hero lands on the Ogre (Goblin A at 0 HP and the dead Goblin B passed), same round;
 *  3. from the Ogre (last), the next turn goes to the Hero, next round: a player character is never passed, even at 0 HP;
 *  4. going back from the Ogre lands on Goblin B (back never skips);
 *  5. setting off: « next turn » from the Hero lands on Goblin A;
 *  6. every NPC defeated (the Ogre at 0 HP too): « next turn » from the Hero comes back to the Hero, next round, and stays there.
 * Put back: the setting, the scene, the actors, the combat.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "turn skips defeated NPCs (setting skipDefeatedNpcs)",

  async run(ctx) {
    const gm = async (code, args) => (await ctx.call("run-script", { code, ...(args ? { args } : {}), waitMs: 30000 }))?.result;

    const setup = await gm(`
      const TEST = { "dnd5e-combat": { test: true } };
      const previous = { skip: game.settings.get("dnd5e-combat", "skipDefeatedNpcs"), scene: canvas.scene?.id ?? null };
      const def = game.settings.settings.get("dnd5e-combat.skipDefeatedNpcs");
      const make = (name, type, hp) => Actor.implementation.create({ name, type, img: "icons/svg/mystery-man.svg", flags: TEST,
        system: { attributes: { hp: { value: hp, max: 10 } } } });
      const hero = await make("DAS skip Hero", "character", 10);
      const ga = await make("DAS skip Goblin A", "npc", 0);
      const gb = await make("DAS skip Goblin B", "npc", 7);
      const ogre = await make("DAS skip Ogre", "npc", 10);
      const scene = await Scene.create({ name: "DAS skip defeated (test)", width: 1000, height: 800, padding: 0, grid: { size: 100, distance: 5 },
        tokenVision: false, flags: TEST });
      const tokens = await scene.createEmbeddedDocuments("Token", [hero, ga, gb, ogre].map((a, i) => ({ name: a.name, actorId: a.id, x: 100 + 100 * i, y: 200 })));
      const of = a => tokens.find(t => t.actorId === a.id);
      await of(gb).actor.toggleStatusEffect("dead", { active: true, overlay: true });
      const combat = await Combat.implementation.create({ scene: scene.id, flags: TEST });
      const init = { [hero.id]: 20, [ga.id]: 15, [gb.id]: 12, [ogre.id]: 10 };
      await combat.createEmbeddedDocuments("Combatant", [hero, ga, gb, ogre].map(a => ({ tokenId: of(a).id, sceneId: scene.id, actorId: a.id, initiative: init[a.id] })));
      await combat.startCombat();
      await game.settings.set("dnd5e-combat", "skipDefeatedNpcs", true);
      // The DAS settings window shows the Core's settings (ui/settings.mjs hides them from Foundry's own list): read its layout.
      const { SETTINGS_TABS } = await import("/modules/dnd5e-combat/scripts/core/settings-layout.mjs");
      const tab = SETTINGS_TABS.find(t => t.keys.includes("skipDefeatedNpcs"))?.id ?? null;
      return { previous, combat: combat.id, scene: scene.id, actors: [hero.id, ga.id, gb.id, ogre.id], hero: of(hero).id,
        setting: def ? { scope: def.scope, tab, default: def.default } : null };`);
    if ( !ctx.expect(setup?.combat, "test scene, actors and combat ready") ) return;
    ctx.restore(() => gm(`
      await game.combats.get(args.combat)?.delete();
      await game.scenes.get(args.scene)?.delete();
      await Actor.implementation.deleteDocuments(args.actors.filter(id => game.actors.get(id)));
      await game.settings.set("dnd5e-combat", "skipDefeatedNpcs", args.previous.skip);
      return true;`, setup).catch(err => ctx.log(`cleanup: ${err.message}`)));

    // 1. The setting.
    ctx.expect(setup.setting?.scope === "world" && setup.setting.tab === "combat" && setup.setting.default === true,
      `world setting, in the Combat tab of the DAS settings window, on by default (${JSON.stringify(setup.setting)})`);

    /** Puts the turn on `name` (no skip involved), then runs `step` (next / previous), and reads where the turn is. */
    const step = (from, how, args={}) => gm(`
      const combat = game.combats.get(args.combat);
      const index = combat.turns.findIndex(c => c.name === args.from);
      await combat.update({ turn: index }, { direction: 0 });
      await new Promise(r => setTimeout(r, 400));
      const round = combat.round;
      if ( args.how === "next" ) await combat.nextTurn(); else await combat.previousTurn();
      for ( let i = 0; i < 20; i++ ) { await new Promise(r => setTimeout(r, 150)); }
      return { at: combat.combatant?.name ?? null, round: combat.round, before: round, exists: !!game.combats.get(args.combat) };`,
      { ...setup, from, how, ...args });

    // 2. On: Hero → Ogre.
    let r = await step("DAS skip Hero", "next");
    ctx.expect(r?.at === "DAS skip Ogre" && r.round === r.before, `setting on: Goblin A (0 HP) and dead Goblin B passed, the Ogre plays (${JSON.stringify(r)})`);

    // 3. Ogre → Hero, next round, Hero at 0 HP still plays.
    await gm(`await game.actors.get(args.actors[0]).update({ "system.attributes.hp.value": 0 }); return true;`, setup);
    r = await step("DAS skip Ogre", "next");
    ctx.expect(r?.at === "DAS skip Hero" && r.round === r.before + 1, `a player character at 0 HP keeps its turn, next round (${JSON.stringify(r)})`);
    await gm(`await game.actors.get(args.actors[0]).update({ "system.attributes.hp.value": 10 }); return true;`, setup);

    // 4. Back never skips.
    r = await step("DAS skip Ogre", "previous");
    ctx.expect(r?.at === "DAS skip Goblin B", `going back lands on the dead Goblin B (${JSON.stringify(r)})`);

    // 5. Off: Hero → Goblin A.
    await gm(`await game.settings.set("dnd5e-combat", "skipDefeatedNpcs", false); return true;`);
    r = await step("DAS skip Hero", "next");
    ctx.expect(r?.at === "DAS skip Goblin A", `setting off: Goblin A at 0 HP gets its turn (${JSON.stringify(r)})`);

    // 6. Every NPC defeated, the Hero at 0 HP: no endless loop.
    await gm(`await game.settings.set("dnd5e-combat", "skipDefeatedNpcs", true);
      await game.actors.get(args.actors[3]).update({ "system.attributes.hp.value": 0 });
      return true;`, setup);
    r = await step("DAS skip Hero", "next");
    await pause(1500);
    const after = await gm(`const c = game.combats.get(args.combat); return { at: c?.combatant?.name ?? null, round: c?.round ?? null };`, setup);
    ctx.expect(r?.exists && after?.round === r.round && after.at === "DAS skip Hero",
      `only the Hero can play: the turn comes back to the Hero and stays (${JSON.stringify({ r, after })})`);
  }
};
