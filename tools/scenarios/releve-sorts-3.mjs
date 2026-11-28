/**
 * Spell survey, batch 2: lasting areas (SPEC §158), world `dnd-6`, arena. The Wizard casts each spell (lent from the Player's
 * Handbook, at will) as a small area on the target alone, then a combat (Wizard, target) plays the turns:
 *  - the area replays at the stated moment (start or end of the target's turn: a use message `areaTick`);
 *  - Grease: Prone ⇔ failed save; Web: Restrained ⇔ failed, no fire damage, and a check to break free;
 *    Evard's Black Tentacles: Restrained, and the check to break free;
 *  - Cloudkill: the area moves 3 m away from the caster at the start of its turn;
 *  - Jallarzi's Storm of Radiance: Blinded carried by the area (removed when the target leaves it);
 *  - Stinking Cloud (the Bandit: the Zombie is immune to Poisoned): failed at the start of its turn → no action or Bonus Action.
 * Target's HP raised to 300 for the scenario. Restores positions, HP, effects, areas, combat.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "relevé des sorts, lot 2 — zones qui durent",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const names = ["Magicien", "Zombi", "Bandit"];
    if ( !names.every(n => tokens.some(t => t.name === n)) ) { ctx.log(`${names.join(", ")} requis : non applicable`); return; }
    const [mage, zombi, bandit] = await Promise.all(names.map(n => ctx.token(n)));
    const all = [mage, zombi, bandit];
    const grid = await ctx.gridSize();
    const homes = new Map();
    const effects0 = new Map();
    for ( const t of all ) {
      homes.set(t.id, { pos: await ctx.position(t), hp: await ctx.hp(t) });
      effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id)));
    }
    // HP to absorb half a dozen areas.
    for ( const t of [zombi, bandit] ) {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const max0 = data.delta?.system?.attributes?.hp?.max ?? null;
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: t.id,
        data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
    }
    const tough = t => ctx.call("update-scene-object", { type: "Token", objectId: t.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    const sceneId = (await ctx.scene()).sceneId;
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
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
      if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
      ctx.ownCombat = null;
      for ( const id of regions.splice(0) ) await ctx.call("delete-scene-object", { type: "Region", objectId: id }).catch(() => {});
      for ( const t of all ) {
        await clearNew(t);
        const h = homes.get(t.id);
        await ctx.call("move-token", { tokenId: t.id, x: h.pos.x, y: h.pos.y, elevation: h.pos.elevation }).catch(() => {});
        await ctx.setHp(t, h.hp);
      }
      await pause(800);
    };
    ctx.restore(reset);
    const part = async (name, fn) => {
      try { await fn(); } catch ( err ) { ctx.expect(false, `${name} : ${err.message}`); }
      await reset();
    };
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId; };
    const fight = async order => {
      await ctx.startCombat(order);
      const c = await state();
      for ( const [i, t] of order.entries() ) {
        await ctx.call("set-initiative", { combatantId: c.combatants.find(x => x.tokenId === t.id).id, value: 20 - 5 * i, combatId: ctx.ownCombat });
      }
      for ( let i = 0; (i < 4) && ((await current()) !== order[0].id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1200); }
      return (await current()) === order[0].id;
    };
    const next = async () => { await ctx.call("next-turn", { combatId: ctx.ownCombat }); await pause(3500); };
    const statuses = async t => (await ctx.effects(t)).filter(e => !e.disabled).flatMap(e => e.statuses ?? []);
    /** Places the spell (the Handbook's `id`) as a small area on `target`, on the Wizard's turn; returns its resolution. */
    const cast = async (id, target, activityType="save") => {
      const itemId = await ctx.ensureItem(mage, PHB + id, { system: { method: "atwill" } });
      await tough(target);
      if ( !ctx.expect(await fight([mage, target]), `${id} : tour du Magicien`) ) return null;
      const b = await ctx.box(target);
      const used = await ctx.use({ tokenId: mage.id, itemId, activityType, consume: false,
        area: { shape: "circle", x: b.x + b.width / 2, y: b.y + b.height / 2, radius: b.width * 0.6 } });
      if ( used.regionId ) regions.push(used.regionId);
      ctx.expect(!!used.regionId, `${id} : zone posée`);
      const r = used.usageMessageId ? await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null) : null;
      await pause(1500);
      return { used, r };
    };
    /** The area's replay on the target since `since` (message `areaTick`), its resolution. */
    const replayOf = async (since, target) => {
      const m = (await ctx.messagesSince(since)).find(x => (x.type === "usage") && (x.flags?.[MODULE_ID]?.areaTick ?? x.flags?.areaTick));
      if ( !m ) return null;
      const r = await ctx.settle(m.id, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      return r?.targets?.find(t => t.name === target.name) ?? { none: true };
    };

    /** Replay at the start (turnStart) or end (turnEnd) of the target's turn; `status`: the condition placed on a failed save. */
    const zoneCase = (label, id, target, { at, status=null, activityType="save", after=null }) => part(label, async () => {
      const c = await cast(id, target, activityType);
      if ( !c?.used?.usageMessageId ) return;
      if ( status ) await ctx.removeStatusEffects(target, status).catch(() => {});
      const hp = await ctx.hp(target);
      const since = await ctx.lastMessageId();
      await next();                              // target's turn (start: turnStart)
      if ( at === "turnEnd" ) await next();       // fin de son tour
      const t = await replayOf(since, target);
      if ( !ctx.expect(!!t && !t.none, `${label} : la zone rejoue au ${at === "turnStart" ? "début" : "fin"} du tour de la cible`) ) return;
      if ( status ) {
        const has = (await statuses(target)).includes(status);
        ctx.expect(has === (t.save?.success === false), `${label} : sauvegarde ${t.save?.total} ${t.save?.success ? "réussie" : "ratée"} → ${has ? status : `pas ${status}`}`);
      }
      if ( after ) await after({ t, hp, target });
    });

    await zoneCase("Graisse", "phbsplGrease0000", zombi, { at: "turnEnd", status: "prone" });
    await zoneCase("Toile d'araignée", "phbsplWeb0000000", zombi, { at: "turnStart", status: "restrained", after: async ({ t, hp, target }) => {
      ctx.expect((await ctx.hp(target)) === hp, `Toile d'araignée : pas de dégâts de feu au rejeu (${hp} → ${await ctx.hp(target)})`);
      if ( t.save?.success === false ) {
        const own = (await ctx.engine("endings", { tokenId: target.id })).own ?? [];
        ctx.expect(own.some(e => e.roll === "check" && Number.isFinite(e.dc)), `Toile d'araignée : un test pour se libérer (${own.map(e => `${e.name} DD ${e.dc}`).join(", ") || "aucun"})`);
      }
    } });
    await zoneCase("Tentacules noirs d'Evard", "phbsplEvardsBlac", zombi, { at: "turnEnd", after: async ({ t, target }) => {
      if ( t.save?.success !== false ) return;
      const own = (await ctx.engine("endings", { tokenId: target.id })).own ?? [];
      ctx.expect(own.some(e => e.roll === "check" && Number.isFinite(e.dc)), `Tentacules : Entravé, un test pour se libérer (${own.map(e => `${e.name} DD ${e.dc}`).join(", ") || "aucun"})`);
    } });
    await zoneCase("Fléau d'insectes", "phbsplInsectPlag", zombi, { at: "turnEnd" });
    await zoneCase("Barrière de lames", "phbsplBladeBarri", zombi, { at: "turnEnd" });
    await zoneCase("Nuage incendiaire", "phbsplIncendiary", zombi, { at: "turnEnd" });

    await part("Brume mortelle", async () => {
      const c = await cast("phbsplCloudkill0", zombi);
      if ( !c?.used?.regionId ) return;
      const centre = async () => {
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: c.used.regionId });
        const s = data.shapes?.[0] ?? {};
        return { x: s.x ?? (s.points ? (Math.min(...s.points.filter((_, i) => !(i % 2))) + Math.max(...s.points.filter((_, i) => !(i % 2)))) / 2 : null),
          y: s.y ?? (s.points ? (Math.min(...s.points.filter((_, i) => i % 2)) + Math.max(...s.points.filter((_, i) => i % 2))) / 2 : null) };
      };
      const before = await centre();
      const since = await ctx.lastMessageId();
      await next(); await next();   // end of the Zombie's turn (replay), then start of the Wizard's turn (drift)
      const t = await replayOf(since, zombi);
      ctx.expect(!!t && !t.none, "Brume mortelle : la zone rejoue à la fin du tour du Zombi");
      const after = await centre();
      const moved = Math.hypot(after.x - before.x, after.y - before.y) / grid;
      ctx.expect(Math.abs(moved - 2) < 0.3, `Brume mortelle : la zone s'éloigne du Magicien de ${moved.toFixed(2)} case(s) (attendu 2)`);
    });

    await part("Tempête radieuse de Jallarzi", async () => {
      const c = await cast("phbsplJallarzisS", zombi);
      if ( !c?.used?.regionId ) return;
      const blind = async () => (await statuses(zombi)).includes("blinded");
      ctx.expect(await blind(), "Jallarzi : Aveuglé dans la zone");
      await ctx.call("move-token", { tokenId: zombi.id, x: homes.get(zombi.id).pos.x - 4 * grid, y: homes.get(zombi.id).pos.y, elevation: 0 });
      await pause(2500);
      ctx.expect(!(await blind()), "Jallarzi : plus Aveuglé hors de la zone");
    });

    await part("Nuage nauséabond", async () => {
      // §438: Handbook 3.0.0 — "Create Cloud" (utility, `UNmK4NzLyiQsdD1S`) places the cloud, the start-of-turn save is a
      // sibling with no area; Handbook 2.2.0 placed the area by its save ("Cast and Save").
      const cloudId = await ctx.ensureItem(mage, PHB + "phbsplStinkingCl", { system: { method: "atwill" } });
      const v3 = !!((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === cloudId)?.system?.activities?.UNmK4NzLyiQsdD1S;
      const c = await cast("phbsplStinkingCl", bandit, v3 ? "utility" : "save");
      if ( !c?.used?.regionId ) return;
      for ( let n = 1; n <= 6; n++ ) {
        const since = await ctx.lastMessageId();
        await next();   // start of the Bandit's turn: the save
        const t = await replayOf(since, bandit);
        if ( !t || t.none ) { ctx.expect(false, "Nuage nauséabond : pas de rejeu au début du tour du Bandit"); return; }
        const b = await ctx.engine("budget", { tokenId: bandit.id });
        if ( t.save?.success === false ) {
          ctx.expect((b?.action === 0) && (b?.bonus === 0), `Nuage nauséabond : ratée → action ${b?.action}, action Bonus ${b?.bonus}`);
          return;
        }
        ctx.log(`Nuage nauséabond : réussie (${t.save?.total}), action ${b?.action}`);
        await next();   // tour du Magicien
      }
      ctx.log("Nuage nauséabond : six réussites, branche ratée non exercée");
    });
  }
};
