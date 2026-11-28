/**
 * Giant Toad's Swallow (SPEC §45). `ravenloft` world (or any world where a Monster Manual "Giant Toad"
 * has a Medium or smaller creature in contact). No activity of its item places the "swallowed" effect: the engine
 * places it on the action.
 *  1. Without a grappled creature: the Swallow swallows nothing.
 *  2. Bite until it hits: the creature is Grappled.
 *  3. Swallow: Blinded, Restrained, Total Cover; no longer Grappled; placed in the toad's space.
 *  4. End of the toad's turn: an acid damage card for the swallowed creature.
 *  5. The toad dies: the creature is freed, Prone, outside of it.
 * The victim receives 200 HP for the duration of the scenario. Restores HP, conditions, positions and combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "crapaud géant — Engloutissement posé par le moteur, acide en fin de tour, libéré à la mort",

  async run(ctx) {
    // Absent from `dnd-6`: placed in contact with the Zombie for the scenario (Monster Manual 2024, otherwise SRD 2024).
    await ctx.cast({ "Crapaud géant": "mmGiantToad00000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    const toad = tokens.find(t => /Crapaud géant|Giant Toad/i.test(t.name));
    if ( !toad ) { ctx.log("pas de Crapaud géant sur la scène : non applicable"); return; }
    const grid = await ctx.gridSize();
    const tp = await ctx.position(toad);
    // The creature in contact: the closest to the toad (Large: two cells wide), at most one cell from its edge.
    const gap = p => Math.max(Math.max(tp.x - (p.x + grid), p.x - (tp.x + (2 * grid))), Math.max(tp.y - (p.y + grid), p.y - (tp.y + (2 * grid))));
    let victim = null;
    for ( const t of tokens.filter(t => t.id !== toad.id) ) {
      const p = await ctx.position(t);
      if ( (p.level ?? null) !== (tp.level ?? null) ) continue;
      const g = gap(p);
      if ( (g <= 0) && (!victim || (g > victim.gap)) ) victim = { token: t, gap: g, home: p };
    }
    if ( !victim ) { ctx.log("aucune créature au contact du Crapaud géant : non applicable"); return; }
    const prey = victim.token;
    ctx.log(`victime : ${prey.name}`);

    // HP read from the prepared actor: `ctx.hp` returns null for an unlinked token never wounded (nothing in its delta), and
    // the scenario then left the toad at 0 HP (seen on 2026-10-01).
    const hpOf = async t => (await ctx.engine("stats", { tokenId: t.id }))?.hp?.value ?? null;
    const toadHp = await hpOf(toad);
    const preyHp = await hpOf(prey);
    if ( !ctx.expect(Number.isFinite(toadHp) && (toadHp > 0) && Number.isFinite(preyHp), `PV relevés (crapaud ${toadHp}, ${prey.name} ${preyHp})`) ) return;
    const { data: pdata } = await ctx.call("get-scene-object", { type: "Token", objectId: prey.id });
    const linked = pdata.actorLink === true;
    const max0 = pdata.delta?.system?.attributes?.hp?.max ?? null;
    const STATUSES = ["dead", "unconscious", "prone", "blinded", "restrained", "grappled", "coverTotal", "incapacitated"];
    const tidy = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await ctx.setHp(toad, toadHp);
      for ( const t of [toad, prey] ) for ( const s of STATUSES ) { await ctx.removeStatusEffects(t, s); await ctx.call("set-status", { tokenId: t.id, statusId: s, active: false }).catch(() => {}); }
      await ctx.call("move-token", { tokenId: prey.id, x: victim.home.x, y: victim.home.y, elevation: victim.home.elevation ?? 0 }).catch(() => {});
      if ( !linked ) await ctx.call("update-scene-object", { type: "Token", objectId: prey.id,
        data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {});
      await ctx.setHp(prey, preyHp);
    };
    ctx.restore(tidy);
    if ( !linked ) await ctx.call("update-scene-object", { type: "Token", objectId: prey.id, data: { "delta.system.attributes.hp.max": 200, "delta.system.attributes.hp.value": 200 } });

    const statuses = async t => new Set((await ctx.engine("stats", { tokenId: t.id }))?.statuses ?? []);
    const inside = async () => {
      const a = await ctx.position(toad);
      const b = await ctx.position(prey);
      return (b.x >= a.x - 1) && (b.y >= a.y - 1) && (b.x + grid <= a.x + (2 * grid) + 1) && (b.y + grid <= a.y + (2 * grid) + 1);
    };
    const bite = await ctx.itemId(toad.id, "bite");
    const swallow = await ctx.itemId(toad.id, "swallow");
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };

    await ctx.startCombat([toad, prey]);
    const combat = await state();
    for ( const [t, v] of [[toad, 20], [prey, 10]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
    for ( let i = 0; (i < 3) && ((await current()) !== toad.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === toad.id, "combat : au tour du Crapaud géant") ) return;
    const act = { usageConfig: { [MODULE_ID]: { confirmed: true } } };
    const useSwallow = () => ctx.use({ tokenId: toad.id, itemId: swallow, activityId: "0A0cIyRNbphDR82L", ...act });

    // 1. Nothing grappled: nothing swallowed.
    await useSwallow();
    await pause(2500);
    ctx.expect(!(await statuses(prey)).has("coverTotal") && !(await inside()), "sans créature agrippée, l'Engloutissement n'avale rien");

    // 2. Bite until it hits.
    let held = false;
    for ( let n = 0; (n < 12) && !held; n++ ) {
      const u = await ctx.use({ tokenId: toad.id, itemId: bite, activityType: "attack", targetTokenIds: [prey.id], ...act });
      await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      held = (await statuses(prey)).has("grappled");
    }
    if ( !ctx.expect(held, `Morsure : ${prey.name} est Agrippé (12 essais au plus)`) ) return;

    // 3. Engloutissement.
    await useSwallow();
    await pause(3500);
    const s3 = await statuses(prey);
    ctx.expect(s3.has("coverTotal") && s3.has("blinded") && s3.has("restrained"), `Engloutissement : Aveuglé, Entravé, abri total (${[...s3].join(", ")})`);
    ctx.expect(!s3.has("grappled"), "englouti : plus Agrippé");
    ctx.expect(await inside(), "englouti : posé dans l'espace du crapaud");

    // 4. Fin du tour du crapaud : l'acide.
    const before = await ctx.hp(prey);
    const mark = await ctx.lastMessageId();
    await ctx.nextTurn();
    let tick = null;
    for ( const stop = Date.now() + 12000; !tick && (Date.now() < stop); await pause(500) ) {
      tick = (await ctx.messagesSince(mark)).find(m => m.flags?.[MODULE_ID]?.areaTick?.event === "swallow");
    }
    if ( ctx.expect(!!tick, "fin du tour du crapaud : la carte de dégâts de l'Engloutissement") ) {
      await ctx.settle(tick.id, { timeoutMs: 45000 }).catch(() => null);
      await pause(2000);
      const after = await ctx.hp(prey);
      ctx.expect((after < before) && ((before - after) <= 18), `3d6 dégâts d'acide (${before} → ${after} PV)`);
    }
    ctx.expect((await statuses(prey)).has("coverTotal"), "toujours englouti après les dégâts");

    // 5. The toad dies: freed, Prone, outside.
    await ctx.setHp(toad, 0);
    await pause(4000);
    const s5 = await statuses(prey);
    ctx.expect(!s5.has("coverTotal") && s5.has("prone"), `le crapaud meurt : libéré, À terre (${[...s5].join(", ")})`);
    ctx.expect(!(await inside()), "hors de l'espace du crapaud");
  }
};
