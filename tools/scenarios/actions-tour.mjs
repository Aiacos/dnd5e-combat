/**
 * Basic actions and off hand (SPEC §15.2), on the Wizard's turn, in contact with the Zombie:
 *  1. at the start of combat, the GM places on the Wizard (a player's character) the Dash, Disengage and Dodge items
 *     that he lacks;
 *  2. Dash by its item: the action is spent, the turn's movement doubled (`dashed`);
 *  3. Dagger in contact (Light weapon): the attack opens the off hand (`lightAttack`);
 *  4. Dagger in `offhand` mode chosen at the roll (the sheet's and the BG3 bar's path): the GM corrects
 *     the spending at the attack roll — the action returned, the Bonus Action debited (`offhand`).
 * The budget is read on the use card (`spent`, written by the GM). Puts the Wizard back at its
 * place, the Zombie's HP, and removes the items the engine placed during the scenario.
 */
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "actions de base et main secondaire — Pointe, Dague, Dague en main secondaire",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));

    const itemsOf = async () => (await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [];
    const basics = items => items.filter(i => i.flags?.[MODULE_ID]?.basicAction);

    // In contact with the Zombie, so that the Dagger is a melee attack with no detour.
    const size = await ctx.gridSize();
    const home = { x: mage.x, y: mage.y };
    const moveMage = async (x, y) => {
      const r = await ctx.call("move-token", { tokenId: mage.id, x, y });
      if ( !r?.moved ) throw new Error(`Magicien non déplacé en ${x},${y}`);
    };
    ctx.restore(() => moveMage(home.x, home.y));
    await moveMage(zombi.x + size, zombi.y);

    // 1. Combat: the basic actions are placed.
    await ctx.startCombat([mage, zombi]);   // itself removes, at the end, the items the engine will have placed
    let placed = [];
    for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
      placed = basics(await itemsOf());
      if ( placed.length >= 3 ) break;
    }
    ctx.expect(placed.length >= 3, `actions de base sur le Magicien : ${placed.map(i => i.name).join(", ") || "aucune"}`);
    const dashItem = placed.find(i => i.flags[MODULE_ID].basicAction === "dash");
    if ( !dashItem ) return;

    // Tour du Magicien.
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      const current = combat.combatants?.find(c => c.id === combat.currentCombatantId);
      if ( current?.tokenId === mage.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }

    /** The spending logged by the GM on the use card (waits for it to arrive, or for its correction). */
    async function spentOn(usageMessageId, accept=() => true) {
      for ( const until = Date.now() + 6000; Date.now() < until; await sleep(400) ) {
        const message = (await ctx.messagesSince(usageMessageId)).find(m => m.id === usageMessageId)
          ?? (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usageMessageId);
        const spent = message?.flags?.[MODULE_ID]?.spent ?? message?.flags?.spent;
        if ( spent && accept(spent) ) return spent;
      }
      return null;
    }

    // 2. Pointe.
    const dash = await ctx.use({ tokenId: mage.id, itemId: dashItem._id, activityType: "utility" });
    const s1 = await spentOn(dash.usageMessageId);
    ctx.expect(s1?.after?.dashed === true && s1.after.action === 0, `Pointe : action ${s1?.before?.action} → ${s1?.after?.action}, déplacement doublé (${s1?.after?.dashed})`);

    // 3. Dagger in contact: Light weapon, in the Attack action.
    const stab = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode: "oneHanded" } });
    await ctx.settle(stab.usageMessageId).catch(() => null);
    const s2 = await spentOn(stab.usageMessageId);
    ctx.expect(s2?.after?.lightAttack === true, `Dague : attaque d'arme Légère consignée (lightAttack ${s2?.after?.lightAttack})`);

    // 4. Dagger in off hand, mode chosen at the roll.
    // dnd5e remembers the item's last attack mode (`flags.dnd5e.last`): we put it back, otherwise the dagger would stay in the
    // off hand for the following scenarios (damage without modifier, seen on 2026-09-28).
    ctx.restore(async () => {
      const id = await ctx.itemId(mage.id, "dagger");
      const item = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i._id === id);
      const last = item?.flags?.dnd5e?.last ?? {};
      const reset = Object.fromEntries(Object.entries(last).filter(([, v]) => v?.attackMode === "offhand")
        .map(([k]) => [`flags.dnd5e.last.${k}.attackMode`, "oneHanded"]));
      if ( Object.keys(reset).length ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: reset, match: { path: "_id", value: id } });
    });
    const off = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode: "offhand" } });
    await ctx.settle(off.usageMessageId).catch(() => null);
    const s3 = await spentOn(off.usageMessageId, s => s.offhand === true);
    ctx.expect(s3?.offhand === true, "main secondaire choisie au jet : dépense corrigée par le MJ");
    ctx.expect(s3?.after?.bonus === 0 && s3?.after?.action === s3?.before?.action,
      `main secondaire : action Bonus ${s3?.before?.bonus} → ${s3?.after?.bonus}, action inchangée (${s3?.before?.action} → ${s3?.after?.action})`);
  }
};
