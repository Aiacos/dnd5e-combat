/**
 * Cleric and druid spells coded but never played (issues #4 to #6, 2026-09-27). The Cleric casts (spells added at
 * will for the scenario, removed at the end), the Zombie (Undead) strikes or suffers:
 *  1. Protection from Evil and Good on the Fighter: the Zombie's attack has Disadvantage; without the protection, not.
 *  2. Warding Bond on the Fighter: the Zombie hits him, the Cleric loses as many HP — through the engine (the BLFX
 *     flag, if one is placed, is removed from the effect so that the engine does the sharing).
 *  3. Blindness/Deafness on the Zombie, Blindness chosen: a single effect (Blinded); in combat, repeated saving throw at the end of
 *     each of its turns, the effect ends on a success.
 *  4. Sleet Storm on the Zombie: nothing at placement (§300); at the start of its turn, the spell replays (message marked
 *     `areaTick`).
 *  5. Aura of Vitality, "Start-of-turn healing" on the wounded Fighter: the healing cast is applied.
 *  6. Summon Fey, in combat: the spirit enters right after the Cleric (Initiative between the Cleric and the next one);
 *     the end of Concentration removes it. Placement on a fixed cell (`api.mcp.summonAt`).
 * Each part puts back HP, effects, conditions, areas, positions and combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const rollOf = m => { const raw = m?.rolls?.[0]; return (typeof raw === "string") ? JSON.parse(raw) : raw; };

export default {
  name: "sorts codés — Protection contre le mal et le bien, Lien de protection, Cécité/surdité, Tempête de neige, Aura de vitalité, Convocation de fée",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const atWill = { system: { method: "atwill" } };
    for ( const id of ["phbEvilAndGoodPr", "phbsplWardingBon", "phbsplBlindnessD"] ) await ctx.ensureItem(cleric, SRD + id, atWill);
    for ( const id of ["phbsplSleetStorm", "phbsplAuraofVita", "phbsplSummonFey0"] ) await ctx.ensureItem(cleric, PHB + id, atWill);

    const all = [cleric, fighter, zombi];
    const hp0 = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      hp0.set(t.id, await ctx.hp(t));
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const home = await ctx.position(zombi);
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
        await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
      }
    };
    const regions = [];
    const reset = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of all ) await clearNew(t);
      for ( const t of all ) await ctx.setHp(t, hp0.get(t.id));
      await ctx.call("move-token", { tokenId: zombi.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
    };
    const named = async (t, pattern) => (await ctx.effects(t)).filter(e => pattern.test(e.name ?? ""));
    const statuses = async t => (await ctx.effects(t)).flatMap(e => e.statuses ?? []);
    const castOn = async (identifier, target, extra={}) => {
      const used = await ctx.use({ tokenId: cleric.id, identifier, consume: false, targetTokenIds: [target.id], ...extra });
      await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      return used;
    };
    const zItems = (await ctx.call("get-actor", { actorId: zombi.actorId })).items ?? [];
    const weapon = zItems.find(i => (i.type === "weapon") && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    const nextTo = async t => {
      const p = await ctx.position(t);
      await ctx.call("move-token", { tokenId: zombi.id, x: p.x - grid, y: p.y, elevation: p.elevation });
      await pause(800);
    };
    /** A Zombie attack; `untilHit`: replayed until it hits. Returns the resolution, the roll and the messages. */
    const strike = async (target, { untilHit=false }={}) => {
      for ( let i = 0; i < (untilHit ? 20 : 1); i++ ) {
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: zombi.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [target.id] });
        const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 });
        await pause(2500);
        const messages = await ctx.messagesSince(since);
        const hit = !!r.targets.find(t => t.name === target.name)?.hit;
        if ( untilHit && !hit ) { await ctx.setHp(target, hp0.get(target.id)); continue; }
        return { r, hit, messages, attack: rollOf(messages.find(m => m.type === "attack")) };
      }
      return null;
    };
    const combatWith = async (list, initiatives) => {
      await ctx.startCombat(list);
      const c = await ctx.combat();
      for ( const [t, value] of initiatives ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      return ctx.combat();
    };
    const endCombat = async () => {
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
    };

    // 1. Protection contre le mal et le bien.
    await part("Protection contre le mal et le bien", async () => {
      if ( !ctx.expect(!!weapon, `le Zombi a une attaque (${weapon?.name})`) ) return;
      await castOn("protection-from-evil-and-good", fighter);
      ctx.expect((await named(fighter, /Protégé|Protected/i)).length === 1, "Protection : l'effet est posé sur le Guerrier");
      await nextTo(fighter);
      const withIt = await strike(fighter);
      ctx.expect(withIt?.attack?.options?.advantageMode === -1, `attaque du Zombi (mort-vivant) contre le Guerrier protégé : Désavantage (${withIt?.attack?.formula}, mode ${withIt?.attack?.options?.advantageMode})`);
      await clearNew(fighter);
      await clearNew(cleric);
      await pause(800);
      const without = await strike(fighter);
      ctx.expect(without?.attack?.options?.advantageMode !== -1, `sans la protection : pas de Désavantage (${without?.attack?.formula}, mode ${without?.attack?.options?.advantageMode})`);
    });

    // 2. Lien de protection, par le moteur.
    await part("Lien de protection", async () => {
      if ( !weapon ) return;
      await castOn("warding-bond", fighter);
      const bond = (await named(fighter, /^Lié$|Warding Bond|Bond/i))[0];
      if ( !ctx.expect(!!bond, "Lien de protection : l'effet « Lié » est posé sur le Guerrier") ) return;
      if ( bond.flags?.["boss-loot-assets-premium"]?.blfxCustom ) {
        await ctx.call("upsert-embedded-effect", { ...(await targetOf(fighter)), match: { path: "_id", value: bond._id ?? bond.id },
          effectData: { "flags.boss-loot-assets-premium.-=blfxCustom": null } });
        ctx.log("drapeau BLFX retiré de l'effet : c'est le moteur qui partage");
      }
      await nextTo(fighter);
      // Temporary Hit Points left by a previous scenario would absorb the Cleric's share: removed for the duration of the reading.
      await ctx.call("update-actor", { actorId: cleric.actorId, actorData: { "system.attributes.hp.temp": 0 } }).catch(() => {});
      const clericBefore = await ctx.hp(cleric);
      const hit = await strike(fighter, { untilHit: true });
      if ( !ctx.expect(!!hit, "le Zombi touche le Guerrier (20 essais au plus)") ) return;
      const lostFighter = hp0.get(fighter.id) - await ctx.hp(fighter);
      const lostCleric = clericBefore - await ctx.hp(cleric);
      const shared = hit.messages.some(m => m.flags?.[MODULE_ID]?.shared) || (await ctx.engineLog()).slice(-15).some(l => /partag|Lien|shar|link/i.test(l));
      ctx.expect(shared, "partage annoncé par le moteur");
      ctx.expect((lostFighter > 0) && (lostCleric === Math.min(lostFighter, clericBefore)), `le Guerrier perd ${lostFighter} PV, le Clerc aussi : ${lostCleric}`);
    });

    // 3. Blindness/Deafness, Blindness chosen, then repeated saving throw at end of turn.
    await part("Cécité/surdité", async () => {
      let blinded = null;
      for ( let n = 1; (n <= 20) && !blinded; n++ ) {
        await castOn("blindness-deafness", zombi, { activityType: "save", usageConfig: { [MODULE_ID]: { choice: "MIYqFloILx3luzwc" } } });
        const posed = await named(zombi, /Cécité|Surdité|Blind|Deaf/i);
        if ( posed.length ) blinded = posed;
      }
      if ( !ctx.expect(!!blinded, "Cécité/surdité : le Zombi rate une sauvegarde (20 essais au plus)") ) return;
      ctx.expect((blinded.length === 1) && (await statuses(zombi)).includes("blinded") && !(await statuses(zombi)).includes("deafened"),
        `un seul effet, Aveuglé (${blinded.map(e => e.name).join(", ")})`);
      await combatWith([cleric, zombi], [[cleric, 20], [zombi, 10]]);
      // The spell lasts 1 minute (10 rounds): we stop before, so that the effect ends only on a successful saving throw.
      // Two combatants: every second turn change ends the Zombie's turn.
      let removed = null;
      let resaves = 0;
      for ( let turn = 0; (turn < 16) && !removed; turn++ ) {
        const since = await ctx.lastMessageId();
        await ctx.nextTurn();
        await pause(2500);
        const resave = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);
        if ( !resave ) continue;
        resaves++;
        const r = await ctx.settle(resave.id).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Zombi");
        await pause(800);
        const still = (await statuses(zombi)).includes("blinded");
        ctx.expect(!!t?.save && (still === !t.save.success), `sauvegarde répétée ${t?.save?.total} contre DD ${r?.plan?.save?.dc} : ${t?.save?.success ? "réussie, Aveuglé retiré" : "ratée, Aveuglé reste"}`);
        if ( !still ) removed = t;
      }
      ctx.expect(resaves > 0, `sauvegarde répétée jouée à la fin des tours du Zombi (${resaves})`);
      ctx.expect(!!removed?.save?.success, "Aveuglé tombe sur une sauvegarde répétée réussie (en 8 rounds au plus)");
      await endCombat();
    });

    // 4. Sleet Storm: nothing at placement (§300, 2024 text: saving throw on entry and at the start of the turn),
    // replay at the start of the Zombie's turn.
    await part("Tempête de neige", async () => {
      await ctx.removeStatusEffects(zombi, "prone");
      const box = await ctx.box(zombi);
      const used = await ctx.use({ tokenId: cleric.id, identifier: "sleet-storm", activityType: "save", consume: false,
        area: { shape: "circle", x: box.x + (box.width / 2), y: box.y + (box.height / 2), radius: Math.round(grid * 0.9) } });
      if ( used.regionId ) regions.push(used.regionId);
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1500);
      const t = r?.targets?.find(x => x.name === "Zombi");
      ctx.expect(!t?.save, `Tempête de neige : pas de sauvegarde à la pose (${t?.save?.total ?? "aucune"})`);
      ctx.expect(!(await statuses(zombi)).includes("prone"), "le Zombi reste debout à la pose");
      await combatWith([cleric, zombi], [[cleric, 20], [zombi, 10]]);
      const since = await ctx.lastMessageId();
      await ctx.nextTurn();   // Cleric → Zombie: start of its turn in the area
      await pause(3500);
      const tick = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.areaTick));
      ctx.expect(!!tick, "début du tour du Zombi dans la zone : le sort rejoue (message marqué areaTick)");
      await endCombat();
    });

    // 5. Aura of Vitality: the start-of-turn healing.
    await part("Aura de vitalité", async () => {
      await ctx.setHp(fighter, Math.max(1, hp0.get(fighter.id) - 9));
      const before = await ctx.hp(fighter);
      const used = await ctx.use({ tokenId: cleric.id, identifier: "aura-of-vitality", activityId: "0vYjMbBcXaMfGWR2", consume: false, targetTokenIds: [fighter.id] });
      await pause(1200);
      await ctx.engine("rollCard", { messageId: used.usageMessageId });
      const r = await ctx.settle(used.usageMessageId).catch(() => null);
      await pause(1200);
      const healing = rollOf((await ctx.messagesSince(used.usageMessageId)).find(m => m.type === "healing" || m.type === "damage"));
      const after = await ctx.hp(fighter);
      ctx.expect(!!r && (r.step === "done"), `résolution tranchée (${r?.step ?? "aucune"})`);
      ctx.expect((after > before) && (after - before === Math.min(healing?.total ?? -1, hp0.get(fighter.id) - before)),
        `soin appliqué : ${before} → ${after} PV (jet ${healing?.total ?? "?"})`);
    });

    // 6. Summon Fey, in combat.
    await part("Convocation de fée", async () => {
      await combatWith([cleric, zombi], [[cleric, 15], [zombi, 10]]);
      const p = await ctx.position(cleric);
      const itemId = await ctx.itemId(cleric.id, "summon-fey");
      const s = await ctx.engine("summonAt", { tokenId: cleric.id, itemId, x: p.x + grid, y: p.y + grid });
      const spirit = s?.tokens?.[0];
      if ( !ctx.expect(!!spirit, `un esprit féerique est invoqué (${spirit?.name ?? JSON.stringify(s)})`) ) return;
      await pause(2500);
      const c = await ctx.combat();
      const cb = (c.combatants ?? []).find(x => (x.tokenId === spirit.id) || (x.name === spirit.name));
      ctx.expect(!!cb && (cb.initiative < 15) && (cb.initiative > 10), `il entre au combat juste après le Clerc (initiative ${cb?.initiative ?? "absente"})`);
      await ctx.removeEffectsNamed(cleric, /concentr/i);
      await pause(2500);
      const left = await ctx.liveTokens();
      ctx.expect(!left.some(t => t.id === spirit.id), "fin de la concentration : l'esprit est retiré");
      await endCombat();
    });
  }
};
