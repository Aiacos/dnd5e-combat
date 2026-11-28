/**
 * §492: fact `source.attackedSelfThisTurn` — "when a hostile creature ends its turn after having attacked it in melee".
 * Test arena, Fighter and Bandit. A test item lent to the Bandit (Reaction), its rule placed in the world overlay:
 *   { on: "enemyTurnEnd", if: { "source.attackedSelfThisTurn": "melee" }, do: [{ type: "use", target: "source" }] }
 *  1. the Fighter, in melee contact, ends his turn without attacking: no Reaction window;
 *  2. next round, he attacks the Bandit with a melee weapon: the combat registry notes "melee" (tool
 *     `attacksThisTurn`); he ends his turn: the Bandit's Reaction window opens on the GM's side (answered "none");
 *  3. next round, he ends his turn without attacking: no more window (the registry only holds for his turn).
 * Resets position, HP, lent item, overlay and combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const IDENTIFIER = "essai-riposte-attaque-das";
const ACTIVITY = "essaiRiposte0001";
const RULE = { triggers: [{ on: "enemyTurnEnd", if: { "source.attackedSelfThisTurn": "melee" }, do: [{ type: "use", target: "source" }] }] };

export default {
  name: "attaqué ce tour §492 — réaction quand un ennemi finit son tour après l'avoir attaqué au corps à corps",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Bandit"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Bandit absent : non applicable"); return; }
    const fighter = await ctx.token("Guerrier");
    const bandit = await ctx.token("Bandit");

    // --- Lent item and rule ----------------------------------------------------------------------------------------
    const itemData = { name: "Essai : riposte", type: "feat", img: "icons/svg/sword.svg",
      system: { identifier: IDENTIFIER, activities: { [ACTIVITY]: { _id: ACTIVITY, type: "utility", name: "Riposte",
        activation: { type: "reaction", value: 1 }, target: { affects: { type: "creature", count: "1" } } } } } };
    await ctx.call("upsert-actor-item", { actorId: bandit.actorId, itemData, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(bandit.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: bandit.actorId, itemId: lent }).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));

    // --- The Fighter in melee, Bandit's HP kept ------------------------------------------------------------------------
    const home = await ctx.position(fighter);
    const hp = await ctx.hp(bandit);
    ctx.restore(async () => {
      await ctx.call("move-token", { tokenId: fighter.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
      await ctx.setHp(bandit, hp).catch(() => {});
    });
    const grid = await ctx.gridSize();
    const at = await ctx.position(bandit);
    await ctx.call("move-token", { tokenId: fighter.id, x: at.x - grid, y: at.y, elevation: at.elevation ?? 0 });
    await pause(1200);
    const weapon = ((await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [])
      .find(i => (i.type === "weapon") && !i.flags?.[MODULE_ID]?.basicAction
        && Object.values(i.system?.activities ?? {}).some(a => (a.type === "attack") && (a.attack?.type?.value === "melee")))?._id ?? null;
    if ( !ctx.expect(!!weapon, "le Guerrier a une arme de corps à corps") ) return;

    // --- Combat : Guerrier puis Bandit -----------------------------------------------------------------------------------
    const state = async () => { const s = await ctx.combat(); return s.combat ?? s.combats?.[0] ?? s; };
    const current = async () => { const c = await state(); return c.combatants?.find(x => x.id === c.currentCombatantId)?.tokenId ?? null; };
    await ctx.startCombat([fighter, bandit]);
    const combat = await state();
    for ( const [t, n] of [[fighter, 20], [bandit, 10]] ) {
      await ctx.call("set-initiative", { combatantId: combat.combatants.find(x => x.tokenId === t.id).id, value: n, combatId: ctx.ownCombat });
    }
    for ( let i = 0; (i < 3) && ((await current()) !== fighter.id); i++ ) { await ctx.call("previous-turn", { combatId: ctx.ownCombat }); await pause(1500); }
    if ( !ctx.expect((await current()) === fighter.id, "combat : au tour du Guerrier") ) return;

    const known = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    /** The next Reaction window (button `use0`), within `ms`. */
    const reactionWindow = async (ids, ms=15000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: ids, waitMs: 1500, details: true }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.buttons ?? []).some(b => b.action === "use0"));
        if ( d ) return d;
      }
      return null;
    };
    /** The Fighter ends his turn; returns the Bandit's Reaction window if there is one (refused immediately). */
    const endFighterTurn = async ms => {
      const ids = await known();
      await ctx.nextTurn();
      const d = await reactionWindow(ids, ms);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "none" }).catch(() => {});
      return d;
    };
    /** From the Bandit's turn to the Fighter's next turn. */
    const backToFighter = async () => { await pause(1500); await ctx.nextTurn(); await pause(1500); };

    // --- 1. No attack: no window ---------------------------------------------------------------------------------------
    let d = await endFighterTurn(6000);
    ctx.expect(!d, `sans attaque, le Guerrier finit son tour : aucune fenêtre${d ? ` (« ${d.title} »)` : ""}`);
    await backToFighter();
    if ( !ctx.expect((await current()) === fighter.id, "round 2 : au tour du Guerrier") ) return;

    // --- 2. A melee attack: the window opens ---------------------------------------------------------------------------
    const a = await ctx.use({ tokenId: fighter.id, itemId: weapon, activityType: "attack", targetTokenIds: [bandit.id] });
    const res = a.usageMessageId ? await ctx.settle(a.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
    ctx.expect(["done", "missed", "applied"].includes(res?.step), `l'attaque du Guerrier se résout (étape ${res?.step ?? "?"})`);
    await pause(1000);
    const noted = await ctx.engine("attacksThisTurn", { sourceId: fighter.id, targetId: bandit.id });
    ctx.expect(JSON.stringify(noted.kinds) === JSON.stringify(["melee"]),
      `le registre du tour note une attaque au corps à corps du Guerrier contre le Bandit (${JSON.stringify(noted.kinds)}, tour ${noted.turn})`);
    await ctx.setHp(bandit, hp);   // the Bandit must be standing to react
    d = await endFighterTurn(15000);
    ctx.expect(!!d, `le Guerrier finit son tour après l'avoir attaqué : le MJ peut faire réagir le Bandit${d ? ` (« ${d.title} »)` : ""}`);
    await backToFighter();
    if ( !ctx.expect((await current()) === fighter.id, "round 3 : au tour du Guerrier") ) return;

    // --- 3. The next turn, without attack: no more window ---------------------------------------------------------------
    const fresh = await ctx.engine("attacksThisTurn", { sourceId: fighter.id, targetId: bandit.id });
    ctx.expect(!(fresh.kinds ?? []).length, `nouveau tour : le registre ne compte plus l'attaque d'avant (${JSON.stringify(fresh.kinds)})`);
    d = await endFighterTurn(6000);
    ctx.expect(!d, `le tour suivant, sans attaque : aucune fenêtre${d ? ` (« ${d.title} »)` : ""}`);

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
