/**
 * §403: average gaps of the spell re-pass, second batch — played in the "Spell Arena". `PART=<mot>` only plays the parts whose
 * name contains it.
 *  - malediction: Bestow Curse cast at level 5 → no Concentration, the curse lasts 8 hours.
 *  - liberte: Freedom of Movement on the Target, then Slow's "Slowed" effect → without its Speed changes.
 *  - choc: "Life Shock" (Ravenloft) on the standing Target → neither healing nor lightning; at 0 HP → affected.
 *  - vent: Steel Wind Strike on the Target and its neighbor → two attacks, one per creature, no distribution window.
 *  - elementaires: Conjure Minor Elementals ("Cast") → an Emanation on the Caster, Difficult Terrain except for its
 *    allies.
 *  - bourrasque: in combat, on the Target's turn, two cells in the Line toward the Caster → 10 ft more in the budget (`windward`).
 *  - rayon: the Caster in a Moonbeam → Polymorph (activity "transform") refused by legality.
 *  - symbole: the "Death" glyph triggered → its sphere lasts (end time at 10 minutes), it is not removed after the resolution.
 *  - dissipation: a Moonbeam placed, Dispel Magic without a target → the "which effect" question; the chosen Moonbeam ends.
 *  - compulsion: in combat — without a direction, the Target does not redo its save; direction "east" on the Caster's turn → the
 *    Target walks east on its turn, then redoes its save.
 *  - contre: Enemy in contact against the Caster's Ray of Frost; the Caster can counter this Counterspell (window) → gate card.
 *  - meute: Conjure Animals — the pack in contact with the Caster → the "Strength Save Advantage" effect on them alone;
 *    moved away → removed.
 *  - liane: Grasping Vine — the vine placed 4 cells from the Target; its attack hits → pulled toward the vine (distance
 *    asked), Grappled.
 *  - sphere: Flaming Sphere — in combat, on the Caster's turn, the sphere pushed into contact with the Target → save, then stopped.
 *  - tempete: Storm of Vengeance above the Target and the Ally — on turn 3, the lightning: the "creatures of your choice" question.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const RAVENLOFT = id => `Compendium.dnd-ravenloft-horrors-within.options.Item.${id}`;
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.PART ?? "").toLowerCase();
const wanted = name => !only || name.toLowerCase().includes(only);

/** Runs `use` and answers the windows that open on the GM's side meanwhile. `tail`: waiting turns after `use` ends. */
async function usingWith(ctx, use, answer, { tail=3 }={}) {
  const seen = [];
  const known = new Set(((await ctx.call("list-dialogs", {}).catch(() => null))?.windows ?? []).map(w => w.id));
  let done = false;
  const using = use().catch(err => ({ used: false, reason: err.message })).finally(() => { done = true; });
  for ( let after = 0; after < tail; ) {
    const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known], waitMs: 1500, details: true }).catch(() => null);
    for ( const d of r?.windows ?? [] ) {
      known.add(d.id);
      seen.push(d);
      const params = answer(d);
      if ( params ) await ctx.call("answer-dialog", { id: d.id, ...params }).catch(() => {});
    }
    if ( done ) after++;
  }
  return { used: await using, seen };
}

/** A script in the GM's client; returns its result. */
const script = async (ctx, code) => (await ctx.call("run-script", { code }))?.result;

/** Waits until a placed region is retained as a lasting area (its `area` state), 15 s at most. */
async function lastingZone(ctx, regionId) {
  for ( let i = 0; i < 30; i++ ) {
    if ( await script(ctx, `return !!canvas.scene.regions.get("${regionId ?? ""}")?.getFlag("${MODULE_ID}", "area")?.usage;`) ) return true;
    await pause(500);
  }
  return false;
}

/** Sets the scenario combat's turn on this token. */
async function turnTo(ctx, token) {
  await script(ctx, `const c = game.combats.get("${ctx.ownCombat}"); const i = c.turns.findIndex(k => k.tokenId === "${token.id}"); await c.update({ turn: i }); return i;`);
  await pause(1200);
}

/** Ends the scenario combat (the caster only closes the last one). */
async function endFight(ctx) {
  if ( ctx.ownCombat ) await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {});
  ctx.ownCombat = null;
}

export default {
  name: "écarts moyens des sorts, second lot (§403)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const grid = await ctx.gridSize();
    // The restoration only plays at the end of the scenario: a part that needs the starting places takes them back here.
    const targetHome = await ctx.position(target);

    // ---- Bestow Curse at level 5: no Concentration, 8 hours ----
    if ( wanted("malediction") ) {
      await ctx.ensureItem(caster, PHB("phbsplBestowCurs"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "bestow-curse"); await ctx.removeEffectsFrom(caster, "bestow-curse"); });
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await ctx.removeEffectsFrom(target, "bestow-curse");
        const u = await ctx.use({ tokenId: caster.id, identifier: "bestow-curse", activityId: "azVyTkiGPeIqMzxu", targetTokenIds: [target.id],
          usageConfig: { scaling: 2, spell: { slot: "spell5" } } });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
        failed = true;
        await pause(1500);
        const state = await script(ctx, `const t = canvas.scene.tokens.get("${target.id}"); const c = canvas.scene.tokens.get("${caster.id}");
          const curse = t.actor.effects.find(e => e.name === "Cursed Attacks" || /Attaques maudites|Cursed Attacks/.test(e.name));
          return { duration: curse?.duration?.seconds ?? curse?.duration?.value ?? null, dependent: curse?.getFlag("dnd5e", "dependentOn") ?? null,
            concentrating: c.actor.effects.some(e => e.statuses.has("concentrating") && /Bestow|Malédiction/i.test(e.name)) };`);
        ctx.expect(state?.concentrating === false, `Malédiction niveau 5 : le Lanceur ne se concentre pas (${JSON.stringify(state)})`);
        ctx.expect(state?.duration === 28800, `la malédiction dure 8 heures (${state?.duration} s)`);
      }
      if ( !failed ) ctx.expect(false, "Malédiction : aucun échec en 20 essais");
    }

    // ---- Freedom of Movement: Slow does not reduce Speed ----
    if ( wanted("liberte") ) {
      const fom = await ctx.ensureItem(caster, PHB("phbsplFreedomofM"));
      const slow = await ctx.ensureItem(caster, PHB("phbsplSlow000000"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "freedom-of-movement", "slow"); });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: fom, effectId: "bcTPZ6dJ4kHwaBRD" });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: slow, effectId: "z1lkguBohjqXRSHm" });
      await pause(800);
      const changes = await script(ctx, `const t = canvas.scene.tokens.get("${target.id}");
        const e = t.actor.effects.find(x => x.name === "Slowed" || /Ralenti/.test(x.name)); return e ? (e.system?.changes ?? e.changes).map(c => c.key) : null;`);
      ctx.expect(Array.isArray(changes) && changes.length && !changes.some(k => k.includes("movement")),
        `Liberté de mouvement : « Slowed » posé sans réduction de Vitesse (${JSON.stringify(changes)})`);
    }

    // ---- Life Shock: only at 0 HP ----
    if ( wanted("choc") ) {
      // The Hero (player character): at 0 HP they are unconscious, not dead — an NPC at 0 HP is dead for dnd5e.
      const ally = await ctx.token("Héros");
      await ctx.ensureItem(caster, RAVENLOFT("AVoqeXk2ZFHWZzQB"));
      const hp0 = await ctx.hp(ally);
      ctx.restore(() => ctx.setHp(ally, hp0));
      const standing = await ctx.use({ tokenId: caster.id, identifier: "jolt-to-life", activityId: "xg84KvaBJVjFZQpV", targetTokenIds: [ally.id], rollDamage: true });
      const r1 = standing.usageMessageId ? await ctx.settle(standing.usageMessageId).catch(() => null) : null;
      const t1 = r1?.targets?.find(x => x.name === "Héros");
      ctx.expect(!!t1?.unaffected, `Choc de vie sur une créature debout : non affectée (${JSON.stringify(t1?.unaffected ?? null)})`);
      await ctx.setHp(ally, 0);
      const down = await ctx.use({ tokenId: caster.id, identifier: "jolt-to-life", activityId: "xg84KvaBJVjFZQpV", targetTokenIds: [ally.id], rollDamage: true });
      const r2 = down.usageMessageId ? await ctx.settle(down.usageMessageId).catch(() => null) : null;
      const t2 = r2?.targets?.find(x => x.name === "Héros");
      ctx.expect(!!t2 && !t2.unaffected, `à 0 PV : affectée (${t2 ? JSON.stringify(t2.unaffected) : "pas de cible"})`);
    }

    // ---- Steel Wind Strike: one attack per creature ----
    if ( wanted("vent") ) {
      const other = await ctx.token("Cible voisine");
      await ctx.ensureItem(caster, PHB("phbsplSteelWindS"));
      const home = await ctx.position(caster);
      ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      const since = await ctx.lastMessageId();
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "steel-wind-strike", targetTokenIds: [target.id, other.id] }),
        d => ((d.buttons ?? []).some(b => b.action === "stay") ? { button: "stay" } : null), { tail: 30 });
      const usages = (await ctx.messagesSince(since)).filter(m => m.type === "usage" && /Steel Wind|vent d'acier/i.test(m.flavor ?? m.content ?? m.speakerItem ?? "") || (m.flags?.[MODULE_ID]?.projectileOf));
      ctx.expect(!run.seen.some(d => /répartir|allocate/i.test(d.title ?? "")), `pas de fenêtre de répartition (${run.seen.map(d => d.title).join(" | ") || "aucune"})`);
      const chained = (await ctx.messagesSince(since)).filter(m => m.flags?.[MODULE_ID]?.projectileOf).length;
      ctx.expect(chained === 1, `une seule attaque enchaînée pour la seconde créature (${chained})`);
      ctx.log(`messages du lancement : ${usages.length}`);
    }

    // ---- Conjure Minor Elementals: Difficult Terrain for enemies ----
    if ( wanted("elementaires") ) {
      await ctx.ensureItem(caster, PHB("phbsplConjureMin"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Conjure Minor|élémentaires mineurs/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(caster, "conjure-minor-elementals");
      });
      const u = await ctx.use({ tokenId: caster.id, identifier: "conjure-minor-elementals", activityId: "VSwMJFQoi3KU3Ais" });
      await pause(2500);
      const zone = await script(ctx, `const c = canvas.scene.tokens.get("${caster.id}");
        const r = canvas.scene.regions.find(x => x.getFlag("dnd5e", "item")?.includes?.("${caster.id}") || /Conjure Minor|élémentaires mineurs/i.test(x.name));
        if ( !r ) return null; const b = r.behaviors.find(x => x.type === "dnd5e.difficultTerrain");
        return { attached: r.attachment?.token ?? null, ignored: b ? [...b.system.ignoredDispositions] : null, disposition: c.disposition };`);
      ctx.expect(!!zone, `Invocation d'élémentaires mineurs : une émanation posée (${JSON.stringify(u.reason ?? null)})`);
      if ( zone ) ctx.expect(Array.isArray(zone.ignored) && zone.ignored.includes(zone.disposition),
        `terrain difficile, sauf pour la disposition du Lanceur (${JSON.stringify(zone)})`);
    }

    // ---- Gust of Wind: toward the caster in the Line, double ----
    if ( wanted("bourrasque") ) {
      await ctx.ensureItem(caster, PHB("phbsplGustofWind"), { system: { method: "atwill" } });
      const home = await ctx.position(target);
      ctx.restore(async () => {
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
        await ctx.removeEffectsFrom(caster, "gust-of-wind");
      });
      const fight = await ctx.startCombat([caster, target]);
      // The Line from east to west in front of the Caster, 12 cells × 2; the save does not count here (the Target may be pushed).
      const p = await ctx.position(caster);
      const u = await ctx.use({ tokenId: caster.id, identifier: "gust-of-wind", activityType: "save", consume: false,
        area: { shape: "rectangle", x: p.x + grid, y: p.y, width: 12 * grid, height: grid } });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(1500);
      // The Target put back 6 cells from the Caster, in the Line, and it is its turn.
      await ctx.call("move-token", { tokenId: target.id, x: p.x + 6 * grid, y: p.y, elevation: 0 });
      await turnTo(ctx, target);
      const before = await ctx.engine("budget", { tokenId: target.id });
      await ctx.engine("move", { tokenId: target.id, point: { x: p.x + 4 * grid + grid / 2, y: p.y + grid / 2 } }).catch(err => ctx.log(`move : ${err.message}`));
      await pause(2000);
      const after = await ctx.engine("budget", { tokenId: target.id });
      const pos = await ctx.position(target);
      ctx.log(`Cible : ${Math.round((p.x + 6 * grid - pos.x) / grid)} case(s) vers le Lanceur`);
      ctx.expect(((after?.windward ?? 0) - (before?.windward ?? 0)) === 10, `Bourrasque : deux cases vers le Lanceur dans la Ligne → 10 ft de plus (${before?.windward ?? 0} → ${after?.windward ?? 0})`);
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Moonbeam: no other form in the light ----
    if ( wanted("rayon") ) {
      await ctx.ensureItem(caster, PHB("phbsplMoonbeam00"));
      const poly = await ctx.ensureItem(caster, PHB("phbsplPolymorph0"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Moonbeam|Rayon de lune/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(caster, "moonbeam");
      });
      const p = await ctx.position(caster);
      const before = await ctx.engine("issues", { tokenId: caster.id, itemId: poly, activityType: "transform" }).catch(err => [`erreur : ${err.message}`]);
      // The Caster suffers their own Moonbeam: a failed concentration takes the area away — we recast (5 times at most).
      let placed = false;
      for ( let i = 0; (i < 5) && !placed; i++ ) {
        const u = await ctx.use({ tokenId: caster.id, identifier: "moonbeam", activityType: "save", consume: false,
          area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid / 2, radius: grid } });
        if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(2000);
        placed = await lastingZone(ctx, u.regionId);
      }
      ctx.expect(placed, "le Rayon de lune est posé sur le Lanceur");
      const inside = await ctx.engine("issues", { tokenId: caster.id, itemId: poly, activityType: "transform" }).catch(err => [`erreur : ${err.message}`]);
      ctx.expect(!before.some(l => /lumière|light/i.test(l)), `hors du Rayon : Métamorphose permise (${before.join(" | ") || "aucun souci"})`);
      ctx.expect(inside.some(l => /forme|form/i.test(l)), `dans le Rayon de lune : Métamorphose refusée (${inside.join(" | ") || "aucun souci"})`);
    }

    // ---- Symbol: the sphere lasts ----
    if ( wanted("symbole") ) {
      await ctx.ensureItem(caster, PHB("phbsplSymbol0000"));
      const p = await ctx.position(target);
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => r.getFlag("dnd5e", "item")?.includes?.("Item.") && /Symbol|Symbole/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(target, "symbol");
      });
      const u = await ctx.use({ tokenId: caster.id, identifier: "symbol", activityId: "oCs1sUAtUAQJwxPU", consume: false,
        area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid / 2, radius: grid } });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      await pause(2500);
      const zone = await script(ctx, `const r = canvas.scene.regions.get("${u.regionId ?? ""}"); if ( !r ) return null;
        return { area: !!r.getFlag("${MODULE_ID}", "area")?.usage, expiresAt: r.getFlag("${MODULE_ID}", "expiresAt") ?? null, now: game.time.worldTime };`);
      ctx.expect(!!zone?.area, `Symbole (Mort) : la sphère reste, zone qui dure (${JSON.stringify(zone)})`);
      if ( zone?.expiresAt ) ctx.expect(Math.round(zone.expiresAt - zone.now) === 600, `fin dans 10 minutes (${Math.round(zone.expiresAt - zone.now)} s)`);
    }

    // ---- Dispel Magic on an area ----
    if ( wanted("dissipation") ) {
      const other = await ctx.token("Cible voisine");
      await ctx.ensureItem(other, PHB("phbsplMoonbeam00"));
      await ctx.ensureItem(caster, PHB("phbsplDispelMagi"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Moonbeam|Rayon de lune/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(other, "moonbeam");
      });
      const p = await ctx.position(other);
      const mb = await ctx.use({ tokenId: other.id, identifier: "moonbeam", activityType: "save", consume: false,
        area: { shape: "circle", x: p.x + 3 * grid, y: p.y + grid / 2, radius: grid } });
      if ( mb.usageMessageId ) await ctx.settle(mb.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      ctx.expect(await lastingZone(ctx, mb.regionId), "le Rayon de lune de la Cible voisine est posé");
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "dispel-magic", targetTokenIds: [] }),
        d => {
          const zoneButton = (d.buttons ?? []).find(b => /Moonbeam|Rayon de lune/i.test(b.label ?? "") && /Cible voisine/.test(b.label ?? ""));
          return zoneButton ? { button: zoneButton.action } : null;
        }, { tail: 6 });
      await pause(1500);
      const still = await script(ctx, `return !!canvas.scene.regions.get("${mb.regionId ?? ""}");`);
      ctx.expect(run.seen.some(d => (d.buttons ?? []).some(b => /Moonbeam|Rayon de lune/i.test(b.label ?? ""))),
        `Dissipation sans cible : la question propose le Rayon de lune (${run.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
      ctx.expect(still === false, "le Rayon de lune choisi cesse (zone retirée)");
    }

    // ---- Compulsion : direction, marche, puis sauvegarde ----
    if ( wanted("compulsion") ) {
      await ctx.ensureItem(caster, PHB("phbsplCompulsion"));
      const home = await ctx.position(target);
      ctx.restore(async () => {
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
        await ctx.removeEffectsFrom(target, "compulsion");
        await ctx.removeEffectsFrom(caster, "compulsion");
      });
      const fight = await ctx.startCombat([caster, target]);
      await turnTo(ctx, caster);
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await ctx.removeEffectsFrom(target, "compulsion");
        const u = await ctx.use({ tokenId: caster.id, identifier: "compulsion", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        failed = r?.targets?.find(x => x.name === "Cible")?.save?.success === false;
      }
      if ( ctx.expect(failed, "Compulsion : la Cible rate sa sauvegarde (20 essais au plus)") ) {
        await pause(1000);
        // The Target's turn without a direction: at its end, no save.
        await turnTo(ctx, target);
        const since = await ctx.lastMessageId();
        const toCaster = await usingWith(ctx, async () => { await ctx.nextTurn(); await pause(3000); }, d => {
          if ( /Compulsion|Injonction/i.test(d.title ?? "") ) return { fields: { pick: "3" }, button: "list" };   // 3 : l'est
          return null;
        }, { tail: 6 });
        // Only Compulsion's saves: the areas of the previous parts (Symbol…) stay placed until the end.
        const resaveEarly = (await ctx.messagesSince(since)).some(m => m.flags?.[MODULE_ID]?.resave && /Compulsion|Injonction/i.test(JSON.stringify(m)));
        ctx.expect(!resaveEarly, "sans direction, la Cible ne refait pas sa sauvegarde en fin de tour");
        ctx.expect(toCaster.seen.some(d => /Compulsion|Injonction/i.test(d.title ?? "")), `au tour du Lanceur, la question de la direction (${toCaster.seen.map(d => d.title).join(" | ") || "aucune"})`);
        const start = await ctx.position(target);
        await ctx.nextTurn();   // the Target's turn: it walks
        await pause(5000);
        const walked = await ctx.position(target);
        ctx.expect(walked.x > start.x && walked.y === start.y, `la Cible marche vers l'est (${Math.round((walked.x - start.x) / grid)} case(s))`);
        const since2 = await ctx.lastMessageId();
        await ctx.nextTurn();   // fin de son tour : la sauvegarde
        await pause(3000);
        const resave = (await ctx.messagesSince(since2)).some(m => m.flags?.[MODULE_ID]?.resave);
        ctx.expect(resave, "après la marche, la Cible refait sa sauvegarde en fin de tour");
      }
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Contre-Contresort ----
    if ( wanted("contre") ) {
      const enemy = await ctx.token("Ennemi au contact");
      await ctx.ensureItem(enemy, PHB("phbsplCounterspe"), { system: { method: "atwill" } });
      await ctx.ensureItem(caster, PHB("phbsplCounterspe"), { system: { method: "atwill" } });
      await ctx.ensureItem(caster, PHB("phbsplRayofFrost"));
      const since = await ctx.lastMessageId();
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "ray-of-frost", activityType: "attack", targetTokenIds: [target.id],
        usageConfig: { [MODULE_ID]: { autoReact: true } } }),
        d => {
          // The Caster against the Enemy's Counterspell; a third window (the Enemy counters in turn): no.
          const use = (d.buttons ?? []).find(b => b.action === "use0");
          if ( !use ) return null;
          return /Lanceur/.test(d.title ?? "") ? { button: "use0" } : { button: "none" };
        }, { tail: 20 });
      const gates = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.gate).filter(g => g?.kind === "counterspell");
      ctx.expect(run.seen.some(d => /Lanceur/.test(d.title ?? "")), `le Lanceur peut contrer le Contresort de l'Ennemi (${run.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
      ctx.expect(gates.some(g => /Counterspell|Contresort/i.test(g.spell ?? "") || (g.spell === "counterspell")),
        `une carte de porte pour le Contresort contré ou tenu (${JSON.stringify(gates.map(g => ({ spell: g.spell, dissipated: g.dissipated })))})`);
    }

    // ---- Conjure Animals: the caster's Strength Advantage near the pack ----
    if ( wanted("meute") ) {
      const spell = await ctx.ensureItem(caster, PHB("phbsplConjureAni"));
      const p = await ctx.position(caster);
      const fight = await ctx.startCombat([caster, target]);   // auras only play in combat (world setting)
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: p.x + grid, y: p.y + grid });
      const pack = s?.tokens?.[0];
      ctx.restore(async () => {
        if ( pack ) await ctx.call("delete-scene-object", { type: "Token", objectId: pack.id }).catch(() => {});
        await ctx.removeEffectsFrom(caster, "conjure-animals", "grant-save-advantage");
      });
      const has = async () => script(ctx, `const t = canvas.scene.tokens.get("${caster.id}"); return t.actor.effects.some(e => /Save Advantage|Avantage/i.test(e.name));`);
      let near = false;
      for ( let i = 0; (i < 10) && !near; i++ ) { await pause(800); near = await has(); }
      ctx.expect(!!pack && near, `meute au contact : l'Avantage de Force sur le Lanceur (${pack?.name ?? "aucune invocation"})`);
      const others = await script(ctx, `return canvas.scene.tokens.filter(t => t.id !== "${caster.id}" && t.actor?.effects.some(e => /Save Advantage|Avantage/i.test(e.name))).map(t => t.name);`);
      ctx.expect(!others?.length, `personne d'autre (${JSON.stringify(others)})`);
      if ( pack ) {
        await ctx.call("move-token", { tokenId: pack.id, x: p.x + 6 * grid, y: p.y + grid, elevation: 0 });
        let gone = false;
        for ( let i = 0; (i < 10) && !gone; i++ ) { await pause(800); gone = !(await has()); }
        ctx.expect(gone, "meute éloignée : l'Avantage tombe");
      }
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Grasping Vine: attack, pull, Grappled ----
    if ( wanted("liane") ) {
      const spell = await ctx.ensureItem(caster, PHB("phbsplGraspingVi"));
      const home = await ctx.position(target);
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: home.x + 4 * grid, y: home.y });
      const vine = s?.tokens?.[0];
      ctx.restore(async () => {
        if ( vine ) await ctx.call("delete-scene-object", { type: "Token", objectId: vine.id }).catch(() => {});
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
        await script(ctx, `const t = canvas.scene.tokens.get("${target.id}"); await t.actor.toggleStatusEffect("grappled", { active: false }); return true;`);
        await ctx.removeEffectsFrom(caster, "grasping-vine");
      });
      if ( ctx.expect(!!vine, "Liane avide : la liane est posée") ) {
        let hit = null;
        for ( let i = 0; (i < 20) && !hit; i++ ) {
          await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: 0 });
          const run = await usingWith(ctx, () => ctx.use({ tokenId: vine.id, identifier: "vine-attack", activityType: "attack", targetTokenIds: [target.id], rollDamage: true }),
            d => { const b = (d.buttons ?? []).filter(x => /^\d+\s/.test(x.label ?? "")).sort((a, b) => parseInt(b.label) - parseInt(a.label))[0]; return b ? { button: b.action ?? b.label } : null; }, { tail: 4 });
          const r = run.used?.usageMessageId ? await ctx.settle(run.used.usageMessageId).catch(() => null) : null;
          if ( r?.targets?.find(x => x.name === "Cible")?.hit === true ) hit = run;
        }
        if ( ctx.expect(!!hit, "l'attaque de la liane touche (20 essais au plus)") ) {
          await pause(1500);
          const pos = await ctx.position(target);
          const grappled = await script(ctx, `return canvas.scene.tokens.get("${target.id}").actor.statuses.has("grappled");`);
          ctx.expect(hit.seen.some(d => /Pull|Tirer/i.test(d.title ?? "")), `la distance de traction est demandée (${hit.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
          ctx.expect(Math.round((pos.x - home.x) / grid) === 3, `tirée jusqu'au contact de la liane (${Math.round((pos.x - home.x) / grid)} case(s) sur 4)`);
          ctx.expect(grappled === true, "Agrippée");
        }
      }
    }

    // ---- Flaming Sphere: stopped on contact ----
    if ( wanted("sphere") ) {
      const spell = await ctx.ensureItem(caster, PHB("phbsplFlamingSph"));
      // The Target may have been moved (Compulsion, Vine) and Grappled: back to its place, free, before the sphere.
      await ctx.removeEffectsFrom(target, "grasping-vine");
      await script(ctx, `const a = canvas.scene.tokens.get("${target.id}").actor; const ids = a.effects.filter(e => e.statuses.has("grappled")).map(e => e.id); if ( ids.length ) await a.deleteEmbeddedDocuments("ActiveEffect", ids); return ids.length;`);
      await ctx.call("move-token", { tokenId: target.id, x: targetHome.x, y: targetHome.y, elevation: targetHome.elevation });
      await pause(800);
      const p = await ctx.position(caster);
      const t = await ctx.position(target);
      const fight = await ctx.startCombat([caster, target]);
      await turnTo(ctx, caster);
      const s = await ctx.engine("summonAt", { tokenId: caster.id, itemId: spell, x: p.x + grid, y: p.y + 2 * grid });
      const ball = s?.tokens?.[0];
      ctx.restore(async () => {
        if ( ball ) await ctx.call("delete-scene-object", { type: "Token", objectId: ball.id }).catch(() => {});
        await ctx.removeEffectsFrom(caster, "flaming-sphere");
      });
      if ( ctx.expect(!!ball, "Sphère de feu : la sphère est posée") ) {
        await pause(1500);
        const since = await ctx.lastMessageId();
        // In contact with the Target (the cell under it).
        await ctx.engine("move", { tokenId: ball.id, point: { x: t.x + grid / 2, y: t.y + 1.5 * grid } }).catch(err => ctx.log(`move : ${err.message}`));
        await pause(3000);
        const pulsed = (await ctx.messagesSince(since)).some(m => m.flags?.[MODULE_ID]?.areaTick?.event === "pulse" || m.flags?.[MODULE_ID]?.areaTick);
        const stopped = await script(ctx, `const b = canvas.scene.tokens.get("${ball.id}"); return b.getFlag("${MODULE_ID}", "stoppedOn") ?? null;`);
        ctx.expect(pulsed, "roulée au contact : la Cible fait la sauvegarde");
        ctx.expect(!!stopped, `puis la sphère s'arrête pour le tour (${stopped})`);
      }
      if ( fight?.id ) await endFight(ctx);
    }

    // ---- Storm of Vengeance: the six lightning bolts of your choice ----
    if ( wanted("tempete") ) {
      const ally = await ctx.token("Allié");
      await ctx.ensureItem(caster, PHB("phbsplStormofVen"));
      ctx.restore(async () => {
        await script(ctx, `const ids = canvas.scene.regions.filter(r => /Storm of Vengeance|Tempête/i.test(r.name)).map(r => r.id); await canvas.scene.deleteEmbeddedDocuments("Region", ids); return ids.length;`);
        await ctx.removeEffectsFrom(caster, "storm-of-vengeance");
        await ctx.removeEffectsFrom(target, "storm-of-vengeance");
        await ctx.removeEffectsFrom(ally, "storm-of-vengeance");
      });
      // The cloud above the Target, its neighbor and the Ally (brought next to them); the Caster outside — their concentration
      // is not rolled every turn.
      const t = await ctx.position(target);
      const allyHome = await ctx.position(ally);
      ctx.restore(() => ctx.call("move-token", { tokenId: ally.id, x: allyHome.x, y: allyHome.y, elevation: allyHome.elevation }).catch(() => {}));
      await ctx.call("move-token", { tokenId: ally.id, x: t.x, y: t.y + grid, elevation: 0 });
      // The scenario runner turns off the area question (`zoneChoice: never`) for the duration of a pass: restored here.
      const setting = await ctx.engine("setting", { key: "zoneChoice", value: "mixed" });
      ctx.restore(() => ctx.engine("setting", { key: "zoneChoice", value: setting?.before ?? "never" }));
      const fight = await ctx.startCombat([caster, target, ally]);
      await turnTo(ctx, caster);
      const u = await ctx.use({ tokenId: caster.id, identifier: "storm-of-vengeance", activityType: "save", consume: false,
        area: { shape: "circle", x: t.x + grid, y: t.y + grid, radius: 2 * grid } });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const seen = [];
      for ( let round = 0; (round < 3) && !seen.some(d => /choix|choice/i.test(d.title ?? "")); round++ ) {
        for ( let k = 0; k < 3; k++ ) {
          const r = await usingWith(ctx, async () => { await ctx.nextTurn(); await pause(2500); },
            d => (/Storm|Tempête/i.test(d.title ?? "") ? { button: "ok" } : null), { tail: 4 });
          seen.push(...r.seen);
        }
      }
      ctx.expect(seen.some(d => /Storm|Tempête/i.test(d.title ?? "")), `au tour 3, la question des éclairs (${seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
      if ( fight?.id ) await endFight(ctx);
    }

    if ( process.env.TRACE ) {
      const logs = await ctx.call("get-client-errors", { levels: ["log", "warn"], limit: 300 });
      for ( const e of (logs.errors ?? logs.entries ?? []).filter(e => /dnd5e-combat/.test(e.message ?? e.text ?? "")).slice(-45) ) ctx.log((e.message ?? e.text).slice(0, 200));
    }
    await pause(600);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
