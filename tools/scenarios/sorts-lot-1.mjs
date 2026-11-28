/**
 * Level 1 to 3 Cleric and Druid spells covered but never replayed (SPEC §37.5), first batch, world `dnd-6`. The Cleric receives
 * the Player's Handbook spells (at will, nothing consumed) and casts them from the free column of Restored Keep (3080 × 4900);
 * the Fighter stands in contact with him (3080 × 5040). Consistency checks:
 *  - Cure Wounds: HP regained = the roll (capped at the maximum);
 *  - Beacon of Hope: then Cure Wounds → the roll's maximum;
 *  - Prayer of Healing: heals; recast on the same target, nothing ("can benefit from it only once per Long Rest");
 *  - Charm Person: the Zombie (Undead) is not affected; the Bandit: Charmed ⇔ failed saving throw;
 *  - Calm Emotions: a single effect, the chosen one, on the Bandit if he fails;
 *  - Ice Knife: the burst makes the Bandit save, hit or not;
 *  - Heat Metal: fire damage to the Bandit at placement;
 *  - Spike Growth: the Zombie crosses two cells of the area → a replay at 4d4;
 *  - Darkvision: the effect placed on the Fighter grants Darkvision.
 * Puts back positions, HP, effects, areas.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const SPELLS = { cure: "phbsplCureWounds", prayer: "phbsplPrayerofHe", charm: "phbsplCharmPerso", calm: "phbsplCalmEmotio",
  beacon: "phbsplBeaconofHo", knife: "phbsplIceKnife00", heat: "phbsplHeatMetal0", spikes: "phbsplSpikeGrowt", darkvision: "phbsplDarkvision" };
/** The maximum of a "2d8 + 3" formula (dice at maximum, constants kept). */
// Each die replaced by its maximum, then the expression evaluated: since §233, the formula arrives already maximized
// ("(2 * 8) + 3"), parentheses and products included — the former term-by-term sum read 3 from it.
const maxOf = formula => {
  const expr = String(formula ?? "").replace(/(\d*)d(\d+)/g, (_, n, f) => String((Number(n) || 1) * Number(f)));
  return /^[\d\s+\-*/().]+$/.test(expr) ? Function(`return (${expr})`)() : NaN;
};

export default {
  name: "sorts, premier lot — Soins, Lueur d'espoir, Prière, Charme, Apaisement, Couteau de glace, Chauffer le métal, Épines, Vision",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Clerc", "Guerrier", "Bandit", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    const ids = {};
    for ( const [k, id] of Object.entries(SPELLS) ) ids[k] = await ctx.ensureItem(cleric, PHB + id, { system: { method: "atwill" } });

    const all = [cleric, fighter, bandit, zombi];
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    const { data: bdata } = await ctx.call("get-scene-object", { type: "Token", objectId: bandit.id });
    const max0 = bdata.delta?.system?.attributes?.hp?.max ?? null;
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id,
      data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    const tough = () => ctx.call("update-scene-object", { type: "Token", objectId: bandit.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const added = async t => (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura);
    const clearNew = async t => {
      const target = await targetOf(t);
      for ( const e of await added(t) ) await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
    };
    const regions = [];
    const reset = async () => {
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of all ) await clearNew(t);
      for ( const t of all ) {
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        if ( t.id !== bandit.id ) await ctx.setHp(t, h.hp);
      }
      await pause(700);
    };
    ctx.restore(reset);
    const place = async () => {
      await ctx.call("move-token", { tokenId: cleric.id, x: 3080, y: 4900, elevation: 0 });
      await ctx.call("move-token", { tokenId: fighter.id, x: 3080, y: 5040, elevation: 0 });
      await pause(700);
    };
    const part = async (label, fn) => {
      if ( process.env.PART && !label.includes(process.env.PART) ) return;
      try { await reset(); await place(); await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await pause(600);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };
    /**
     * Casts a Cleric spell; returns the resolution and the messages produced. `roll`: the healing or damage roll that the engine
     * expects from the author (the connector only rolls attacks) — the card's click, `api.mcp.rollCard`.
     */
    const cast = async (key, { roll=false, ...extra }={}) => {
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: cleric.id, itemId: ids[key], consume: false, ...extra });
      if ( used.regionId ) regions.push(used.regionId);
      if ( roll && used.usageMessageId ) { await pause(800); await ctx.engine("rollCard", { messageId: used.usageMessageId }).catch(() => null); }
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return { used, r, msgs: await ctx.messagesSince(since) };
    };
    const hurt = async (t, hp=1) => ctx.setHp(t, hp);
    const healed = async (t, from) => (await ctx.hp(t)) - from;
    const maxHp = async t => (await ctx.engine("stats", { tokenId: t.id }))?.hp?.max ?? Infinity;
    const rollTotal = m => (m?.rolls ?? []).reduce((s, r) => s + (r.total ?? 0), 0);
    const rollFormula = m => (m?.rolls ?? []).map(r => r.formula).join(" + ");

    await part("Soins", async () => {
      await hurt(fighter);
      const { msgs } = await cast("cure", { roll: true, targetTokenIds: [fighter.id] });
      const heal = msgs.find(m => m.type === "healing");
      const gained = await healed(fighter, 1);
      const expected = Math.min(rollTotal(heal), (await maxHp(fighter)) - 1);
      ctx.expect(!!heal && (gained === expected), `Soins : jet ${rollTotal(heal)} (${rollFormula(heal)}), ${gained} PV regagnés (attendu ${expected})`);
    });

    await part("Lueur d'espoir", async () => {
      await cast("beacon", { targetTokenIds: [fighter.id] });
      ctx.expect((await added(fighter)).length > 0, "Lueur d'espoir posée sur le Guerrier");
      await hurt(fighter);
      const { msgs } = await cast("cure", { roll: true, targetTokenIds: [fighter.id] });
      const heal = msgs.find(m => m.type === "healing");
      const gained = await healed(fighter, 1);
      const expected = Math.min(maxOf(rollFormula(heal)), (await maxHp(fighter)) - 1);
      ctx.expect(!!heal && (gained === expected), `sous Lueur d'espoir : ${gained} PV regagnés, le maximum de « ${rollFormula(heal)} » (${expected})`);
      // The Fighter has few HP: the cap can mask the maximum; the engine's trace says so.
      const maxed = (await ctx.engineLog()).slice(-20).some(l => /soin au maximum|maximum healing/.test(l));
      ctx.expect(maxed, "le moteur a soigné au maximum (trace « soin au maximum »)");
    });

    await part("Prière de guérison", async () => {
      await hurt(fighter);
      await cast("prayer", { roll: true, targetTokenIds: [fighter.id] });
      const first = await healed(fighter, 1);
      ctx.expect(first > 0, `Prière : le Guerrier regagne ${first} PV`);
      await hurt(fighter);
      const again = await cast("prayer", { roll: true, targetTokenIds: [fighter.id] });
      const second = await healed(fighter, 1);
      const t = again.r?.targets?.find(x => x.name === fighter.name || x.name === "Guerrier");
      ctx.expect(second === 0, `relancée sur le même : rien (${second} PV ; ${JSON.stringify(t?.unaffected ?? t?.reason ?? null)})`);
    });

    await part("Charme-personne", async () => {
      const onZombi = await cast("charm", { activityType: "save", targetTokenIds: [zombi.id] });
      const z = onZombi.r?.targets?.find(x => x.name === "Zombi");
      ctx.expect(!(await added(zombi)).length, `le Zombi (mort-vivant) n'est pas charmé (${JSON.stringify(z?.unaffected ?? z?.save ?? null)})`);
      const seen = { failed: false, saved: false };
      for ( let n = 1; (n <= 15) && !(seen.failed && seen.saved); n++ ) {
        await clearNew(bandit);
        const { r } = await cast("charm", { activityType: "save", targetTokenIds: [bandit.id] });
        const t = r?.targets?.find(x => x.name === "Bandit");
        if ( !t?.save ) continue;
        const charmed = (await added(bandit)).some(e => (e.statuses ?? []).includes("charmed"));
        seen[t.save.success ? "saved" : "failed"] = true;
        ctx.expect(charmed === !t.save.success, `Bandit : sauvegarde ${t.save.total} ${t.save.success ? "réussie" : "ratée"}, Charmé ${charmed}`);
      }
      ctx.expect(seen.failed, "une sauvegarde ratée du Bandit vue (15 essais au plus)");
    });

    await part("Apaisement des émotions", async () => {
      // An area ignores a creature at 0 HP (the `dnd-6` Bandit sometimes is one, the caster does not raise the dead).
      await tough();
      let posed = null;
      for ( let n = 1; (n <= 15) && !posed; n++ ) {
        await clearNew(bandit);
        // An area spell (6 m Sphere): without a placed area, the engine waits for the region — a small area on the Bandit alone.
        const b = await ctx.position(bandit);
        const { r } = await cast("calm", { activityType: "save", area: { shape: "circle", x: b.x + grid / 2, y: b.y + grid / 2, radius: grid / 2 },
          usageConfig: { [MODULE_ID]: { choice: "cb3KFq1j9UkOUV2l" } } });
        for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
        if ( r?.targets?.find(x => x.name === "Bandit")?.save?.success === false ) posed = await added(bandit);
      }
      if ( !ctx.expect(!!posed, "le Bandit rate sa sauvegarde (15 essais au plus)") ) return;
      ctx.expect(posed.length === 1 && /Indiff/i.test(posed[0].name ?? ""), `un seul effet, le choisi (${posed.map(e => e.name).join(", ")})`);
    });

    await part("Couteau de glace", async () => {
      await tough();
      const { msgs } = await cast("knife", { activityType: "attack", targetTokenIds: [bandit.id] });
      let save = null;
      for ( const stop = Date.now() + 15000; !save && (Date.now() < stop); await pause(800) ) {
        save = (await ctx.messagesSince(msgs[0]?.id ?? null)).find(m => (m.type === "save") && (m.alias === "Bandit"));
      }
      ctx.expect(!!save, `l'éclat fait sauvegarder le Bandit (${rollFormula(save)} = ${rollTotal(save)})`);
    });

    await part("Chauffer le métal", async () => {
      await tough();
      const before = await ctx.hp(bandit);
      // The placement's damage activity ("Cast": 2d8 fire), which chains the saving throw (content `burst`).
      const { msgs } = await cast("heat", { roll: true, activityId: "2jWlvr2titPfBMEm", targetTokenIds: [bandit.id] });
      await pause(1500);
      const damage = (await ctx.messagesSince(msgs[0]?.id ?? null)).concat(msgs).find(m => m.type === "damage");
      const lost = before - (await ctx.hp(bandit));
      ctx.expect(!!damage && (lost > 0), `dégâts à la pose : ${rollFormula(damage)} = ${rollTotal(damage)}, ${lost} PV perdus`);
    });

    await part("Croissance d'épines", async () => {
      // The area: three columns of three cells (2940 → 3220, 5180 → 5460); the Zombie starts from 5040 and goes down two
      // cells into it. §84: since §69 the area is Difficult Terrain, and the engine's A* goes around it: a single column let the
      // Zombie pass beside it and enter only at the last cell (2d4). Three columns: no detour is cheaper than the crossing.
      await ctx.call("move-token", { tokenId: fighter.id, x: 2800, y: 5460, elevation: 0 });
      await ctx.call("move-token", { tokenId: zombi.id, x: 3080, y: 5040, elevation: 0 });
      await pause(700);
      await cast("spikes", { activityType: "damage", area: { shape: "rectangle", x: 2940, y: 5180, width: 3 * grid, height: 3 * grid } });
      const since = await ctx.lastMessageId();
      // The engine's real movement (A*, path traveled): `move-token` moves in place, with no cells crossed.
      await ctx.engine("move", { tokenId: zombi.id, point: { x: 3080 + grid / 2, y: 5320 + grid / 2 } });
      let tick = null;
      for ( const stop = Date.now() + 15000; !tick && (Date.now() < stop); await pause(800) ) {
        tick = (await ctx.messagesSince(since)).find(m => (m.type === "damage") && /\d+d4/.test(rollFormula(m)));
      }
      ctx.expect(!!tick && /4d4/.test(rollFormula(tick)), `deux cases dans les épines : ${rollFormula(tick) || "aucun jet"}`);
    });

    await part("Vision dans le noir", async () => {
      await cast("darkvision", { targetTokenIds: [fighter.id] });
      const fx = await added(fighter);
      const change = fx.flatMap(e => e.system?.changes ?? e.changes ?? []).find(c => /darkvision/.test(c.key ?? ""));
      ctx.expect(!!change, `effet posé sur le Guerrier (${fx.map(e => e.name).join(", ")}) : ${change?.key} = ${change?.value}`);
    });
  }
};
