/**
 * B09 (§488) — Objet porté qui verrouille la forme et suspend un trait. Exemples synthétiques, prêtés à l'Ours brun :
 * - la Régénération du Troll (Monster Manual) ;
 * - « Forme d'essai » (identifiant `das-essai-forme`) : une activité utilitaire et un effet transféré éteint, la forme d'une fiche ;
 * - « Collier d'essai » (identifiant `das-essai-collier`, capacité : porté tant qu'il est sur la fiche), en drapeaux :
 *   `formLock: { worn: true, forms: ["das-essai-forme"], onAttempt: [1 dégât perforant au porteur] }`, `suspends: ["regeneration"]`.
 *  1. Au début de son tour, l'Ours ne se régénère pas (trait suspendu).
 *  2. Activité de la forme, depuis la fiche (sans confirmation) : la fenêtre de légalité donne la raison du collier ; l'Ours perd 1 PV ;
 *     « Renoncer » : pas de carte d'utilisation.
 *  3. Effet de la forme allumé à la main : refusé (l'effet reste éteint), 1 PV de moins, fenêtre ; « Utiliser quand même » : l'effet
 *     s'allume, alerte au MJ.
 *  4. Le collier retiré : au début de son tour, l'Ours se régénère de nouveau.
 * Initiative imposée : Kaalisti, puis l'Ours. Items, PV et effets remis comme avant.
 */
const MODULE_ID = "dnd5e-combat";
const TROLL = "Compendium.dnd-monster-manual.actors.Actor.mmTroll000000000";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCK_REASON = /Collier d'essai|change (its )?form|changer de forme/i;

const SHAPE = {
  name: "Forme d'essai", type: "feat", img: "icons/creatures/mammals/wolf-howl-moon-gray.webp",
  system: {
    identifier: "das-essai-forme", type: { value: "monster" },
    activities: { dasEssaiFormeAc0: { _id: "dasEssaiFormeAc0", type: "utility", name: "Changer de forme", activation: { type: "bonus", value: null },
      range: { units: "self" }, target: { affects: { type: "self" } } } }
  },
  effects: [{ _id: "dasEssaiFormeEf0", name: "Forme d'essai", img: "icons/creatures/mammals/wolf-shadow-black.webp", transfer: true, disabled: true, changes: [] }]
};
const COLLAR = {
  name: "Collier d'essai", type: "feat", img: "icons/equipment/neck/choker-chain-thick-silver.webp",
  system: { identifier: "das-essai-collier", type: { value: "monster" } },
  flags: { [MODULE_ID]: {
    formLock: { worn: true, forms: ["das-essai-forme"], onAttempt: [{ type: "damage", to: "bearer", formula: "1", damageType: "piercing" }] },
    suspends: ["regeneration"] } }
};

export default {
  name: "verrou de forme porté — tentative punie et refusée, Régénération suspendue (B09)",

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

    // Les trois items prêtés.
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

    // 1. Régénération suspendue.
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) === 10, `collier porté : pas de régénération au début du tour (10 → ${await ctx.hp(bear)} PV)`);

    // 2. L'activité de la forme : punie, refusée.
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

    // 3. L'effet de la forme allumé à la main.
    // Les items prêtés le sont à l'acteur de base (`upsert-actor-item`, comme `regeneration-declaree`) : l'effet s'allume là.
    const shapeUuid = `Actor.${tok.actorId}.Item.${shapeId}`;
    const effectState = async () => {
      const { data } = await ctx.call("get-item", { uuid: shapeUuid }).catch(() => ({ data: null }));
      return (data?.effects ?? []).find(e => e._id === "dasEssaiFormeEf0")?.disabled;
    };
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

    // 4. Sans collier, la Régénération revient.
    await ctx.call("remove-embedded-item", { documentType: "Actor", id: tok.actorId, itemId: collarId }).catch(() => {});
    if ( !ctx.expect(await turnOf(warlock), "tour de Kaalisti") ) return;
    await ctx.setHp(bear, 10);
    await ctx.nextTurn(); await sleep(2500);
    ctx.expect((await ctx.hp(bear)) > 10, `collier retiré : la régénération revient (10 → ${await ctx.hp(bear)} PV)`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
