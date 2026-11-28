/**
 * §486 (brick B07) — `usageLimits.<activité>.whileEffect` / `unlessEffect`: an activity allowed only under an effect, or
 * only outside it ("Claws (requires Change Appearance)", a form's weapons). Lent to the arena Zombie:
 *  - a feat "Essai : forme" carrying a transferred effect "Essai : forme bestiale", off at the start;
 *  - "Essai : griffes" (natural weapon) whose attack is allowed only under that effect (its id);
 *  - an "Essai : gourdin" allowed only outside it (`unlessEffect`, by the feat's identifier).
 * Declared as flags on the items (the content's "item" layer).
 *  1. Effect off: the claws have the issue "seulement sous l'effet de Essai : forme bestiale", the club none.
 *  2. Effect on: the claws have no more issue, the club has "pas possible sous l'effet de".
 *  3. Claws, effect off, from the sheet: the "do it anyway" window opens; giving up leaves nothing, overriding
 *     gives the card marked with the reason and the alert to the GM.
 * Removes the lent items.
 */
const MODULE_ID = "dnd5e-combat";
const CLAW_ACTIVITY = "b07EssaiGriffes0";
const CLUB_ACTIVITY = "b07EssaiGourdin0";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const weapon = (name, identifier, activityId, limit) => ({
  name, type: "weapon", img: "icons/svg/sword.svg",
  flags: { [MODULE_ID]: { scenarioB07: identifier, usageLimits: { [activityId]: limit } } },
  system: {
    identifier, equipped: true, proficient: 1, quantity: 1,
    type: { value: "natural", baseItem: "" },
    damage: { base: { number: 1, denomination: 4, types: ["slashing"] } },
    activities: { [activityId]: { _id: activityId, type: "attack", name: "", activation: { type: "action", value: 1 },
      attack: { type: { value: "melee", classification: "weapon" } }, damage: { includeBase: true, parts: [] } } }
  }
});

export default {
  name: "activité permise seulement sous un effet (whileEffect / unlessEffect), refus forçable",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Zombi requis : non applicable"); return; }
    const zombie = await ctx.token("Zombi");
    const lent = [];
    ctx.restore(async () => { for ( const id of lent ) await ctx.call("remove-embedded-item", { documentType: "Actor", id: zombie.actorId, itemId: id }).catch(() => {}); });
    const put = async (itemData, mark) => {
      const r = await ctx.call("upsert-actor-item", { actorId: zombie.actorId, itemData, match: { path: `flags.${MODULE_ID}.scenarioB07`, value: mark } });
      const id = r.itemId ?? r.id ?? r.item?._id;
      lent.push(id);
      return id;
    };

    // The feat and its transferred effect, off.
    const formId = await put({ name: "Essai : forme", type: "feat", img: "icons/svg/paw.svg",
      flags: { [MODULE_ID]: { scenarioB07: "b07-essai-forme" } },
      system: { identifier: "b07-essai-forme", type: { value: "monster", subtype: "" } },
      effects: [{ name: "Essai : forme bestiale", img: "icons/svg/paw.svg", transfer: true, disabled: true, changes: [] }] }, "b07-essai-forme");
    await pause(500);
    const actor = await ctx.call("get-actor", { actorId: zombie.actorId });
    const form = (actor.items ?? []).find(i => i._id === formId);
    const effectId = form?.effects?.[0]?._id;
    if ( !ctx.expect(!!effectId, `effet « Essai : forme bestiale » sur le don (${effectId ?? "absent"})`) ) return;

    const clawId = await put(weapon("Essai : griffes", "b07-essai-griffes", CLAW_ACTIVITY, { whileEffect: [effectId] }), "b07-essai-griffes");
    const clubId = await put(weapon("Essai : gourdin", "b07-essai-gourdin", CLUB_ACTIVITY, { unlessEffect: "b07-essai-forme" }), "b07-essai-gourdin");
    await pause(1000);

    const issues = itemId => ctx.engine("issues", { tokenId: zombie.id, itemId });
    const needs = l => /Essai : forme bestiale/.test(l) && /que sous|only possible under|só é possível|solo sotto/i.test(l);
    const barred = l => /Essai : forme/.test(l) && /pas possible sous|not possible under|não é possível|non è possibile/i.test(l);
    const toggle = on => ctx.call("upsert-embedded-effect", { uuid: `Actor.${zombie.actorId}.Item.${formId}`, effectData: { disabled: !on },
      match: { path: "_id", value: effectId } });

    // 1. Effect off.
    let claw = await issues(clawId);
    let club = await issues(clubId);
    ctx.expect(claw.some(needs), `effet éteint : griffes refusées (${claw.join(" ; ") || "aucun souci"})`);
    ctx.expect(!club.some(barred), `effet éteint : gourdin permis (${club.join(" ; ") || "aucun souci"})`);

    // 2. Effect on.
    await toggle(true);
    ctx.restore(() => toggle(false).catch(() => {}));
    await pause(1000);
    claw = await issues(clawId);
    club = await issues(clubId);
    ctx.expect(!claw.some(needs), `effet allumé : griffes permises (${claw.join(" ; ") || "aucun souci"})`);
    ctx.expect(club.some(barred), `effet allumé : gourdin refusé (${club.join(" ; ") || "aucun souci"})`);

    // 3. Force: effect off, the "do it anyway" window opens; give up, then override (card marked, GM alert).
    await toggle(false);
    await pause(1000);
    const target = tokens.find(t => (t.id !== zombie.id) && (t.name !== "Zombi"));
    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${zombie.name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => { const d = await legality(300); if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {}); });
    const attempt = async button => {
      const since = await ctx.lastMessageId();
      await ctx.engine("sheetUse", { tokenId: zombie.id, itemId: clawId, targetIds: target ? [target.id] : [] });
      const d = await legality();
      if ( !d ) return null;
      await ctx.call("answer-dialog", { id: d.id, button });
      if ( button === "go" ) { const more = await legality(2500); if ( more ) await ctx.call("answer-dialog", { id: more.id, button: "go" }); }
      await pause(button === "go" ? 4000 : 2000);
      return ctx.messagesSince(since);
    };
    const usages = m => m.filter(x => (x.type === "usage") && x.flags?.[MODULE_ID]?.overridden?.length);
    const alerts = m => m.filter(x => x.flags?.[MODULE_ID]?.gmAlert);
    let after = await attempt("cancel");
    if ( ctx.expect(!!after, "griffes sans l'effet : fenêtre « le faire quand même »") ) {
      ctx.expect(!usages(after).length && !alerts(after).length, `renoncé : ni carte, ni alerte (${after.length} message(s))`);
    }
    after = await attempt("go");
    if ( ctx.expect(!!after, "la fenêtre se rouvre") ) {
      const reasons = usages(after)[0]?.flags?.[MODULE_ID]?.overridden ?? [];
      ctx.expect(reasons.some(needs), `forcé : la carte porte la raison (${reasons.join(" | ") || "aucune"})`);
      const text = alerts(after)[0]?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
      ctx.expect(/forme bestiale/i.test(text), `forcé : le MJ est prévenu (${text || "aucune alerte"})`);
      const card = usages(after)[0];
      if ( card ) await ctx.settle(card._id ?? card.id, { timeoutMs: 30000 }).catch(() => null);
    }

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
