/**
 * §524 (issue #173): "Damage and healing" setting on "Rolled on click for players, automatic for the GM's creatures"
 * (`clickPlayers`). "Refusal Arena" (`node tools/arene-refus.mjs`), real player client ("claude player", owner of the Refusal
 * Mage, opened by the bench: `players: true`). Checks:
 *  1. the GM uses the Mage's weapon against the Dummy: no damage window, the roll chains and is applied;
 *  2. the player makes the same attack: on their side, the dnd5e damage window; no roll while it is open; once clicked,
 *     their damage card goes off and the GM applies it.
 * A hit can miss (twelve tries at most, Dummy AC 15). Restored: the setting, the Dummy's HP, the windows left open.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "dégâts au clic pour les joueurs, d'office pour les créatures du MJ (#173)",
  scene: "Arène des refus",
  players: true,

  async run(ctx) {
    const { sceneId } = await ctx.scene();
    const mage = await ctx.token("Mage des refus");
    const dummy = await ctx.token("Mannequin des refus");
    const hp0 = await ctx.hp(dummy);
    ctx.restore(() => ctx.setHp(dummy, hp0));
    const { data: mtok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    const weapon = ((await ctx.call("get-actor", { actorId: mtok.actorId })).items ?? []).find(i => (i.type === "weapon")
      && i.system?.equipped && Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( !ctx.expect(!!weapon, `le Mage a une arme équipée (${weapon?.name})`) ) return;
    const weaponUuid = `Actor.${mtok.actorId}.Item.${weapon._id}`;

    const before = (await ctx.engine("setting", { key: "damageFlow" }))?.now ?? "level";
    ctx.restore(() => ctx.engine("setting", { key: "damageFlow", value: before }));
    const set = await ctx.engine("setting", { key: "damageFlow", value: "clickPlayers" });
    ctx.log(`réglage chez le MJ : ${JSON.stringify(set)}`);
    // Success at a Cost holds a near miss for the GM (20 s, `successAtCostHold`), as long as this scenario waits for the player's
    // window: a miss by 1 or 2 then read as "no window". Off for the scenario, a miss is a miss.
    const atCost = (await ctx.engine("setting", { key: "successAtCost" }))?.now ?? false;
    ctx.restore(() => ctx.engine("setting", { key: "successAtCost", value: atCost }));
    await ctx.engine("setting", { key: "successAtCost", value: false });
    await pause(1500);

    const who = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) { await scene.view(); await new Promise(r => setTimeout(r, 4000)); }
      const item = await fromUuid(args.weapon);
      return { user: game.user.name, gm: game.user.isGM, owner: !!item?.isOwner, active: !!game.modules.get("${MODULE_ID}")?.api?.active,
        flow: game.settings.get("${MODULE_ID}", "damageFlow"),
        stored: game.settings.storage.get("world")?.find?.(s => s.key === "${MODULE_ID}.damageFlow")?.value ?? null,
        choices: Object.keys(game.settings.settings.get("${MODULE_ID}.damageFlow")?.choices ?? {}),
        version: game.modules.get("${MODULE_ID}")?.version };`, { scene: sceneId, weapon: weaponUuid });
    ctx.log(`client joueur : ${JSON.stringify(who)}`);
    if ( !ctx.expect(!who.gm && who.owner && who.active && (who.flow === "clickPlayers"), "un client joueur propriétaire du Mage, réglage lu « clickPlayers »") ) return;

    await ctx.asPlayer(`window.__dasJournal = []; if ( !window.__dasEcoute2 ) { window.__dasEcoute2 = true;
      const keep = (kind, args) => window.__dasJournal.push(kind + " " + args.map(a => String(a?.stack ?? a)).join(" ").slice(0, 300));
      for ( const k of ["log", "warn", "error"] ) { const o = console[k].bind(console); console[k] = (...a) => { if ( k !== "log" || /dnd5e-combat/.test(String(a[0])) ) keep(k, a); o(...a); }; }
      window.addEventListener("error", e => keep("uncaught", [e.message]));
      window.addEventListener("unhandledrejection", e => keep("rejection", [e.reason])); } return true;`);
    const playerJournal = () => ctx.asPlayer(`return (window.__dasJournal ?? []).slice(-25);`);
    /** The dnd5e damage window on the player's side (§556): `{ open }`, and `click: true` confirms it. */
    const playerRollWindow = (click=false) => ctx.asPlayer(`
      const app = [...foundry.applications.instances.values()].find(a => a.rendered && a.config?.["${MODULE_ID}"]?.dialog);
      if ( !app ) return { open: false, apps: [...foundry.applications.instances.values()].filter(a => a.rendered)
        .map(a => a.constructor.name + ":" + (a.title ?? "")) };
      if ( args.click ) app.element.querySelector('button[data-action="normal"]')?.click();
      return { open: true, title: app.title ?? app.options?.window?.title ?? null };`, { click });
    ctx.restore(() => playerRollWindow(true).catch(() => {}));
    /** The engine's damage windows on the GM's side (§556: the dnd5e one). */
    const gmRollWindows = async () => ((await ctx.call("run-script", { code: `return [...foundry.applications.instances.values()]
      .filter(a => a.rendered && a.config?.["${MODULE_ID}"]?.dialog).map(a => a.id);` }).catch(() => null))?.result ?? []);
    const damageCards = msgs => msgs.filter(m => m.type === "damage");
    // The Mage's staff (1d6 − 1) may do nothing: HP are compared with the damage card's total.
    const rolledOf = card => (card?.rolls ?? []).reduce((t, x) => t + Math.max(0, Number(x.total) || 0), 0);

    // 1. The GM: chained roll, no window.
    let gmDone = false;
    for ( let i = 1; (i <= 12) && !gmDone; i++ ) {
      await ctx.setHp(dummy, hp0);
      const since = await ctx.lastMessageId();
      const u = await ctx.use({ tokenId: mage.id, itemId: weapon._id, targetTokenIds: [dummy.id], activityType: "attack", usageConfig: { [MODULE_ID]: { cost: "free" } } });
      const r = u.usageMessageId ? await ctx.settle(u.usageMessageId, { timeoutMs: 30000 }).catch(() => null) : null;
      if ( !r?.targets?.find(x => x.name === dummy.name)?.hit ) continue;
      gmDone = true;
      await pause(1500);
      const windows = await gmRollWindows();
      const cards = damageCards(await ctx.messagesSince(since));
      ctx.expect(!windows.length, `MJ : aucune fenêtre de dégâts (${windows.length})`);
      ctx.expect((r.step === "done") && (cards.length === 1), `MJ : le jet s'enchaîne, résolution terminée (${r.step}, ${cards.length} carte(s) de dégâts)`);
      ctx.expect((await ctx.hp(dummy)) === hp0 - rolledOf(cards[0]), `MJ : dégâts appliqués (${hp0} − ${rolledOf(cards[0])} → ${await ctx.hp(dummy)})`);
    }
    ctx.expect(gmDone, "MJ : un coup touche (douze essais au plus)");

    // 2. The player: their window, nothing before the click, then the roll applied.
    let playerDone = false;
    for ( let i = 1; (i <= 12) && !playerDone; i++ ) {
      await ctx.setHp(dummy, hp0);
      const since = await ctx.lastMessageId();
      const used = await ctx.asPlayer(`
        try {
          canvas.tokens.get(args.dummy)?.setTarget(true, { releaseOthers: true });
          const item = await fromUuid(args.item);
          const activity = item.system.activities.find(a => a.type === "attack");
          await activity.use({ "${MODULE_ID}": { confirmed: true, autoReact: "none", cost: "free" } }, { configure: false }, {});
          return { ok: true };
        } catch(err) { return { error: String(err?.stack ?? err).slice(0, 600) }; }`, { item: weaponUuid, dummy: dummy.id });
      if ( used?.error ) { ctx.expect(false, `joueur : erreur (${used.error})`); return; }
      // The hit is resolved: miss → we start again; hit → the player's window opens.
      let res = null, win = { open: false };
      for ( const stop = Date.now() + 20000; Date.now() < stop; await pause(500) ) {
        res = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.resolution).filter(Boolean).pop() ?? null;
        if ( res?.step === "missed" ) break;
        win = await playerRollWindow(false);
        if ( win.open ) break;
      }
      if ( res?.step === "missed" ) { await pause(1000); continue; }
      playerDone = true;
      if ( !win.open ) ctx.log(`journal du joueur : ${JSON.stringify(await playerJournal())}`);
      ctx.expect(win.open, `joueur : la fenêtre de dégâts de dnd5e s'ouvre chez lui (${win.title ?? JSON.stringify(win.apps)}, étape ${res?.step})`);
      ctx.expect(!damageCards(await ctx.messagesSince(since)).length, "joueur : aucun jet de dégâts tant qu'elle est ouverte");
      await playerRollWindow(true);
      let cards = [];
      for ( const stop = Date.now() + 20000; (Date.now() < stop) && !cards.length; await pause(500) ) cards = damageCards(await ctx.messagesSince(since));
      await pause(1500);
      ctx.expect(cards.length === 1 && cards[0].author === who.user, `joueur : cliquée, sa carte de dégâts part (${cards.length}, ${cards[0]?.author})`);
      ctx.expect((await ctx.hp(dummy)) === hp0 - rolledOf(cards[0]), `joueur : le MJ applique ses dégâts (${hp0} − ${rolledOf(cards[0])} → ${await ctx.hp(dummy)})`);
    }
    ctx.expect(playerDone, "joueur : un coup touche (douze essais au plus)");
  }
};
