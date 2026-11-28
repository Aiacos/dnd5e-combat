/**
 * B09 (§488) — Worn item that locks the form and suspends a trait. Synthetic examples, lent to the Brown Bear:
 * - the Troll's Regeneration (Monster Manual);
 * - "Test Form" (identifier `das-essai-forme`): a utility activity and a transferred effect left off, the form of a sheet;
 * - "Test Collar" (identifier `das-essai-collier`, capability: worn as long as it is on the sheet), declared in the world's
 *   overlay (`overrideContent`, like the other building-block scenarios; no item flag):
 *   `formLock: { worn: true, forms: ["das-essai-forme"], onAttempt: [1 dégât perforant au porteur] }`,
 *   `suspends: ["regeneration"]`.
 *  1. At the start of its turn, the Bear does not regenerate (trait suspended).
 *  2. Form activity, from the sheet (no confirmation): the legality window gives the collar's reason; the Bear loses 1 HP;
 *     "Give up": no use card.
 *  3. Form effect turned on by hand on the token's actor (the one the token sheet shows): refused (the effect stays off),
 *     1 HP less, window; "Use anyway": the effect turns on, alert to the GM.
 *  4. The collar removed: at the start of its turn, the Bear regenerates again.
 * Initiative imposed: Kaalisti, then the Bear. Items, HP and effects reset as before.
 */
const MODULE_ID = "dnd5e-combat";
const TROLL = "Compendium.dnd-monster-manual.actors.Actor.mmTroll000000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCK_REASON = /Collier d'essai|change (its )?form|changer de forme/i;

// Item names as constants: the bench and the reference take the first "name: \"…\"" of the file as the scenario's title.
const SHAPE_NAME = "Forme d'essai";
const COLLAR_NAME = "Collier d'essai";
const ACTIVITY_NAME = "Changer de forme";
const SHAPE = { name: SHAPE_NAME, type: "feat", img: "icons/creatures/mammals/wolf-howl-moon-gray.webp",
  system: {
    identifier: "das-essai-forme", type: { value: "monster" },
    activities: { dasEssaiFormeAc0: { _id: "dasEssaiFormeAc0", type: "utility", name: ACTIVITY_NAME, activation: { type: "bonus", value: null },
      range: { units: "self" }, target: { affects: { type: "self" } } } }
  },
  effects: [{ _id: "dasEssaiFormeEf0", name: SHAPE_NAME, img: "icons/creatures/mammals/wolf-shadow-black.webp", transfer: true, disabled: true, changes: [] }]
};
const COLLAR = { name: COLLAR_NAME, type: "feat", img: "icons/equipment/neck/choker-chain-thick-silver.webp",
  system: { identifier: "das-essai-collier", type: { value: "monster" } }
};
const COLLAR_RULE = {
  formLock: { worn: true, forms: ["das-essai-forme"], onAttempt: [{ type: "damage", to: "bearer", formula: "1", damageType: "piercing" }] },
  suspends: ["regeneration"]
};

export default {
  name: "verrou forme porté — tentative punie et refusée, Régénération suspendue (§488, brique B09)",

  async run(ctx) {
    await ctx.cast({ "Ours brun": "mmBrownBear00000" }, { near: "Zombi" });
    const { tokens } = await ctx.scene();
    if ( !["Ours brun", "Kaalisti"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Ours brun ou Kaalisti absent : non applicable"); return; }
    const bear = await ctx.token("Ours brun");
    const warlock = await ctx.token("Kaalisti");
    const hp0 = await ctx.hp(bear);
    ctx.restore(() => ctx.setHp(bear, hp0));
    for ( const s of ["dead", "unconscious", "prone", "incapacitated"] ) ctx.restore(() => ctx.removeStatusEffects(bear, s));
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: bear.id });
    ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: bear.id,
      data: { "delta.flags.dnd5e-combat.-=regenerationStopped": null } }).catch(() => {}));
    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${bear.name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      const d = await legality(300);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
    });

    // The three lent items.
    const lend = async (itemData, identifier) => {
      const up = await ctx.call("upsert-actor-item", { actorId: tok.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const id = up.itemId ?? up.id ?? up.item?._id ?? (await ctx.itemId(bear.id, identifier));
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: id }).catch(() => {}));
      return id;
    };
    const { data: troll } = await ctx.call("get-compendium-entry", { uuid: TROLL });
    const { _id, folder, ownership, _stats, ...regen } = troll.items.find(i => i.system?.identifier === "regeneration");
    await lend(regen, "regeneration");
    const shapeId = await lend(SHAPE, "das-essai-forme");
    const collarId = await lend(COLLAR, "das-essai-collier");
    const { before: rule0 } = await ctx.engine("overrideContent", { identifier: "das-essai-collier", entry: COLLAR_RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: "das-essai-collier", entry: rule0 }).catch(() => {}));

    await ctx.startCombat([warlock, bear]);
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const combat = await state();
    for ( const [token, value] of [[warlock, 20], [bear, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === token.id).id, value, combatId: ctx.ownCombat });
    }
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    const turnOf = async token => {
      for ( let i = 0; (i < 3) && ((await current()) !== token.id); i++ ) { await ctx.nextTurn(); await sleep(1500); }
      return (await current()) === token.id;
    };

    // 1. Regeneration suspended.
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === 10, `collier porté : pas de régénération au début du tour (10 → ${await ctx.hp(bear)} PV)`);

    // 2. The form's activity: punished, refused.
    await ctx.setHp(bear, 15);
    const since = await ctx.lastMessageId();
    await ctx.use({ tokenId: bear.id, itemId: shapeId, activityType: "utility", usageConfig: { [MODULE_ID]: { confirmed: false } } }).catch(() => null);
    const asked = await legality();
    ctx.expect(!!asked && LOCK_REASON.test(asked.content ?? asked.text ?? asked.title ?? ""), `activité : la fenêtre de légalité dit le collier${asked ? "" : " (aucune fenêtre)"}`);
    if ( asked ) await ctx.call("answer-dialog", { id: asked.id, button: "cancel" });
    await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === 14, `activité : 1 dégât perforant au porteur (15 → ${await ctx.hp(bear)} PV)`);
    const after = await ctx.messagesSince(since);
    ctx.expect(!after.some(m => m.type === "usage"), "activité, « Renoncer » : aucune carte d'utilisation");
    ctx.expect(after.some(m => m.flags?.[MODULE_ID]?.formLock), "activité : la carte de dégâts du collier est dans le chat");

    // 3. The form's effect turned on by hand.
    // The effect turns on on the token's actor, as from the token sheet: for an unlinked token, the synthetic actor (the item
    // lent to the base actor is inherited there). On the base actor, the engine would find no token to hurt (bench of 2026-11-20).
    const sceneId = (await ctx.scene()).sceneId;
    const shapeUuid = `${tok.actorLink ? `Actor.${tok.actorId}` : `Scene.${sceneId}.Token.${bear.id}.Actor.${tok.actorId}`}.Item.${shapeId}`;
    // The effect's state: the token delta's item if it was modified, otherwise the actor's.
    const effectState = async () => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: bear.id });
      const own = tok.actorLink ? null : (data.delta?.items ?? []).find(i => i._id === shapeId);
      const item = own ?? ((await ctx.call("get-actor", { actorId: tok.actorId })).items ?? []).find(i => i._id === shapeId);
      return (item?.effects ?? []).find(e => e._id === "dasEssaiFormeEf0")?.disabled;
    };
    ctx.restore(() => ctx.call("upsert-embedded-effect", { uuid: shapeUuid, effectData: { disabled: true }, match: { path: "_id", value: "dasEssaiFormeEf0" } }).catch(() => {}));
    ctx.expect((await effectState()) === true, "effet : éteint au départ");
    await ctx.call("upsert-embedded-effect", { uuid: shapeUuid, effectData: { disabled: false }, match: { path: "_id", value: "dasEssaiFormeEf0" } }).catch(() => null);
    const refused = await legality();
    ctx.expect(!!refused, "effet allumé à la main : la fenêtre « Utiliser quand même » s'ouvre");
    await sleep(1500);
    ctx.expect((await effectState()) === true, "effet : refusé, il reste éteint");
    ctx.expect((await ctx.hp(bear)) === 13, `effet : 1 dégât perforant au porteur (14 → ${await ctx.hp(bear)} PV)`);
    const beforeForce = await ctx.lastMessageId();
    if ( refused ) await ctx.call("answer-dialog", { id: refused.id, button: "go" });
    await sleep(2500);
    ctx.expect((await effectState()) === false, "effet, « Utiliser quand même » : il s'allume");
    ctx.expect((await ctx.messagesSince(beforeForce)).some(m => m.flags?.[MODULE_ID]?.gmAlert), "effet forcé : alerte au MJ");
    await ctx.call("upsert-embedded-effect", { uuid: shapeUuid, effectData: { disabled: true }, match: { path: "_id", value: "dasEssaiFormeEf0" } }).catch(() => null);

    // 4. Without the collar, Regeneration returns.
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: collarId }).catch(() => {});
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) > 10, `collier retiré : la régénération revient (10 → ${await ctx.hp(bear)} PV)`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
