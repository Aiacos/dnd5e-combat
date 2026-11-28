/**
 * §208: the 2024 rules jump and the automatic fall, on the `dnd-6` Test Arena with the Fighter (Strength 17: 17 ft long jump
 * with a running start, 8 ft without; the grid is in 5 ft cells). Checks:
 *  1. out of combat (running start always possible): a 3-cell jump passes, a 4-cell jump is refused;
 *  2. in combat, no running start: 2 cells refused; after 2 cells of walking, a 3-cell jump passes, and costs 15 ft;
 *  3. "Boots of jumping and swiftness" lent (equipped, attuned): without a running start, 6 cells (30 ft) for 10 ft of movement —
 *     fixed jump taken, 20 ft returned; a second fixed jump the same turn is refused;
 *  4. arrival in a Difficult Terrain region: the Acrobatics check is rolled (Prone ⇔ total < 10);
 *  5. automatic fall in combat: fly speed lent, at 20 ft, made Prone → dnd5e places "Falling", the engine makes him fall
 *     (to the ground, damage applied); Grappled in flight → he falls too (2024 rules, Speed 0).
 * Puts back position, elevation, mode, HP, conditions, fly speed, settings; removes the lent item and the region.
 */
const MODULE_ID = "dnd5e-combat";
const BOOTS = "Compendium.dnd-dungeon-masters-guide.equipment.Item.dmgBootsOfStridi";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * §412: a rule refusal now opens the legality window instead of a flat refusal — the call waits for the answer. Here we give up
 * ("Give up") and the window's text joins `warnings`, like the former warning.
 */
async function declining(ctx, name, call) {
  const seen = [];
  let done = false;
  const pending = call().finally(() => { done = true; });
  while ( !done ) {
    const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 800 }).catch(() => null);
    for ( const d of r?.windows ?? [] ) {
      if ( !(d.title ?? "").endsWith(` — ${name}`) ) continue;
      seen.push([d.content, d.text].filter(Boolean).join(" "));
      await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
    }
  }
  const out = await pending;
  return { ...out, warnings: [...(out?.warnings ?? []), ...seen] };
}

export default {
  name: "saut — longueur avec et sans élan, Bottes, atterrissage, chute automatique",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const hero = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const home = await ctx.position(hero);
    const hp0 = await ctx.hp(hero);
    const actor0 = await ctx.call("get-actor", { actorId: hero.actorId });
    const fly0 = actor0.system?.attributes?.movement?.speeds?.fly ?? null;
    const cellOf = p => ({ i: Math.round(p.y / grid), j: Math.round(p.x / grid) });
    const start = cellOf(home);

    // A line of 8 free cells from the Fighter (east, west, north, south).
    const taken = new Set(tokens.filter(t => t.id !== hero.id).map(t => { const c = cellOf(t); return `${c.i},${c.j}`; }));
    const dirs = [[0, 1], [0, -1], [-1, 0], [1, 0]];
    const dir = dirs.find(([di, dj]) => [1, 2, 3, 4, 5, 6, 7, 8].every(k => !taken.has(`${start.i + (di * k)},${start.j + (dj * k)}`)));
    if ( !ctx.expect(!!dir, "une ligne de 8 cases libres autour du Guerrier") ) return;
    const at = k => ({ i: start.i + (dir[0] * k), j: start.j + (dir[1] * k) });

    const goHome = async () => {
      await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false }).catch(() => {});
      for ( const statusId of ["grappled", "unconscious", "dead"] ) await ctx.call("set-status", { tokenId: hero.id, statusId, active: false }).catch(() => {});
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "walk" } }).catch(() => {});
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 0 }).catch(() => {});
      await pause(700);
    };
    const endCombat = async () => { if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; } };
    const fight = async () => {
      await ctx.startCombat([hero, zombi]);
      const s = await ctx.combat();
      const combat = s.combat ?? s.combats?.[0] ?? s;
      for ( const [t, v] of [[hero, 20], [zombi, 1]] ) await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: v, combatId: ctx.ownCombat });
      for ( let i = 0; i < 3; i++ ) {
        const c = (await ctx.combat()).combat ?? (await ctx.combat());
        if ( c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId === hero.id ) break;
        await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200);
      }
      await pause(800);
    };
    const jump = (k, high=false) => declining(ctx, hero.name, () => ctx.engine("jump", { tokenId: hero.id, cell: at(k), high }));
    const spent = async () => (await ctx.engine("movement", { tokenId: hero.id })).combat?.spent ?? null;
    const auto = await ctx.engine("setting", { key: "autoFall", value: "combat" });
    ctx.restore(() => ctx.engine("setting", { key: "autoFall", value: auto.before }));
    ctx.restore(async () => { await endCombat(); await goHome(); await ctx.setHp(hero, hp0).catch(() => {}); });
    // The lent fly speed: put back as it was, or removed (a null value does not clear it).
    ctx.restore(() => ctx.call("update-actor", { actorId: hero.actorId,
      actorData: (fly0 === null) ? { "system.attributes.movement.speeds.-=fly": null } : { "system.attributes.movement.speeds.fly": fly0 } }).catch(() => {}));

    // 1. Hors combat : 3 cases (15 ft) passent, 4 cases (20 ft) non.
    let r = await jump(3);
    ctx.expect((r.result?.done === true) && ((r.after.x !== r.before.x) || (r.after.y !== r.before.y)), `hors combat, 3 cases : saute (limite ${r.options.long} ft, élan ${r.options.runningStart})`);
    await goHome();
    r = await jump(4);
    ctx.expect(r.after.x === r.before.x && r.after.y === r.before.y && r.warnings.some(w => /17/.test(w)), `4 cases : refusé (${r.warnings.join(" | ")})`);

    // 2. In combat, no running start: 2 cells refused; after 2 cells of walking, 3 cells pass.
    await fight();
    r = await jump(2);
    ctx.expect(!r.options.runningStart && r.options.long === 8 && r.after.x === r.before.x && r.after.y === r.before.y,
      `sans élan : limite ${r.options.long} ft, 2 cases refusées (${r.warnings.join(" | ")})`);
    await ctx.engine("move", { tokenId: hero.id, cell: at(2) });
    const s0 = await spent();
    r = await jump(5);
    ctx.expect(r.result?.done === true && r.options.runningStart && r.options.long === 17, `après 2 cases de marche : élan, saut de 3 cases (limite ${r.options.long} ft)`);
    const s1 = await spent();
    ctx.expect(Math.abs((s1 - s0) - 15) < 0.01, `le saut coûte 15 ft (${s0} → ${s1})`);
    await endCombat(); await goHome();

    // 3. Boots: 6 cells (30 ft) without a running start for 10 ft; once per turn.
    const { data: boots } = await ctx.call("get-compendium-entry", { uuid: BOOTS });
    const { _id, folder, ownership, _stats, ...bootsData } = boots;
    bootsData.system = { ...bootsData.system, equipped: true, attuned: true };
    const lent = await ctx.call("upsert-actor-item", { actorId: hero.actorId, itemData: bootsData, match: { path: "name", value: bootsData.name } });
    const removeBoots = () => ctx.call("remove-embedded-item", { documentType: "Actor", id: hero.actorId, itemId: lent.id }).catch(() => {});
    ctx.restore(removeBoots);
    await fight();
    r = await jump(6);
    ctx.expect(r.result?.done === true && r.options.fixed?.distance === 30 && r.budget?.fixedJump && Math.abs(r.budget.jumped - 20) < 0.01,
      `Bottes : 6 cases sans élan, saut fixe (rendu ${r.budget?.jumped} ft)`);
    ctx.expect(Math.abs((await spent()) - 10) < 0.01, `déplacement compté : ${await spent()} ft (10 attendus)`);
    r = await jump(9);
    ctx.expect(r.after.x === r.before.x && r.after.y === r.before.y && r.options.fixed === null, `second saut fixe le même tour : refusé (${r.warnings.join(" | ")})`);
    await endCombat(); await goHome();
    await removeBoots();   // otherwise the Boots (9 m) would also allow high jumps farther
    await pause(500);

    // 4. Difficult Terrain on arrival: the Acrobatics check.
    const land = at(2);
    const region = await ctx.call("create-region", { sceneId: (await ctx.scene()).sceneId, name: "DAS test terrain difficile", shapes: [{ type: "rectangle", x: land.j * grid, y: land.i * grid, width: grid, height: grid }],
      behaviors: [{ type: "dnd5e.difficultTerrain", system: { magical: false, types: [] } }] }).catch(err => ({ error: err.message }));
    const regionId = region?.id ?? region?.regionId ?? region?.region?._id;
    if ( regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: regionId }).catch(() => {}));
    if ( ctx.expect(!!regionId, `région de terrain difficile posée (${region?.error ?? regionId})`) ) {
      const since = await ctx.lastMessageId();
      r = await jump(2);
      await pause(1500);
      const roll = (await ctx.messagesSince(since)).filter(m => (m.rolls ?? []).some(x => /d20/.test(x.formula ?? ""))).at(-1);
      const total = roll?.rolls?.[0]?.total;
      ctx.expect(r.result?.done === true && Number.isFinite(total), `atterrissage en terrain difficile : test d'Acrobaties (${total})`);
      ctx.expect(r.statuses.includes("prone") === (total < 10), `À terre ⇔ total < 10 (${total}, À terre ${r.statuses.includes("prone")})`);
      await goHome();
    }

    // 4 bis. High jump onto a platform (Surface of one cell): at 5 ft, the long jump is refused, the high jump passes (6 ft
    // at most); at 10 ft, too high.
    const step = at(1);
    const platform = async elevation => {
      const r = await ctx.call("create-surface", { sceneId: (await ctx.scene()).sceneId, name: `DAS test estrade ${elevation} ft`, elevation,
        shapes: [{ type: "rectangle", x: step.j * grid, y: step.i * grid, width: grid, height: grid }], blocks: ["move"] }).catch(err => ({ error: err.message }));
      const id = r?.id ?? r?.regionId ?? r?.region?.id ?? r?.surface?.regionId;
      if ( id ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {}));
      return id ?? null;
    };
    const low = await platform(5);
    if ( ctx.expect(!!low, "estrade à 5 ft posée") ) {
      r = await jump(1);
      ctx.expect(r.after.elevation === 0 && r.warnings.length, `saut en longueur sur l'estrade : refusé (${r.warnings.join(" | ")})`);
      r = await jump(1, true);
      ctx.expect(r.result?.done === true && r.after.elevation === 5, `saut en hauteur : sur l'estrade à ${r.after.elevation} ft (limite ${r.options.high} ft)`);
      await goHome();
      await ctx.call("delete-scene-object", { type: "Region", objectId: low }).catch(() => {});
      await pause(500);
    }
    const tall = await platform(10);
    if ( ctx.expect(!!tall, "estrade à 10 ft posée") ) {
      r = await jump(1, true);
      ctx.expect(r.after.elevation === 0 && r.warnings.some(w => /6/.test(w)), `estrade à 10 ft : trop haut (${r.warnings.join(" | ")})`);
      await ctx.call("delete-scene-object", { type: "Region", objectId: tall }).catch(() => {});
      await goHome();
    }

    // 5. Chute automatique en combat.
    await ctx.call("update-actor", { actorId: hero.actorId, actorData: { "system.attributes.movement.speeds.fly": 30 } });
    await fight();
    const aloft = async () => {
      await ctx.call("move-token", { tokenId: hero.id, x: home.x, y: home.y, elevation: 20 });
      await ctx.call("update-scene-object", { type: "Token", objectId: hero.id, data: { movementAction: "fly" } });
      await pause(800);
    };
    const landed = async () => {
      for ( let i = 0; i < 20; i++ ) { const p = await ctx.position(hero); if ( (p.elevation ?? 0) === 0 ) return true; await pause(500); }
      return false;
    };
    await aloft();
    await ctx.setHp(hero, hp0);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: true });
    ctx.expect(await landed(), "volant mis À terre à 20 ft : il tombe tout seul (« En chute » de dnd5e)");
    // The damage follows the end of the 3D dice (waitForDice, 8 s at most): we wait for it instead of a fixed delay.
    let hurt = hp0;
    for ( let i = 0; (i < 24) && (hurt >= hp0); i++ ) { await pause(500); hurt = await ctx.hp(hero); }
    ctx.expect(hurt < hp0, `dégâts de chute appliqués (${hp0} → ${hurt})`);
    await ctx.call("set-status", { tokenId: hero.id, statusId: "prone", active: false });
    await ctx.setHp(hero, hp0);
    await aloft();
    await ctx.call("set-status", { tokenId: hero.id, statusId: "grappled", active: true });
    ctx.expect(await landed(), "volant Agrippé à 20 ft : il tombe aussi (Vitesse 0, règles 2024)");
  }
};
