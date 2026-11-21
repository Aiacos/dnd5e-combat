/**
 * Issue #178 : réglage de monde « Dérogations visibles par » (`overrideVisibility`), vu d'un VRAI client joueur (« claude player »,
 * ouvert par le banc : `players: true`), dans l'« Arène des refus » (`node tools/arene-refus.mjs`). Le MJ force Rayon de givre du Mage des
 * refus hors de portée (la Cible lointaine), dans chacun des trois modes :
 *  - `all` (défaut) : le joueur reçoit le texte flottant « Forcé » et voit le bandeau « Règle passée outre » sur la carte ;
 *  - `hideGM` et `gmOnly` : le joueur ne reçoit ni le texte ni le bandeau ; le MJ voit toujours le bandeau.
 * Puis une carte marquée dont l'auteur est un joueur (créée par le MJ au nom d'un autre joueur, faute d'un second client) :
 *  - `hideGM` : le joueur la voit marquée (dérogation d'un joueur, publique) ; `gmOnly` : non ;
 *  - celle que le joueur crée lui-même : il voit toujours sa propre marque.
 * La même portée signalée n'est pas redemandée pendant une minute (runtime/turn.mjs, `ACK_LIFETIME`) : chaque coup forcé attend 61 s
 * après le précédent, et le scénario attend la fin de cette minute avant de rendre la main (le suivant, `regle-forcee`, lance le même sort).
 * Non couvert ici : le texte flottant d'une dérogation forcée par un joueur (la fenêtre s'ouvre chez lui). Remis en état : le réglage, les
 * cartes créées, l'écouteur du joueur.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "règle forcée discrète — dérogations visibles par toute la table, pas celles du MJ, MJ seulement (issue #178)",
  scene: "Arène des refus",
  players: true,

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const far = await ctx.token("Cible lointaine des refus");
    const ray = await ctx.itemId(mage.id, "ray-of-frost");

    const who = await ctx.asPlayer(`return { id: game.user.id, gm: game.user.isGM, activeGM: !!game.users.activeGM };`);
    if ( !ctx.expect(!who.gm && who.activeGM, `un client joueur avec un MJ actif (${JSON.stringify(who)})`) ) return;

    const setMode = value => ctx.call("set-setting", { namespace: MODULE_ID, key: "overrideVisibility", value });
    ctx.restore(() => setMode("all").catch(() => {}));
    const created = [];
    ctx.restore(() => ctx.call("run-script", { code: `await ChatMessage.deleteDocuments(args.ids.filter(id => game.messages.has(id))); return true;`,
      args: { ids: created } }).catch(() => {}));

    // L'écouteur du joueur : les textes flottants « forced » reçus.
    await ctx.asPlayer(`
      window.__dasForced = [];
      if ( !window.__dasForcedHook ) window.__dasForcedHook = Hooks.on("${MODULE_ID}.notice", d => { if ( d?.kind === "forced" ) window.__dasForced.push(d.token); });
      return true;`);
    ctx.restore(() => ctx.asPlayer(`if ( window.__dasForcedHook ) Hooks.off("${MODULE_ID}.notice", window.__dasForcedHook);
      delete window.__dasForcedHook; delete window.__dasForced; return true;`).catch(() => {}));

    const banner = `const m = game.messages.get(args.id); if ( !m ) return null;
      const html = await m.renderHTML(); return !!html.querySelector(".das-overridden");`;
    const playerSees = async id => (await ctx.asPlayer(banner, { id }));
    const gmSees = async id => (await ctx.call("run-script", { code: banner, args: { id } }))?.result;

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
    /** Le MJ force Rayon de givre hors de portée ; rend la carte d'utilisation marquée et les textes « Forcé » reçus par le joueur. */
    let lastForce = 0;
    const waitMemory = async () => { const left = lastForce + 61000 - Date.now(); if ( left > 0 ) await pause(left); };
    ctx.restore(waitMemory);
    const force = async () => {
      await waitMemory();
      await ctx.asPlayer(`window.__dasForced = []; return true;`);
      const since = await ctx.lastMessageId();
      await ctx.call("use-activity", { tokenId: mage.id, itemId: ray, activityType: "attack", configure: false,
        targetTokenIds: [far.id], usageConfig: { [MODULE_ID]: { autoReact: "none" } } });
      const d = await legality();
      if ( !d ) return null;
      await ctx.call("answer-dialog", { id: d.id, button: "go" });
      lastForce = Date.now();
      await pause(3000);
      const card = (await ctx.messagesSince(since)).find(m => (m.type === "usage") && m.flags?.[MODULE_ID]?.overridden?.length);
      const notices = await ctx.asPlayer(`return (window.__dasForced ?? []).length;`);
      return { card, notices };
    };

    for ( const [mode, open] of [["all", true], ["hideGM", false], ["gmOnly", false]] ) {
      await setMode(mode);
      const r = await force();
      if ( !ctx.expect(!!r?.card, `${mode} : le MJ force, la carte d'utilisation est marquée`) ) continue;
      const id = r.card.id ?? r.card._id;
      ctx.expect((r.notices > 0) === open, `${mode} : texte « Forcé » ${open ? "reçu" : "pas reçu"} par le joueur (${r.notices})`);
      ctx.expect((await playerSees(id)) === open, `${mode} : bandeau ${open ? "montré" : "caché"} au joueur`);
      ctx.expect((await gmSees(id)) === true, `${mode} : bandeau toujours montré au MJ`);
    }

    // Cartes marquées dont l'auteur est un joueur.
    const other = (await ctx.call("run-script", { code: `return game.users.find(u => !u.isGM && (u.id !== args.me))?.id ?? null;`,
      args: { me: who.id } }))?.result ?? null;
    const markedBy = async author => {
      const r = await ctx.call("run-script", { code: `const m = await ChatMessage.create({ author: args.author, content: "<p>Test #178</p>",
        flags: { "${MODULE_ID}": { overridden: ["Test #178"] } } }); return m.id;`, args: { author } });
      if ( r?.result ) created.push(r.result);
      return r?.result ?? null;
    };
    if ( other ) {
      const id = await markedBy(other);
      await setMode("hideGM");
      ctx.expect((await playerSees(id)) === true, "hideGM : la dérogation d'un autre joueur reste montrée");
      await setMode("gmOnly");
      ctx.expect((await playerSees(id)) === false, "gmOnly : la dérogation d'un autre joueur est cachée");
    }
    else ctx.log("aucun autre joueur dans le monde : la carte d'un autre joueur n'est pas vérifiée");
    const own = await ctx.asPlayer(`const m = await ChatMessage.create({ content: "<p>Test #178 (joueur)</p>",
      flags: { "${MODULE_ID}": { overridden: ["Test #178"] } } }); return m.id;`);
    if ( own ) created.push(own);
    await setMode("gmOnly");
    ctx.expect((await playerSees(own)) === true, "gmOnly : le joueur voit sa propre marque");
    ctx.expect((await gmSees(own)) === true, "gmOnly : le MJ voit la marque du joueur");
    await setMode("all");

    const errors = await ctx.clientErrors();
    ctx.expect(!errors.length, `aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(x => x.message ?? x.text).join(" | ").slice(0, 300)}` : ""}`);
  }
};
