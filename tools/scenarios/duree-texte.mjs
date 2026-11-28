/**
 * M4 (SPEC §18.7) — the duration written in the text becomes a native dnd5e expiry. `ravenloft` world: the Giant
 * Centipede's Bite (Monster Manual, lent to the Wolf for the scenario) applies Poisoned "until the start of the attacking
 * creature's next turn", with no duration in its data. On a hit, the Bear is Poisoned with `duration.expiry =
 * "sourceStart"`; the condition holds during the Bear's turn and ends at the start of the Wolf's next turn (effect marked
 * expired by the core, not deleted).
 */
const CENTIPEDE = "Compendium.dnd-monster-manual.actors.Actor.mmGiantCentipede";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "durée écrite — Empoisonné jusqu'au début du prochain tour de l'attaquant",

  async run(ctx) {
    // Absent from `dnd-6`: placed for the scenario from their sheet (Monster Manual 2024, otherwise dnd5e's SRD 2024).
    await ctx.cast({ "Loup": "mmWolf0000000000", "Ours brun": "mmBrownBear00000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Loup", "Ours brun"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Loup ou Ours brun absent : non applicable"); return; }
    const wolf = await ctx.token("Loup");
    const bear = await ctx.token("Ours brun");   // not the Zombie: immune to Poisoned
    const grid = await ctx.gridSize();
    const home = await ctx.position(bear);
    const hp = await ctx.hp(bear);
    ctx.restore(() => ctx.call("move-token", { tokenId: bear.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
    ctx.restore(() => ctx.setHp(bear, hp));
    ctx.restore(() => ctx.removeStatusEffects(bear, "poisoned"));
    ctx.restore(() => ctx.removeEffectsNamed(bear, /Empoisonn|Poison/));
    await ctx.removeStatusEffects(bear, "poisoned");
    const at = await ctx.position(wolf);
    await ctx.call("move-token", { tokenId: bear.id, x: at.x - 2 * grid, y: at.y, elevation: at.elevation });

    // The Centipede's Bite, lent to the Wolf (identifier "bite": recognized by its id).
    const { data: centipede } = await ctx.call("get-compendium-entry", { uuid: CENTIPEDE });
    const { _id, folder, ownership, _stats, ...itemData } = centipede.items.find(i => i.system?.identifier === "bite");
    itemData.system.identifier = "centipede-bite";
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: wolf.id });
    const r = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: "centipede-bite" } });
    const itemId = r.itemId ?? r.id ?? r.item?._id ?? (await ctx.itemId(wolf.id, "centipede-bite"));
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId }).catch(() => {}));

    await ctx.startCombat([wolf, bear]);
    const current = async () => {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      return combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId ?? null;
    };
    for ( let i = 0; (i < 3) && ((await current()) !== wolf.id); i++ ) { await ctx.nextTurn(); await sleep(800); }

    // Expired, an effect is not deleted by the V14 core: it is marked `duration.expired` (CONFIG.ActiveEffect.expiryAction =
    // "update", client/config.mjs:2057), hence suppressed (`isSuppressed`), and the actor loses the condition.
    const poison = async () => (await ctx.effects(bear)).find(e => !e.disabled && !e.duration?.expired && (e.statuses ?? []).includes("poisoned")) ?? null;
    let hit = false;
    for ( let i = 0; (i < 20) && !hit; i++ ) {
      await ctx.setHp(bear, 100);
      const used = await ctx.use({ tokenId: wolf.id, itemId, activityType: "attack", targetTokenIds: [bear.id] });
      const res = await ctx.settle(used.usageMessageId);
      hit = !!res.targets.find(t => t.token?.endsWith(bear.id))?.hit;
    }
    if ( !ctx.expect(hit, "le Loup touche l'Ours") ) return;
    await sleep(800);
    const effect = await poison();
    ctx.expect(!!effect, "l'Ours est Empoisonné");
    // In combat, the engine itself handles the end of turn (runtime/cantrips.mjs: `placedOn`, core duration emptied, §42.2);
    // outside that rule, the core expiry read from the text (adapter/effects.mjs, `setTextExpiry`). The next two checks
    // say whether the end falls at the right moment.
    const engineEnd = !!effect?.flags?.["dnd5e-combat"]?.placedOn;
    ctx.expect((effect?.duration?.expiry === "sourceStart") || engineEnd,
      `durée lue dans le texte : expiration « ${effect?.duration?.expiry} »${engineEnd ? ", fin de tour tenue par le moteur" : ""} (attendu sourceStart ou la règle du moteur)`);

    await ctx.nextTurn(); await sleep(1500);
    ctx.expect((await current()) === bear.id, "tour de l'Ours");
    ctx.expect(!!(await poison()), "pendant son tour, l'Ours est toujours Empoisonné");
    await ctx.nextTurn(); await sleep(2000);
    ctx.expect((await current()) === wolf.id, "tour suivant du Loup");
    ctx.expect(!(await poison()), "au début du tour du Loup, l'état est tombé");
  }
};
