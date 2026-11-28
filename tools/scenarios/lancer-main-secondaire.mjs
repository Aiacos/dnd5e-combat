/**
 * §240 (issue #13): a Light and Thrown weapon (the Dagger) offers in the context menu the off-hand throw (dnd5e's
 * `thrown-offhand` mode), which costs the Bonus Action like the off-hand attack.
 *  1. In contact with the Zombi, in combat, on the Wizard's turn: Dagger hit in the Attack action (`lightAttack`).
 *  2. The Wizard steps back three cells: the Zombi's menu offers "Attack (off-hand)" and "Throw (off-hand): Dagger"
 *     (an equipped weapon that has these modes). §241: the base attack is the Dagger; with no equipped weapon, the unarmed strike.
 *  3. The entry played: the Dagger goes out in `thrown-offhand`, without approaching; Bonus Action debited, action unchanged.
 * Restores position, HP, quantity and equipment of the weapons, last mode retained by dnd5e; removes the tiles placed
 * (Dagger fallen on the ground).
 */
import { readFileSync } from "node:fs";

const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LANGS = ["en", "fr", "pt-BR"].map(l => JSON.parse(readFileSync(new URL(`../../module/lang/${l}.json`, import.meta.url), "utf-8")));
/** The label of a menu entry, in one of the module's languages (the GM's client can be in any of them). */
const labelsOf = (key, name) => LANGS.map(l => l[`DND5ECOMBAT.Menu.${key}`]?.replace("{name}", name)).filter(Boolean);

export default {
  name: "lancer de la main secondaire — au menu, action Bonus",

  async run(ctx) {
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const size = await ctx.gridSize();
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    await ctx.setHp(zombi, 15);   // two Dagger hits (1d4 + 3 at most each) do not kill it: no death in mid-resolution

    const daggerId = await ctx.itemId(mage.id, "dagger");
    const dagger = () => ctx.call("get-actor", { actorId: mage.actorId }).then(a => (a.items ?? []).find(i => i._id === daggerId));
    const d0 = await dagger();
    if ( !d0?.system?.properties?.includes?.("thr") || !d0.system.properties.includes("lgt") ) { ctx.log("Dague sans Légère + Lancer : non applicable"); return; }
    const setDagger = itemData => ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "_id", value: daggerId } });
    // dnd5e keeps the item's last attack mode (`flags.dnd5e.last`): we give it back, like the quantity.
    ctx.restore(async () => {
      const last = (await dagger())?.flags?.dnd5e?.last ?? {};
      const reset = Object.fromEntries(Object.entries(last).filter(([, v]) => /offhand|thrown/.test(v?.attackMode ?? ""))
        .map(([k]) => [`flags.dnd5e.last.${k}.attackMode`, "oneHanded"]));
      await setDagger({ "system.quantity": d0.system.quantity ?? 1, "system.equipped": d0.system.equipped === true, ...reset }).catch(() => {});
    });
    // Equipped (the menu only offers weapons in hand), two copies: the one that is thrown leaves.
    await setDagger({ "system.quantity": 2, "system.equipped": true });

    const tiles = async () => ((await ctx.call("list-scene-objects", { types: ["Tile"] })).objects?.Tile ?? []).map(t => t.id);
    const tiles0 = new Set(await tiles());
    ctx.restore(async () => {
      for ( const id of (await tiles()).filter(id => !tiles0.has(id)) ) await ctx.call("delete-scene-object", { type: "Tile", objectId: id }).catch(() => {});
    });

    const home = { x: mage.x, y: mage.y };
    const moveMage = async (x, y) => {
      const r = await ctx.call("move-token", { tokenId: mage.id, x, y });
      if ( !r?.moved ) throw new Error(`Magicien non déplacé en ${x},${y}`);
      await sleep(500);
    };
    ctx.restore(() => moveMage(home.x, home.y));
    await moveMage(zombi.x + size, zombi.y);

    await ctx.startCombat([mage, zombi]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === mage.id ) break;
      await ctx.nextTurn();
      await sleep(800);
    }

    /** The expense recorded by the GM on the use card. */
    async function spentOn(usageMessageId, accept=() => true) {
      for ( const until = Date.now() + 8000; Date.now() < until; await sleep(400) ) {
        const message = (await ctx.call("list-chat-messages", { limit: 30, flagScope: MODULE_ID })).messages?.find(m => m.id === usageMessageId);
        const spent = message?.flags?.[MODULE_ID]?.spent ?? message?.flags?.spent;
        if ( spent && accept(spent) ) return spent;
      }
      return null;
    }

    // 1. Dagger hit in contact, in the Attack action.
    const stab = await ctx.use({ tokenId: mage.id, identifier: "dagger", activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode: "oneHanded" } });
    await ctx.settle(stab.usageMessageId).catch(() => null);
    const s1 = await spentOn(stab.usageMessageId);
    ctx.expect(s1?.after?.lightAttack === true, `Dague au contact : attaque d'arme Légère consignée (lightAttack ${s1?.after?.lightAttack})`);

    // 2. Trois cases plus loin : le menu.
    const far = { x: zombi.x + (3 * size), y: zombi.y };
    await moveMage(far.x, far.y);
    const name = d0.name;
    const { labels } = await ctx.engine("menu", { tokenId: mage.id, targetId: zombi.id });
    ctx.log(`menu du Zombi : ${labels.join(" | ")}`);
    const offThrow = labels.find(l => labelsOf("LancerMainSecondaire", name).includes(l));
    ctx.expect(!!offThrow, `« Lancer (main secondaire) : ${name} » au menu`);
    ctx.expect(labels.some(l => labelsOf("Lancer", name).includes(l)) && labels.some(l => labelsOf("MainSecondaire", name).includes(l)),
      "le lancer et la main secondaire y restent");
    if ( !offThrow ) return;

    // §241: with no equipped weapon, the base attack is the unarmed strike (the other weapons unequipped during the reading).
    const armed = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? [])
      .filter(i => (i.type === "weapon") && i.system?.equipped && (i.system.identifier !== "unarmed-strike"));
    // The sheet may have another equipped weapon (the Wizard's focus Staff): unequipped during the reading.
    const others = armed.filter(i => i._id !== d0._id);
    for ( const i of others ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": false }, match: { path: "_id", value: i._id } });
    const alone = await ctx.engine("reachCheck", { tokenId: mage.id, targetId: zombi.id });
    ctx.expect(alone.weapon === name, `attaque de base : la Dague équipée (${alone.weapon})`);
    for ( const i of armed ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": false }, match: { path: "_id", value: i._id } });
    const unarmed = ((await ctx.call("get-actor", { actorId: mage.actorId })).items ?? []).find(i => i.system?.identifier === "unarmed-strike");
    const empty = await ctx.engine("reachCheck", { tokenId: mage.id, targetId: zombi.id });
    for ( const i of armed ) await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: { "system.equipped": true }, match: { path: "_id", value: i._id } });
    ctx.expect(!!unarmed && (empty.weapon === unarmed.name), `aucune arme équipée : attaque de base à mains nues (${empty.weapon})`);

    // 3. The entry played.
    const since = await ctx.lastMessageId();
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    await ctx.engine("menu", { tokenId: mage.id, targetId: zombi.id, run: offThrow });
    // A dnd5e roll window, if the quick attack is off in this world: normal roll.
    const dialog = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 3000 }).catch(() => null);
    for ( const w of dialog?.windows ?? [] ) await ctx.call("answer-dialog", { id: w.id, button: "normal" }).catch(() => {});
    let usage = null;
    for ( const until = Date.now() + 15000; !usage && (Date.now() < until); await sleep(500) ) {
      usage = (await ctx.messagesSince(since)).find(m => (m.flags?.[MODULE_ID]?.spent ?? m.flags?.spent)?.offhand === true) ?? null;
    }
    const spent = usage?.flags?.[MODULE_ID]?.spent ?? usage?.flags?.spent;
    ctx.expect(!!spent, "lancer de la main secondaire : dépense consignée en main secondaire");
    ctx.expect(spent?.after?.bonus === 0 && spent?.after?.action === spent?.before?.action,
      `action Bonus ${spent?.before?.bonus} → ${spent?.after?.bonus}, action inchangée (${spent?.before?.action} → ${spent?.after?.action})`);
    const pos = await ctx.position(mage);
    ctx.expect((pos.x === far.x) && (pos.y === far.y), `sans s'approcher (${pos.x},${pos.y})`);
    const mode = Object.values((await dagger())?.flags?.dnd5e?.last ?? {}).map(v => v?.attackMode).find(Boolean);
    ctx.expect(mode === "thrown-offhand", `mode retenu par dnd5e : ${mode}`);
    if ( usage ) await ctx.settle(usage.id).catch(() => null);
  }
};
