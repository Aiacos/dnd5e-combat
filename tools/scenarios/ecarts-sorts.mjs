/**
 * §402: corrected average gaps from the spell re-pass — played in the "Arène des sorts". `PART=<mot>` plays only the parts whose
 * name contains it.
 *  - repli: Expeditious Retreat (Dash as a Bonus Action) then Dash with the action → three times the Speed in the turn budget.
 *  - dedale: Maze applies "Banished" automatically (the data's check activity) → the target is hidden, then returns at the end.
 *  - parole: Divine Word on a target made a Fiend (999 HP) that fails → sent back (token hidden), whatever its HP.
 *  - petrification: Petrification on the Construct → automatic success, no roll.
 *  - oeil: Eyebite — a target that succeeded is no longer affected by the spell's repeat saves.
 *  - rappel: Raise Dead — the four −1 effects applied, a Long Rest removes one.
 *  - renvoi: Dispel Evil and Good, "Dismissal" on the target made a Fiend → sent back (hidden) on a failure.
 *  - duel: Compelled Duel on the target (20 ft from the caster) — a step to 25 ft is allowed, a step to 45 ft is refused.
 *  - vent: Steel Wind Strike on the target and its neighbor — after the attacks, the question "teleport next to a target".
 *  - discours: Enthrall in combat on the hostile target → automatic success ("you are fighting it").
 *  - cercle: the Circle of Power effect on the target; a successful Fireball → no damage.
 */
import { ARENE_SORTS } from "../lib/stages.mjs";

const PHB = id => `Compendium.dnd-players-handbook.spells.Item.${id}`;
const pause = ms => new Promise(r => setTimeout(r, ms));
const only = (process.env.PART ?? "").toLowerCase();
const wanted = name => !only || name.toLowerCase().includes(only);

/** Runs `use` and answers the windows that open on the GM's side meanwhile (same helper as choix-sorts). `tail`: waiting turns
 * after `use` ends (a question that follows the resolution, like Steel Wind Strike's teleportation). */
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

/** The "hidden" condition of a token. */
async function hidden(ctx, token) {
  const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: token.id });
  return data.hidden === true;
}
async function unhide(ctx, token) {
  await ctx.call("update-scene-object", { type: "Token", objectId: token.id, data: { hidden: false, "flags.dnd5e-combat.-=banished": null } }).catch(() => {});
}
/** Changes the creature type of an unlinked token (its delta), and puts it back at the end. */
async function setType(ctx, token, type) {
  // The token's actor (synthetic for an unlinked token: the change goes into its delta) — an update-scene-object of the delta by
  // dotted path is refused by the core.
  const set = value => ctx.call("run-script", { code: `const a = canvas.scene.tokens.get("${token.id}").actor; const before = a.system.details.type.value; await a.update({ "system.details.type.value": ${JSON.stringify("__V__")} }); return before;`.replace('"__V__"', JSON.stringify(value)) });
  const r = await set(type);
  const before = r?.result ?? "humanoid";
  ctx.restore(() => set(before).catch(() => {}));
}

export default {
  name: "écarts moyens des sorts corrigés (§402)",
  scene: ARENE_SORTS.name,

  async run(ctx) {
    const caster = await ctx.token("Lanceur");
    const target = await ctx.token("Cible");
    const hero = await ctx.token("Héros");

    // ---- Expeditious Retreat then Dash ----
    if ( wanted("repli") ) {
      await ctx.ensureItem(caster, PHB("phbsplExpeditiou"));
      const fight = await ctx.startCombat([caster, target]);
      // Le lanceur ne referme que le dernier combat ouvert (`ctx.ownCombat`) : celui-ci se referme ici.
      ctx.restore(() => (fight?.id ? ctx.call("end-combat", { combatId: fight.id }).catch(() => {}) : null));
      // The caster's turn: Dash is paid with its action.
      await ctx.call("run-script", { code: `const c = game.combats.find(x => x.combatants.some(k => k.tokenId === "${caster.id}")); const i = c.turns.findIndex(k => k.tokenId === "${caster.id}"); await c.update({ turn: i }); return i;` });
      await pause(1000);
      const speed = Number((await ctx.call("get-actor", { actorId: caster.actorId })).system?.attributes?.movement?.walk) || 30;
      await ctx.use({ tokenId: caster.id, identifier: "expeditious-retreat" });
      await pause(1500);
      const afterBonus = await ctx.engine("budget", { tokenId: caster.id });
      await ctx.call("run-script", { code: `const t = canvas.scene.tokens.get("${caster.id}"); return game.modules.get("dnd5e-combat").api.basics.take(t.actor, "dash");` });
      const afterAction = await ctx.engine("budget", { tokenId: caster.id });
      ctx.expect((afterBonus?.dashes ?? (afterBonus?.dashed ? 1 : 0)) === 1, `Repli expéditif : un Foncer (${afterBonus?.dashes}, action Bonus ${afterBonus?.bonus})`);
      ctx.expect(afterAction?.dashes === 2, `puis Foncer avec l'action : deux Foncer (${afterAction?.dashes}, action ${afterAction?.action})`);
      ctx.expect(afterAction?.cap === speed * 3 || afterAction?.cap === null, `déplacement du tour : trois fois la Vitesse (${afterAction?.cap} pour ${speed})`);
    }

    // ---- Maze ----
    if ( wanted("dedale") ) {
      await ctx.ensureItem(caster, PHB("phbsplMaze000000"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "maze"); await unhide(ctx, target); });
      const u = await ctx.use({ tokenId: caster.id, identifier: "maze", targetTokenIds: [target.id] });
      if ( u.usageMessageId ) await ctx.settle(u.usageMessageId).catch(() => null);
      await pause(1500);
      const on = await ctx.effectsFrom(target, "maze");
      ctx.expect(on.length > 0, `Dédale : « Banished » posé d'office sur la Cible (${on.map(e => e.name).join(", ") || "rien"})`);
      ctx.expect(await hidden(ctx, target), "Dédale : la Cible quitte la scène (cachée)");
      await ctx.removeEffectsFrom(target, "maze");
      await pause(1500);
      ctx.expect(!(await hidden(ctx, target)), "Dédale fini : la Cible revient");
    }

    // ---- Parole divine ----
    if ( wanted("parole") ) {
      await ctx.ensureItem(caster, PHB("phbsplDivineWord"));
      await setType(ctx, target, "fiend");
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "divine-word"); await unhide(ctx, target); });
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await unhide(ctx, target);
        const u = await ctx.use({ tokenId: caster.id, identifier: "divine-word", activityType: "save", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Cible");
        if ( t?.save?.success !== false ) continue;
        failed = true;
        await pause(1500);
        ctx.expect(await hidden(ctx, target), "Parole divine : le Fiélon à 999 PV qui rate est renvoyé (caché)");
      }
      if ( !failed ) ctx.expect(false, "Parole divine : aucun échec en 20 essais");
      await unhide(ctx, target);
    }

    // ---- Dispel Evil and Good: the Dismissal ----
    if ( wanted("renvoi") ) {
      await ctx.ensureItem(caster, PHB("phbsplDispelEvil"));
      await setType(ctx, target, "fiend");
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "dispel-evil-and-good"); await unhide(ctx, target); });
      let failed = false;
      for ( let i = 0; (i < 20) && !failed; i++ ) {
        await unhide(ctx, target);
        const u = await ctx.use({ tokenId: caster.id, identifier: "dispel-evil-and-good", activityId: "dnd5eactivity000", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== false ) continue;
        failed = true;
        await pause(1500);
        ctx.expect(await hidden(ctx, target), "Renvoi : le Fiélon qui rate est renvoyé (caché)");
      }
      if ( !failed ) ctx.expect(false, "Renvoi : aucun échec en 20 essais");
      await unhide(ctx, target);
    }

    // ---- Compelled Duel: the 9 m leash ----
    if ( wanted("duel") ) {
      const itemId = await ctx.ensureItem(caster, PHB("phbsplCompelledD"));
      const grid = await ctx.gridSize();
      const home = await ctx.position(target);
      ctx.restore(async () => {
        await ctx.removeEffectsFrom(target, "compelled-duel");
        await ctx.call("move-token", { tokenId: target.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      });
      await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId, effectId: "FqWUxRHs4LAj7IIb" });
      const walk = x => ctx.call("update-scene-object", { type: "Token", objectId: target.id, data: { x, y: home.y } }).catch(err => ({ error: err.message }));
      await walk(home.x + grid);
      await pause(1500);
      const near = await ctx.position(target);
      ctx.expect(Math.round((near.x - home.x) / grid) === 1, `Duel forcé : un pas à 25 ft du lanceur passe (${Math.round((near.x - home.x) / grid)} case)`);
      await walk(home.x + 5 * grid);
      await pause(1500);
      const far = await ctx.position(target);
      ctx.expect(far.x === near.x, `Duel forcé : un pas à 45 ft du lanceur est refusé (${Math.round((far.x - home.x) / grid)} cases)`);
    }

    // ---- Petrification ----
    if ( wanted("petrification") ) {
      const golem = await ctx.token("Créature artificielle");
      await ctx.ensureItem(caster, PHB("phbsplFleshtoSto"));
      ctx.restore(() => ctx.removeEffectsFrom(golem, "flesh-to-stone"));
      const u = await ctx.use({ tokenId: caster.id, identifier: "flesh-to-stone", targetTokenIds: [golem.id] });
      const r = await ctx.settle(u.usageMessageId).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Créature artificielle");
      ctx.expect(t?.save?.success === true && (t.save.auto ?? "").startsWith("type:"), `Pétrification : la Créature artificielle réussit d'office (${JSON.stringify(t?.save)})`);
      const on = (await ctx.effectsFrom(golem, "flesh-to-stone")).map(e => e.name);
      ctx.expect(!on.some(n => /Turning to Stone|Pétrifi/i.test(n)), `pas d'Entravé de l'échec (${on.join(", ") || "aucun effet"})`);
    }

    // ---- Eyebite ----
    if ( wanted("oeil") ) {
      await ctx.ensureItem(caster, PHB("phbsplEyebite000"));
      ctx.restore(async () => { await ctx.removeEffectsFrom(target, "eyebite"); });
      let saved = false;
      for ( let i = 0; (i < 20) && !saved; i++ ) {
        await ctx.removeEffectsFrom(target, "eyebite");
        const u = await ctx.use({ tokenId: caster.id, identifier: "eyebite", activityId: "r5eaxtkEdeKOXeHb", targetTokenIds: [target.id] });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        if ( r?.targets?.find(x => x.name === "Cible")?.save?.success !== true ) continue;
        saved = true;
        await pause(1000);
        const again = await ctx.use({ tokenId: caster.id, identifier: "eyebite", activityId: "3PZbzzH8sBJl3heA", targetTokenIds: [target.id] });
        const r2 = again.usageMessageId ? await ctx.settle(again.usageMessageId).catch(() => null) : null;
        const t2 = r2?.targets?.find(x => x.name === "Cible");
        ctx.expect(!r2 || !t2 || t2.unaffected, `Mauvais œil : la Cible qui a réussi n'est plus affectée (${t2 ? JSON.stringify({ unaffected: t2.unaffected, save: t2.save?.success }) : "aucune résolution"})`);
      }
      if ( !saved ) ctx.expect(false, "Mauvais œil : aucune réussite en 20 essais");
    }

    // ---- Raise Dead ----
    if ( wanted("rappel") ) {
      const itemId = await ctx.ensureItem(caster, PHB("phbsplRaiseDead0"));
      ctx.restore(() => ctx.removeEffectsFrom(hero, "raise-dead"));
      for ( const effectId of ["etY0sDrXe6DcFEzc", "QUWVMgg2HidYsUxy", "0EAyGy8YaKbvgvkm", "vyf4vVVoGkZPyAqa"] ) {
        await ctx.engine("placeItemEffect", { tokenId: hero.id, casterId: caster.id, itemId, effectId });
      }
      const before = await ctx.effectsFrom(hero, "raise-dead");
      await ctx.engine("longRest", { tokenId: hero.id });
      await pause(1500);
      const after = await ctx.effectsFrom(hero, "raise-dead");
      ctx.expect(before.length === 4, `Rappel à la vie : quatre effets de −1 posés (${before.length})`);
      ctx.expect(after.length === 3, `un Repos long en retire un (${after.length} restants : ${after.map(e => e.name).join(", ")})`);
      ctx.expect(!after.some(e => /Day 4|Jour 4/.test(e.name)), "le jour 4 tombe le premier");
    }

    // ---- Steel Wind Strike: the teleportation offered after the attacks ----
    if ( wanted("vent") ) {
      const other = await ctx.token("Cible voisine");
      await ctx.ensureItem(caster, PHB("phbsplSteelWindS"));
      const home = await ctx.position(caster);
      ctx.restore(() => ctx.call("move-token", { tokenId: caster.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {}));
      const run = await usingWith(ctx, () => ctx.use({ tokenId: caster.id, identifier: "steel-wind-strike", targetTokenIds: [target.id, other.id] }),
        d => {
          const stay = (d.buttons ?? []).find(b => b.action === "stay");
          if ( stay ) return { button: "stay" };
          const ok = (d.buttons ?? []).find(b => /ok|confirm/i.test(b.action ?? ""));
          return ok ? { button: ok.action } : null;
        }, { tail: 30 });
      ctx.expect(run.seen.some(d => (d.buttons ?? []).some(b => b.action === "stay")),
        `Frappe du vent d'acier : la téléportation près d'une cible est proposée (${run.seen.map(d => d.title).join(" | ") || "aucune fenêtre"})`);
    }

    // ---- Enthrall: automatic success of a creature being fought ----
    if ( wanted("discours") ) {
      await ctx.ensureItem(caster, PHB("phbsplEnthrall00"));
      await ctx.startCombat([caster, target]);
      ctx.restore(() => ctx.removeEffectsFrom(target, "enthrall"));
      const u = await ctx.use({ tokenId: caster.id, identifier: "enthrall", targetTokenIds: [target.id] });
      const r = await ctx.settle(u.usageMessageId).catch(() => null);
      const t = r?.targets?.find(x => x.name === "Cible");
      ctx.expect(t?.save?.success === true && t.save.auto === "fighting", `Discours captivant : la Cible combattue réussit d'office (${JSON.stringify(t?.save)})`);
    }

    // ---- Circle of Power: nothing on a successful save against magic ----
    if ( wanted("cercle") ) {
      const circleId = await ctx.ensureItem(caster, PHB("phbsplCircleofPo"));
      await ctx.ensureItem(caster, PHB("phbsplFireball00"));
      ctx.restore(() => ctx.removeEffectsFrom(target, "circle-of-power"));
      // §438: Manual 3.0.0, the effect is no longer on the item: an effect from the effects compendium, applied by dnd5e's
      // area behavior (`applyActiveEffect`) — copied here with the spell as origin, as it does (`system.origin.activity`).
      const circle = ((await ctx.call("get-actor", { actorId: caster.actorId })).items ?? []).find(i => i._id === circleId);
      const remote = Object.values(circle?.system?.activities ?? {}).flatMap(a => (a.behaviors ?? []).flatMap(b => b.config?.effects ?? []))
        .find(u => /ActiveEffect/.test(u ?? ""));
      if ( (circle?.effects ?? []).some(e => e._id === "WuYsg2mftQltuDIK") || !remote ) {
        await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: circleId, effectId: "WuYsg2mftQltuDIK" });
      } else {
        ctx.log(`forme 3.0.0 : effet du compendium ${remote}`);
        await ctx.engine("placeItemEffect", { tokenId: target.id, casterId: caster.id, itemId: circleId, uuid: remote });
      }
      const grid = await ctx.gridSize();
      let checked = false;
      for ( let i = 0; (i < 20) && !checked; i++ ) {
        const p = await ctx.position(target);
        const before = await ctx.hp(target);
        const u = await ctx.use({ tokenId: caster.id, identifier: "fireball", activityType: "save", area: { shape: "circle", x: p.x + grid / 2, y: p.y + grid / 2, radius: grid / 2 } });
        const r = await ctx.settle(u.usageMessageId).catch(() => null);
        const t = r?.targets?.find(x => x.name === "Cible");
        await pause(1000);
        if ( t?.save?.success !== true ) { await ctx.setHp(target, before); continue; }
        checked = true;
        const after = await ctx.hp(target);
        ctx.expect(after === before, `Cercle de pouvoir : Boule de feu réussie → aucun dégât (${before} → ${after})`);
      }
      if ( !checked ) ctx.expect(false, "Cercle de pouvoir : aucune réussite en 20 essais");
    }
  }
};
