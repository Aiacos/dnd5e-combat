/**
 * Inline journal checks open the engine's requested roll (§536, world setting `inlineChecksEngine`). « Arène des refus »,
 * real player client (« claude player », owner of the Mage des refus, opened by the test bench: `players: true`).
 * A temporary journal holds `[[/check wis prc 11]]`, `[[/save dex 14]]` and `[[/concentration]]`; its links are clicked
 * like a mouse click.
 *  1. Setting off (GM, Mage controlled): dnd5e's roll dialog opens, not the engine's request window.
 *  2. Setting on (GM): the request window opens filled — Perception, Wisdom, DC 11, the Mage ticked — and no dnd5e dialog.
 *  3. Setting on (GM), the save link: the window says Dexterity save, DC 14.
 *  4. Setting on (GM), the concentration link: left to dnd5e (its dialog, no request window).
 *  5. Setting on (player): the request card for the Mage, DC 11 shown, posted by the player; the GM rolls for him from the card
 *     (« Roll for them »), the roll is linked to its line and judged against 11, and the player's window closes.
 * Restored: the setting, the journal, the card, the windows, the control.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

/** On the GM client: the dnd5e roll dialogs and the engine's request window, open now. */
const WINDOWS = `
  const all = [...foundry.applications.instances.values()];
  const dialogs = all.filter(a => a.constructor?.name?.includes("RollConfigurationDialog") && a.rendered).map(a => a.id);
  const request = foundry.applications.instances.get("das-group-roll");
  return { dialogs, request: request?.rendered ? { values: request.values, chosen: [...request.chosen], ability: request.ability } : null };`;

/** Closes them. */
const CLOSE = `
  for ( const a of [...foundry.applications.instances.values()] ) {
    if ( a.constructor?.name?.includes("RollConfigurationDialog") || (a.id === "das-group-roll") ) await a.close().catch(() => {});
  }
  return true;`;

/** Clicks the n-th dnd5e roll link of the journal's sheet (rendered first), on whichever client runs it, like a mouse click. */
const CLICK = `
  const entry = game.journal.get(args.journal);
  if ( !entry.sheet.rendered ) { await entry.sheet.render({ force: true }); await new Promise(r => setTimeout(r, 1500)); }
  const links = [...entry.sheet.element.querySelectorAll('[data-action="roll"]')].filter(l => l.closest(".roll-link-group"));
  const link = links[args.n];
  if ( !link ) return { error: "link " + args.n + " not found among " + links.length };
  if ( args.token ) canvas.tokens.get(args.token)?.control({ releaseOthers: true });
  link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return { clicked: link.textContent.trim(), type: link.closest(".roll-link-group")?.dataset.type ?? null };`;

export default {
  name: "inline journal checks → engine's requested roll (§536)",
  scene: "Arène des refus",
  players: true,

  async run(ctx) {
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result;
    const mage = await ctx.token("Mage des refus");
    const { data: mtok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const mageUuid = `Actor.${mtok.actorId}`;

    const previous = await script(`return game.settings.get("${MODULE_ID}", "inlineChecksEngine");`);
    const setSetting = value => script(`await game.settings.set("${MODULE_ID}", "inlineChecksEngine", args.value); return true;`, { value });
    ctx.restore(() => setSetting(!!previous).catch(() => {}));
    const journal = await script(`
      const entry = await JournalEntry.implementation.create({ name: "DAS test — inline checks",
        ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
        pages: [{ name: "Checks", type: "text", text: { content: "<p>[[/check wis prc 11]]</p><p>[[/save dex 14]]</p><p>[[/concentration]]</p>" } }] });
      return entry.id;`);
    if ( !ctx.expect(!!journal, `temporary journal created (${journal})`) ) return;
    ctx.restore(() => script(`await game.journal.get(args.id)?.sheet?.close(); await game.journal.get(args.id)?.delete(); return true;`, { id: journal }).catch(() => {}));
    ctx.restore(() => script(CLOSE).catch(() => {}));
    ctx.restore(() => script(`canvas.tokens.releaseAll(); return true;`).catch(() => {}));

    const gmClick = async n => {
      await script(CLOSE);
      const clicked = await script(CLICK, { journal, n, token: mage.id });
      await pause(1500);
      const open = await script(WINDOWS);
      ctx.log(`GM click ${n}: ${JSON.stringify(clicked)} → ${JSON.stringify(open)}`);
      return { clicked, open };
    };

    // 1. Off: dnd5e's dialog.
    await setSetting(false);
    const off = await gmClick(0);
    ctx.expect(!off.clicked?.error, `the Perception link is clicked (${off.clicked?.clicked ?? off.clicked?.error})`);
    ctx.expect((off.open.dialogs.length > 0) && !off.open.request, "setting off: dnd5e's roll dialog, no request window");

    // 2. On: the engine's request window, filled from the link.
    await setSetting(true);
    const on = await gmClick(0);
    const v = on.open.request?.values ?? {};
    ctx.expect(!on.open.dialogs.length && !!on.open.request, "setting on: the request window, no dnd5e dialog");
    ctx.expect((v.type === "skill") && (v.key === "prc") && (Number(v.dc) === 11), `Perception, DC 11: ${JSON.stringify(v)}`);
    ctx.expect(on.open.request?.chosen?.includes(mageUuid), `the controlled Mage is ticked: ${JSON.stringify(on.open.request?.chosen)}`);

    // 3. The save link.
    const save = await gmClick(1);
    const sv = save.open.request?.values ?? {};
    ctx.expect((sv.type === "save") && (sv.key === "dex") && (Number(sv.dc) === 14) && !save.open.dialogs.length,
      `Dexterity save, DC 14: ${JSON.stringify(sv)}`);

    // 4. Concentration stays dnd5e's.
    const conc = await gmClick(2);
    ctx.expect(!conc.open.request && (conc.open.dialogs.length > 0), "concentration link: dnd5e's dialog, no request window");
    await script(CLOSE);
    await script(`await game.journal.get(args.id)?.sheet?.close(); canvas.tokens.releaseAll(); return true;`, { id: journal });

    // 5. Player side.
    const who = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) { await scene.view(); await new Promise(r => setTimeout(r, 4000)); }
      const actor = await fromUuid(args.mage);
      return { gm: game.user.isGM, owner: !!actor?.isOwner, activeGM: !!game.users.activeGM,
        on: game.settings.get("${MODULE_ID}", "inlineChecksEngine") };`,
      { scene: (await ctx.scene()).sceneId, mage: mageUuid });
    ctx.log(`player client: ${JSON.stringify(who)}`);
    if ( !ctx.expect(!who.gm && who.owner && who.activeGM && who.on, "a player client owning the Mage, an active GM, the setting seen on") ) return;
    // The roll window of the requested roll is offered through `dnd5e-combat.groupRollPrompt` (a neighbour's window, else dnd5e's).
    await ctx.asPlayer(`window.__dasPrompt = null;
      Hooks.once("${MODULE_ID}.groupRollPrompt", prompt => { window.__dasPrompt = { title: prompt.title, actor: prompt.actor?.name, dc: prompt.request?.dc }; });
      return true;`);
    const since = await ctx.lastMessageId();
    const clicked = await ctx.asPlayer(CLICK, { journal, n: 0, token: mage.id });
    ctx.log(`player click: ${JSON.stringify(clicked)}`);
    let card = null;
    for ( const stop = Date.now() + 10000; !card && (Date.now() < stop); await pause(500) ) {
      card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.groupRoll) ?? null;
    }
    const request = card?.flags?.[MODULE_ID]?.groupRoll;
    ctx.expect(!!card && (request?.type === "skill") && (request?.key === "prc") && (request?.dc === 11) && !request?.hideDc,
      `the player's request card: ${JSON.stringify(request)}`);
    if ( !card ) return;
    const cardId = card.id ?? card._id;
    ctx.restore(() => script(`await game.messages.get(args.id)?.delete(); return true;`, { id: cardId }).catch(() => {}));
    const first = await ctx.engine("groupRollState", { id: cardId });
    ctx.expect((first?.entries?.length === 1) && (first.entries[0].name === "Mage des refus") && (first.entries[0].status === "waiting"),
      `the Mage has the only line of the card, waiting for his roll: ${JSON.stringify(first?.entries)}`);
    await pause(1500);
    const prompted = await ctx.asPlayer(`return window.__dasPrompt;`);
    ctx.expect((prompted?.actor === "Mage des refus") && (prompted?.dc === 11),
      `the requested roll's window is offered on the player's screen: ${JSON.stringify(prompted)}`);
    const forced = await ctx.engine("groupRollForce", { id: cardId, tokenId: mage.id });
    let view = null;
    for ( const stop = Date.now() + 15000; Date.now() < stop; await pause(500) ) {
      view = await ctx.engine("groupRollState", { id: cardId });
      if ( view?.done ) break;
    }
    const line = view?.entries?.[0];
    ctx.expect(forced && view?.done && Number.isFinite(line?.total) && (line.success === (line.total >= 11)),
      `rolled for him, linked and judged against 11: ${JSON.stringify(line)}`);
    await pause(1500);
    const left = await ctx.asPlayer(`return [...foundry.applications.instances.values()].filter(a => a.rendered
      && a.constructor?.name?.includes("RollConfigurationDialog")).length;`);
    ctx.expect(left === 0, `no dnd5e roll dialog left open on the player's screen (${left})`);
    await ctx.asPlayer(`await game.journal.get(args.id)?.sheet?.close(); return true;`, { id: journal }).catch(() => {});
  }
};
