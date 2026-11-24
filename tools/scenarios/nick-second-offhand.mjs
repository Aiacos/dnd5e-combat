/**
 * §532 (issue #143): with the Nick mastery, the Light property's one extra attack is made as part of the Attack action instead of
 * as a Bonus Action, once per turn (SRD 5.2) — Nick moves that attack, it does not add one. World `dnd-6`, arena; the Magicien is
 * lent the Dagger's mastery (Nick) for the scenario.
 *  1. In combat, on the Magicien's turn, next to the Zombi: a Dagger attack in the Attack action (`lightAttack`).
 *  2. The off-hand Dagger attack with Nick: accepted, free (Bonus Action kept), `nickUsed` and `offhandUsed` recorded.
 *  3. A second off-hand attack: the legality reports `lightExtraUsed` (the Light extra attack was already made this turn).
 *  4. Played from the right-click menu (« Attack (off hand) »): the « do it anyway » window opens with that reason;
 *     « Give up »: no usage card, Bonus Action kept; « Use anyway »: the card carries the reason (`overridden`), the GM is
 *     alerted (`gmAlert`), and the Bonus Action is spent.
 * Restores position, HP, the Dagger (quantity, equipped, mastery, last attack mode) and the Magicien's weapon masteries.
 */
import { readFileSync } from "node:fs";

const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const LANGS = ["en", "fr", "pt-BR", "it"].map(l => JSON.parse(readFileSync(new URL(`../../module/lang/${l}.json`, import.meta.url), "utf-8")));
/** A menu entry's label, in any of the module's languages (the GM client may use any of them). */
const labelsOf = (key, name) => LANGS.map(l => l[`DND5ECOMBAT.Menu.${key}`]?.replace("{name}", name)).filter(Boolean);
/** The refusal's text in every language, cut before the parenthesis (enough to recognise it). */
const REASONS = LANGS.map(l => l["DND5ECOMBAT.Souci.lightExtraUsed"]?.split(" (")[0]).filter(Boolean);
const isReason = text => REASONS.some(r => String(text ?? "").includes(r));

export default {
  name: "Nick — the Light extra attack once per turn, a second off-hand attack refused then forced",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Zombi"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} required: not applicable`); return; }
    const mage = await ctx.token("Magicien");
    const zombi = await ctx.token("Zombi");
    const size = await ctx.gridSize();

    // The Dagger: Light, Nick mastery, two of them, equipped.
    const daggerId = await ctx.itemId(mage.id, "dagger");
    const dagger = () => ctx.call("get-actor", { actorId: mage.actorId }).then(a => (a.items ?? []).find(i => i._id === daggerId));
    const d0 = await dagger();
    if ( !d0?.system?.properties?.includes?.("lgt") ) { ctx.log("Dagger without Light: not applicable"); return; }
    const setDagger = itemData => ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData, match: { path: "_id", value: daggerId } });
    ctx.restore(async () => {
      const last = (await dagger())?.flags?.dnd5e?.last ?? {};
      const reset = Object.fromEntries(Object.entries(last).filter(([, v]) => /offhand/.test(v?.attackMode ?? ""))
        .map(([k]) => [`flags.dnd5e.last.${k}.attackMode`, "oneHanded"]));
      await setDagger({ "system.quantity": d0.system.quantity ?? 1, "system.equipped": d0.system.equipped === true,
        "system.mastery": d0.system.mastery ?? "", ...reset }).catch(() => {});
    });
    await setDagger({ "system.quantity": 2, "system.equipped": true, "system.mastery": "nick" });

    // The Magicien masters the Dagger for the scenario (dnd5e: `masteryOptions` needs the base item among the chosen masteries).
    const actor0 = await ctx.call("get-actor", { actorId: mage.actorId });
    const chosen0 = actor0.system?.traits?.weaponProf?.mastery?.value ?? [];
    const chosen = Array.isArray(chosen0) ? chosen0 : Object.keys(chosen0 ?? {});
    ctx.restore(() => ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.traits.weaponProf.mastery.value": chosen } }).catch(() => {}));
    await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.traits.weaponProf.mastery.value": [...new Set([...chosen, "dagger"])] } });

    // The Zombi survives three Dagger hits (no death, nor Undead Fortitude, in the middle of the scenario).
    const hp0 = await ctx.hp(zombi);
    const { data: zdata } = await ctx.call("get-scene-object", { type: "Token", objectId: zombi.id });
    const max0 = zdata.delta?.system?.attributes?.hp?.max ?? null;
    if ( !zdata.actorLink ) {
      ctx.restore(() => ctx.call("update-scene-object", { type: "Token", objectId: zombi.id,
        data: max0 === null ? { "delta.system.attributes.hp.-=max": null } : { "delta.system.attributes.hp.max": max0 } }).catch(() => {}));
      await ctx.call("update-scene-object", { type: "Token", objectId: zombi.id, data: { "delta.system.attributes.hp.max": 300, "delta.system.attributes.hp.value": 300 } });
    }
    ctx.restore(() => ctx.setHp(zombi, hp0));

    const home = await ctx.position(mage);
    ctx.restore(() => ctx.call("move-token", { tokenId: mage.id, x: home.x, y: home.y, elevation: home.elevation ?? 0 }).catch(() => {}));
    const moved = await ctx.call("move-token", { tokenId: mage.id, x: zombi.x + size, y: zombi.y, elevation: 0 });
    if ( !ctx.expect(!!moved?.moved, "Magicien next to the Zombi") ) return;
    await pause(600);

    await ctx.startCombat([mage, zombi]);
    for ( let i = 0; i < 3; i++ ) {
      const state = await ctx.combat();
      const combat = state.combat ?? state.combats?.[0] ?? state;
      if ( combat.combatants?.find(c => c.id === combat.currentCombatantId)?.tokenId === mage.id ) break;
      await ctx.nextTurn();
      await pause(800);
    }
    const budget = () => ctx.engine("budget", { tokenId: mage.id });
    const issues = () => ctx.engine("issues", { tokenId: mage.id, itemId: daggerId, activityType: "attack", attackMode: "offhand" });

    /** Plays an attack confirmed for the engine (no legality window), and waits for its resolution. */
    const strike = async attackMode => {
      const u = await ctx.use({ tokenId: mage.id, itemId: daggerId, activityType: "attack", targetTokenIds: [zombi.id], usageConfig: { attackMode } });
      await ctx.settle(u.usageMessageId).catch(() => null);
      await pause(800);
      return u;
    };

    // 1. A Dagger attack in the Attack action.
    await strike("oneHanded");
    let b = await budget();
    ctx.expect(b?.lightAttack === true, `Dagger in the Attack action: Light attack recorded (lightAttack ${b?.lightAttack})`);
    const nickOpen = await issues();
    ctx.expect(!nickOpen.length, `off-hand attack with Nick: nothing to report (${nickOpen.join(" | ")})`);

    // 2. The off-hand attack with Nick: free.
    await strike("offhand");
    b = await budget();
    ctx.expect((b?.nickUsed === true) && (b?.offhandUsed === true), `Nick used, Light extra attack made (nickUsed ${b?.nickUsed}, offhandUsed ${b?.offhandUsed})`);
    ctx.expect(b?.bonus === 1, `Bonus Action kept (${b?.bonus})`);

    // 3. A second off-hand attack: refused.
    const second = await issues();
    ctx.expect(second.some(isReason), `second off-hand attack: the Light extra attack was already made (${second.join(" | ")})`);

    // 4. From the right-click menu: the window, given up then forced.
    const { labels } = await ctx.engine("menu", { tokenId: mage.id, targetId: zombi.id });
    const entry = labels.find(l => labelsOf("MainSecondaire", d0.name).includes(l));
    if ( !ctx.expect(!!entry, `off-hand attack with ${d0.name} in the Zombi's menu (${labels.join(" | ")})`) ) return;

    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${mage.name}`));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => { const d = await legality(300); if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {}); });
    const usages = messages => messages.filter(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.spent ?? m.flags?.spent)?.offhand === true);
    const alerts = messages => messages.filter(m => m.flags?.[MODULE_ID]?.gmAlert);

    const attempt = async button => {
      const since = await ctx.lastMessageId();
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      await ctx.engine("menu", { tokenId: mage.id, targetId: zombi.id, run: entry });
      const d = await legality();
      if ( !d ) return { window: null, messages: await ctx.messagesSince(since) };
      const lines = `${d.content ?? d.text ?? ""}`;
      await ctx.call("answer-dialog", { id: d.id, button });
      if ( button !== "go" ) { await pause(2000); return { window: d, lines, messages: await ctx.messagesSince(since) }; }
      // A dnd5e roll window, if fast attacks are off in this world: normal roll.
      const roll = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...known, d.id], waitMs: 3000 }).catch(() => null);
      for ( const w of roll?.windows ?? [] ) await ctx.call("answer-dialog", { id: w.id, button: "normal" }).catch(() => {});
      let messages = [];
      for ( const stop = Date.now() + 15000; Date.now() < stop; await pause(500) ) {
        messages = await ctx.messagesSince(since);
        if ( usages(messages).length && alerts(messages).length ) break;
      }
      return { window: d, lines, messages };
    };

    const giveUp = await attempt("cancel");
    if ( ctx.expect(!!giveUp.window, "menu: the do-it-anyway window opens") ) {
      if ( giveUp.lines ) ctx.expect(isReason(giveUp.lines), `the window gives the reason (${giveUp.lines.replace(/<[^>]+>/g, " ").slice(0, 200)})`);
      ctx.expect(!usages(giveUp.messages).length && !alerts(giveUp.messages).length, `given up: no card, no alert (${giveUp.messages.length} message(s))`);
      b = await budget();
      ctx.expect(b?.bonus === 1, `given up: Bonus Action kept (${b?.bonus})`);
    }

    const forced = await attempt("go");
    if ( !ctx.expect(!!forced.window, "menu, again: the window opens") ) return;
    const card = usages(forced.messages)[0];
    const reasons = card?.flags?.[MODULE_ID]?.overridden ?? [];
    ctx.expect(reasons.some(isReason), `forced: the card carries the reason (${reasons.join(" | ")})`);
    const text = alerts(forced.messages)[0]?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
    ctx.expect(isReason(text), `forced: the GM is alerted with the reason (${text})`);
    const spent = card?.flags?.[MODULE_ID]?.spent ?? card?.flags?.spent;
    ctx.expect((spent?.before?.bonus === 1) && (spent?.after?.bonus === 0), `forced: Bonus Action spent (${spent?.before?.bonus} → ${spent?.after?.bonus})`);
    if ( card ) await ctx.settle(card._id ?? card.id).catch(() => null);
  }
};
