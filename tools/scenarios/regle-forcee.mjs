/**
 * §408 (issue #44, batch 1): a rule overridden, in the "Refusals Arena" (`node tools/arene-refus.mjs`). The Mage (level 1
 * pre-generated Wizard from the Handbook, player character) casts Ray of Frost (60 ft) with no automatic confirmation:
 * the legality window opens on the GM's side (here the one who acts).
 *  1. Out of range (the Distant Target, at 155 ft) — "Give up": nothing is cast, no alert.
 *  2. "Use anyway": the use card is marked `overridden` (the only reason "out of range"); a GM alert
 *     carries the reason and the target.
 *  3. Incapacitated, against the Dummy in melee: the only reason is the condition.
 *  4. Setting `forcedAlerts` off: the card is marked, no alert.
 * The banner on the card, the window on a player's side and the floating text "Forced" are checked in the browser
 * (`claude player`).
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "règle forcée — fenêtre de légalité, alerte au MJ, carte marquée",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const far = await ctx.token("Cible lointaine des refus");
    const ray = await ctx.itemId(mage.id, "ray-of-frost");

    const legality = async (ms=8000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const d = (r?.windows ?? []).find(w => / — Mage des refus$/.test(w.title ?? ""));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      const d = await legality(500);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
    });
    const cast = target => ctx.call("use-activity", { tokenId: mage.id, itemId: ray, activityType: "attack", configure: false,
      targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
    const alerts = messages => messages.filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    const usages = messages => messages.filter(m => (m.type === "usage") && (m.flags?.[MODULE_ID]?.overridden?.length));
    /** Casts, answers `button` to the window, returns the messages created since. */
    const attempt = async (target, button) => {
      const since = await ctx.lastMessageId();
      await cast(target);
      const d = await legality();
      if ( !d ) return null;
      await ctx.call("answer-dialog", { id: d.id, button });
      await pause(button === "go" ? 3000 : 1500);
      return ctx.messagesSince(since);
    };

    // 1. Out of range, given up.
    let after = await attempt(far, "cancel");
    if ( !ctx.expect(!!after, "hors de portée : la fenêtre de légalité s'ouvre") ) return;
    ctx.expect(!alerts(after).length && !usages(after).length, `renoncé : ni alerte, ni carte (${after.length} message(s))`);

    // 2. Forced.
    after = await attempt(far, "go");
    if ( !ctx.expect(!!after, "la fenêtre se rouvre") ) return;
    let card = usages(after)[0];
    ctx.expect(!!card, `forcé : la carte d'utilisation est marquée (${after.map(m => m.type).join(", ")})`);
    let reasons = card?.flags?.[MODULE_ID]?.overridden ?? [];
    ctx.expect((reasons.length === 1) && reasons[0].includes(far.name), `une raison, la portée de la Cible lointaine (${reasons.join(" | ")})`);
    let text = alerts(after)[0]?.flags?.[MODULE_ID]?.gmAlert?.text ?? "";
    ctx.expect(!!text && text.includes(reasons[0] ?? "§") && text.includes("Mage des refus"), `une alerte MJ, avec la raison et qui agit (${text})`);

    // 3. Incapacitated, in melee.
    await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: true });
    ctx.restore(() => ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false }).catch(() => {}));
    after = await attempt(dummy, "go");
    if ( ctx.expect(!!after, "Neutralisé : la fenêtre s'ouvre") ) {
      reasons = usages(after)[0]?.flags?.[MODULE_ID]?.overridden ?? [];
      ctx.expect((reasons.length === 1) && !reasons[0].includes(dummy.name), `une raison, l'état (${reasons.join(" | ")})`);
      ctx.expect(alerts(after).length === 1, `une alerte MJ (${alerts(after).length})`);
    }

    // 4. GM alerts off: the card stays marked.
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "forcedAlerts", value: false });
    ctx.restore(() => ctx.call("set-setting", { namespace: MODULE_ID, key: "forcedAlerts", value: true }).catch(() => {}));
    after = await attempt(dummy, "go");
    if ( ctx.expect(!!after, "réglage éteint : la fenêtre s'ouvre toujours") ) {
      ctx.expect(usages(after).length === 1 && !alerts(after).length, `carte marquée, aucune alerte (${usages(after).length}, ${alerts(after).length})`);
    }
    await ctx.call("set-setting", { namespace: MODULE_ID, key: "forcedAlerts", value: true });
    await ctx.call("set-status", { tokenId: mage.id, statusId: "incapacitated", active: false });

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
