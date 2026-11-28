/**
 * #173 (§556): dnd5e's own damage dialog for the damage the engine rolls. Fire Bolt of the Sorcerer against the Zombie
 * (Arène de test), cast until it hits, played as the GM (the author and the GM are the same client):
 *  1. `click`: after the hit, dnd5e's damage dialog (not DAS's old "Roll damage" button); no damage roll while it is open.
 *     A situational bonus of +7 typed in, "Critical Hit" pressed on a hit that is not a natural 20: the card holds the +7,
 *     the roll is critical, the Zombie loses the card's total.
 *  2. `click`, the dialog closed without a button (header X / Escape / delay): the roll still goes, the damage is applied.
 *  3. `auto` with this client's "Rolls without dialog" unchecked: the dialog is offered; "Normal" pressed, damage applied.
 *  4. `auto` with "Rolls without dialog" checked (the default): no dialog, the roll is chained as always.
 * Restored: `damageFlow`, `quickRolls`, the Zombie's HP, any dialog left open.
 */
const MODULE_ID = "dnd5e-combat";
const TERMINAL = new Set(["done", "missed", "undone"]);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** GM client: the engine's damage dialog, if one is open — and what to do with it. */
const DIALOG = `
  const app = [...foundry.applications.instances.values()].find(a => a.rendered && a.config?.["${MODULE_ID}"]?.dialog);
  if ( !app ) return { open: false };
  const buttons = [...app.element.querySelectorAll('button[type="submit"][data-action]')].map(b => b.dataset.action);
  const out = { open: true, cls: app.constructor.name, mode: app.config["${MODULE_ID}"].dialog, buttons,
    situational: !!app.element.querySelector('input[name="roll.0.situational"]'),
    countdown: app.element.querySelector(".dnd5e-combat-countdown .label")?.textContent ?? null };
  if ( opts.situational ) {
    const input = app.element.querySelector('input[name="roll.0.situational"]');
    input.value = opts.situational;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise(r => setTimeout(r, 400));
  }
  if ( opts.press ) app.element.querySelector('button[data-action="' + opts.press + '"]')?.click();
  else if ( opts.close ) await app.close();
  return out;`;

export default {
  name: "dnd5e's damage dialog for the engine's damage (#173): bonus, forced critical, closed, per client",

  async run(ctx) {
    const sorc = await ctx.token("Ensorceleur");
    const zombi = await ctx.token("Zombi");
    const hp0 = await ctx.hp(zombi);
    ctx.restore(() => ctx.setHp(zombi, hp0));
    const before = (await ctx.engine("setting", { key: "damageFlow" }))?.now ?? "level";
    const mode = value => ctx.engine("setting", { key: "damageFlow", value });
    ctx.restore(() => mode(before));
    const quick = value => ctx.call("run-script", { code: value === undefined
      ? `return game.settings.get("${MODULE_ID}", "quickRolls");`
      : `await game.settings.set("${MODULE_ID}", "quickRolls", ${JSON.stringify(value)}); return game.settings.get("${MODULE_ID}", "quickRolls");` });
    const quick0 = (await quick())?.result !== false;
    ctx.restore(() => quick(quick0).catch(() => {}));
    const dialog = (args={}) => ctx.call("run-script", { code: `const opts = ${JSON.stringify(args)};\n${DIALOG}` }).then(r => r?.result ?? { open: false });
    ctx.restore(async () => { for ( let i = 0; (i < 4) && (await dialog()).open; i++ ) await dialog({ press: "normal" }).catch(() => {}); });
    await quick(true);

    /**
     * Casts until it hits (eight tries). `act(win)` answers the dialog when it opens. Returns the dialog seen (or null), the number of
     * damage cards when it opened, the final resolution, the damage card and the HP after.
     */
    const shoot = async act => {
      for ( let i = 0; i < 8; i++ ) {
        await ctx.setHp(zombi, hp0);
        const since = await ctx.lastMessageId();
        const used = await ctx.use({ tokenId: sorc.id, identifier: "fire-bolt", activityType: "attack", targetTokenIds: [zombi.id] });
        let seen = null, r = null;
        for ( const stop = Date.now() + 40000; Date.now() < stop; await pause(300) ) {
          r = await ctx.resolution(used.usageMessageId);
          if ( r && TERMINAL.has(r.step) ) break;
          if ( seen ) continue;
          const win = await dialog();
          if ( !win.open ) continue;
          await pause(1000);   // time for a wrongly chained roll to arrive
          seen = { ...win, cardsAtOpen: (await ctx.messagesSince(since)).filter(m => m.type === "damage").length };
          await act();
        }
        if ( !r?.targets?.[0]?.hit ) continue;
        await pause(1500);
        const cards = (await ctx.messagesSince(since)).filter(m => m.type === "damage");
        return { r, seen, cards, hpAfter: await ctx.hp(zombi), natural20: r.targets[0].critical === true };
      }
      return null;
    };
    const total = card => (card?.rolls ?? []).reduce((t, x) => t + Math.max(0, Number(x.total) || 0), 0);
    const formulas = card => (card?.rolls ?? []).map(x => x.formula).join(" + ");
    const critical = card => (card?.rolls ?? []).some(x => x.options?.isCritical === true);
    // The card's total taken off the HP — or the Zombie left at 0 or 1 (Undead Fortitude) when the total is at least its HP.
    const applied = (card, hp) => (hp === hp0 - total(card)) || ((total(card) >= hp0) && (hp <= 1));

    // 1. On click: bonus +7 and Critical Hit pressed.
    await mode("click");
    let shot = await shoot(() => dialog({ situational: "7", press: "critical" }));
    if ( ctx.expect(!!shot, "click: Fire Bolt hits (eight tries at most)") ) {
      ctx.expect(shot.seen?.open && (shot.seen.mode === "required"), `click: dnd5e's damage dialog opens for the author (${JSON.stringify(shot.seen)})`);
      ctx.expect(shot.seen?.situational && shot.seen?.buttons?.includes("critical") && shot.seen?.buttons?.includes("normal"),
        `click: it has the situational bonus field and the Critical Hit / Normal buttons (${shot.seen?.buttons?.join("/")})`);
      ctx.expect(!!shot.seen?.countdown, `click: it shows the combat window countdown (§557: ${shot.seen?.countdown})`);
      ctx.expect(shot.seen?.cardsAtOpen === 0, `click: no damage roll while it is open (${shot.seen?.cardsAtOpen})`);
      ctx.expect(shot.cards.length === 1, `click: one damage card (${shot.cards.length})`);
      ctx.expect(/\b7\b/.test(formulas(shot.cards[0])), `click: the +7 is in the roll (${formulas(shot.cards[0])})`);
      ctx.expect(critical(shot.cards[0]), `click: Critical Hit pressed — the roll is critical${shot.natural20 ? " (it was a natural 20 anyway)" : ", without a natural 20"} (${formulas(shot.cards[0])})`);
      ctx.expect((shot.r.step === "done") && applied(shot.cards[0], shot.hpAfter),
        `click: the GM applies the card's total (${hp0} − ${total(shot.cards[0])} → ${shot.hpAfter})`);
    }

    // 2. On click, the dialog closed without a button: the roll still goes.
    shot = await shoot(() => dialog({ close: true }));
    if ( ctx.expect(!!shot, "click, closed: Fire Bolt hits") ) {
      ctx.expect(shot.seen?.open, "click, closed: the dialog opened");
      ctx.expect((shot.cards.length === 1) && (shot.r.step === "done") && applied(shot.cards[0], shot.hpAfter),
        `click, closed: the roll still goes and is applied (${shot.cards.length} card, ${shot.r.step}, ${hp0} → ${shot.hpAfter})`);
      ctx.expect(critical(shot.cards[0]) === shot.natural20, `click, closed: critical only on a natural 20 (${critical(shot.cards[0])} / ${shot.natural20})`);
    }

    // 3. Automatic, this client asks for the dialog.
    await mode("auto");
    await quick(false);
    shot = await shoot(() => dialog({ press: "normal" }));
    if ( ctx.expect(!!shot, "auto, dialog wanted: Fire Bolt hits") ) {
      ctx.expect(shot.seen?.open && (shot.seen.mode === "offered"), `auto, "Rolls without dialog" off: the dialog is offered (${JSON.stringify(shot.seen)})`);
      ctx.expect((shot.cards.length === 1) && !critical(shot.cards[0]) && applied(shot.cards[0], shot.hpAfter),
        `auto, dialog wanted: Normal pressed, one normal roll applied (${formulas(shot.cards[0])}, ${hp0} → ${shot.hpAfter})`);
    }

    // 4. Automatic, the default: no dialog.
    await quick(true);
    shot = await shoot(() => dialog({ press: "normal" }));
    if ( ctx.expect(!!shot, "auto: Fire Bolt hits") ) {
      ctx.expect(!shot.seen && (shot.cards.length === 1) && (shot.hpAfter < hp0 || total(shot.cards[0]) === 0),
        `auto, "Rolls without dialog" on: no dialog, the roll is chained and applied (${JSON.stringify(shot.seen)}, ${hp0} → ${shot.hpAfter})`);
    }
  }
};
