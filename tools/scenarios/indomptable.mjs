/**
 * §485: replaying, as a Reaction, the save of a carried effect (Indomitable of third-party monsters). A synthetic item lent to
 * the Bandit, its rule placed in the world overlay (`api.mcp.overrideContent`):
 *   { on: "enemyTurnEnd", if: { "self.hasSavableEffect": true },
 *     do: [{ type: "use", target: "self" }, { type: "resave", own: "choose" }] }
 *  1. the Bandit fails two saves (the Cleric's Bane, the Wizard's Faerie Fire, SRD spells);
 *  2. the Wizard ends their turn: the Bandit's Reaction window opens on the GM's side, then the question "which save?" with two
 *     options; the second one chosen, a repeated save card (moment "reaction") for THAT effect; on a success, it ends, the
 *     other stays;
 *  3. the effects removed, the Wizard ends their turn again: no more window (nothing to replay).
 * Restores effects, Concentration, lent items and overlay.
 */
const MODULE_ID = "dnd5e-combat";
const SRD = "Compendium.dnd5e.spells24.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const IDENTIFIER = "essai-indomptable-das";
const ACTIVITY = "essaiIndompt0001";
const RULE = { triggers: [{ on: "enemyTurnEnd", if: { "self.hasSavableEffect": true },
  do: [{ type: "use", target: "self" }, { type: "resave", own: "choose" }] }] };

export default {
  name: "indomptable — rejouer en réaction la sauvegarde d'un effet porté, au choix du MJ (§485)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Clerc", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const mage = await ctx.token("Magicien");
    const clerc = await ctx.token("Clerc");
    const bandit = await ctx.token("Bandit");

    // --- Lent item and rule ------------------------------------------------------------------------------------------------
    const itemData = { name: "Essai : indomptable", type: "feat", img: "icons/svg/upgrade.svg",
      system: { identifier: IDENTIFIER, activities: { [ACTIVITY]: { _id: ACTIVITY, type: "utility", name: "Indomptable",
        activation: { type: "reaction", value: 1 }, target: { affects: { type: "self" } } } } } };
    await ctx.call("upsert-actor-item", { actorId: bandit.actorId, itemData, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(bandit.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: bandit.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));

    const atWill = { system: { method: "atwill" } };
    await ctx.ensureItem(clerc, `${SRD}phbsplBane000000`, atWill);
    await ctx.ensureItem(mage, `${SRD}phbsplFaerieFire`, atWill);

    const SPELLS = ["bane", "faerie-fire"];
    const carried = async () => ctx.effectsFrom(bandit, ...SPELLS);
    const clear = async () => {
      for ( const e of await carried() ) await ctx.call("remove-embedded-effect", { documentType: "Token", id: bandit.id, effectId: e.id }).catch(() => {});
      for ( const t of [mage, clerc] ) await ctx.removeStatusEffects(t, "concentrating").catch(() => {});
    };
    ctx.restore(async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      await clear();
    });

    /** Casts until the Bandit carries the spell's effect (failed save), 20 tries at most. */
    const until = async (caster, identifier, extra={}) => {
      for ( let i = 0; i < 20; i++ ) {
        if ( (await carried()).some(e => e.identifier === identifier) ) return true;
        await ctx.removeStatusEffects(caster, "concentrating").catch(() => {});
        await pause(500);
        const used = await ctx.use({ tokenId: caster.id, identifier, activityType: "save", targetTokenIds: [bandit.id], ...extra });
        if ( used.regionId ) ctx.restore(() => ctx.call("delete-scene-object", { type: "Region", objectId: used.regionId }).catch(() => {}));
        await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
        await pause(1200);
      }
      return (await carried()).some(e => e.identifier === identifier);
    };

    // --- 1. Two effects with a failed save ---------------------------------------------------------------------------------
    await clear();
    if ( !ctx.expect(await until(clerc, "bane"), "le Bandit rate sa sauvegarde contre le Fléau") ) return;
    if ( !ctx.expect(await until(mage, "faerie-fire", { area: { shape: "rectangle", ...(await ctx.box(bandit)) } }),
      "le Bandit rate sa sauvegarde contre les Lueurs féeriques") ) return;
    const two = await carried();
    ctx.expect(new Set(two.map(e => e.identifier)).size === 2, `deux effets portés (${two.map(e => e.identifier).join(", ")})`);

    // --- 2. End of the Wizard's turn: Reaction, choice, save ---------------------------------------------------------------
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    await ctx.startCombat([mage, bandit]);
    const combat = await state();
    for ( const [t, n] of [[mage, 20], [bandit, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: n, combatId: ctx.ownCombat });
    }
    for ( let i = 0; (i < 3) && ((await current()) !== mage.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === mage.id, "combat : au tour du Magicien") ) return;

    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** The next window that has this button, within `ms`. */
    const dialogWith = async (ids, action, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.buttons ?? []).some(b => b.action === action));
        if ( d ) return d;
      }
      return null;
    };
    const resaves = async since => (await ctx.messagesSince(since)).filter(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.resave);

    let ids = await known();
    let since = await ctx.lastMessageId();
    await ctx.nextTurn();
    const reaction = await dialogWith(ids, "use0");
    if ( !ctx.expect(!!reaction, `fin du tour du Magicien : le MJ peut faire réagir le Bandit${reaction ? ` (« ${reaction.title} »)` : ""}`) ) return;
    ids = await known();
    await ctx.call("answer-dialog", { id: reaction.id, button: "use0" });
    const choice = await dialogWith(ids, "pick1");
    const options = (choice?.buttons ?? []).filter(b => /^pick/.test(b.action ?? ""));
    if ( !ctx.expect(options.length === 2, `la question « quelle sauvegarde ? » propose deux effets (${options.map(b => b.label).join(" | ") || "aucune fenêtre"})`) ) return;
    await ctx.call("answer-dialog", { id: choice.id, button: "pick1" });
    let card = null;
    for ( const stop = Date.now() + 15000; !card && (Date.now() < stop); await pause(500) ) card = (await resaves(since)).at(-1) ?? null;
    const flag = card?.flags?.[MODULE_ID]?.resave;
    if ( !ctx.expect(flag?.moment === "reaction", `une carte de sauvegarde répétée, moment « reaction » (${flag?.moment ?? "aucune"})`) ) return;
    const chosen = two.find(e => String(flag.effect).endsWith(`.ActiveEffect.${e.id}`));
    const other = two.find(e => e !== chosen);
    ctx.expect(!!chosen, `la carte rejoue un des deux effets (${flag.effect})`);
    ctx.expect(String(options[1]?.label ?? "").includes(chosen?.effect ?? "\u0000") || !chosen?.effect,
      `l'effet rejoué est celui de la seconde option (« ${options[1]?.label} » ; ${chosen?.effect ?? "?"})`);
    const r = await ctx.settle(card.id, { timeoutMs: 45000 }).catch(() => null);
    const save = r?.targets?.find(t => t.name === "Bandit")?.save;
    await pause(1500);
    const after = await carried();
    if ( save?.success === true ) ctx.expect(!after.some(e => e.id === chosen?.id) && after.some(e => e.id === other?.id), `sauvegarde réussie (${save.total}) : l'effet choisi tombe, l'autre reste`);
    else if ( save?.success === false ) ctx.expect(after.some(e => e.id === chosen?.id) && after.some(e => e.id === other?.id), `sauvegarde ratée (${save.total}) : les deux effets restent`);
    else ctx.expect(false, "la sauvegarde répétée est résolue");

    // --- 3. Nothing left to replay: no window ----------------------------------------------------------------------------
    await clear();
    await pause(800);
    await ctx.nextTurn(); await pause(2000);   // tour du Bandit
    ids = await known();
    since = await ctx.lastMessageId();
    await ctx.nextTurn();                         // nouveau round : tour du Magicien
    await pause(1500);
    await ctx.nextTurn();                         // le Magicien finit son tour
    const none = await dialogWith(ids, "use0", 6000);
    if ( none ) await ctx.call("answer-dialog", { id: none.id, button: "none" }).catch(() => {});
    ctx.expect(!none && !(await resaves(since)).length, `sans effet à rejouer, aucune fenêtre ni sauvegarde${none ? ` (« ${none.title} »)` : ""}`);
    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
