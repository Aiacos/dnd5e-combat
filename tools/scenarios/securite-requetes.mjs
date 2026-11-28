/**
 * Requests between clients (§471): from a REAL player client ("claude player", opened by the test bench: `players: true`),
 * requests that the engine would never send are addressed to the active GM, as a player could type them in his console. The GM
 * does only what that player is entitled to ask:
 *  1. `choice` whose question carries an `<img onerror>`: the window opens and answers (the channel works), the code does not run
 *     on the GM's side (the window's text is read in an inert document);
 *  2. `cure` without a use card, on an NPC the player does not own: refused, HP unchanged;
 *  3. `reaction` with `auto: true` and a `drop` targeting a journal: `auto` is dropped (the window is placed on the GM's
 *     side, it is not answered automatically) and the journal is still there.
 * Outside the bench (no player client), not applicable. Put back: the Zombie's HP, journal, windows.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const MARKER = "__dasChoixInerte";

export default {
  name: "requêtes d'un joueur au MJ — seulement ce qu'il a le droit de demander (§471)",
  players: true,

  async run(ctx) {
    const { sceneId, tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Zombi") ) { ctx.log("Zombi absent : non applicable"); return; }
    const zombie = await ctx.token("Zombi");
    const tokenUuid = `Scene.${sceneId}.Token.${zombie.id}`;

    // Does the player see the Zombie, and not own it? Does an active GM answer?
    const seen = await ctx.asPlayer(`
      const t = await fromUuid(args.token);
      return { user: game.user.name, gm: game.user.isGM, activeGM: game.users.activeGM?.name ?? null,
        actor: t?.actor?.uuid ?? null, owner: !!t?.actor?.isOwner };`, { token: tokenUuid });
    ctx.log(`client joueur : ${JSON.stringify(seen)}`);
    if ( !ctx.expect(!seen.gm && seen.activeGM && seen.actor, `un client joueur (${seen.user}) avec un MJ actif (${seen.activeGM}), qui lit le Zombi`) ) return;
    if ( seen.owner ) { ctx.log(`${seen.user} possède le Zombi : non applicable`); return; }
    const send = (name, data, timeout=30000) => ctx.asPlayer(`
      try { return { answer: await game.users.activeGM.query(args.name, args.data, { timeout: args.timeout }) ?? null }; }
      catch(err) { return { error: String(err?.message ?? err) }; }`, { name, data, timeout });
    const windows = async () => (await ctx.engine("windows")).map(w => w.id);

    // 1. A question whose text carries code: the window answers by itself after 2 s; the marker must not appear.
    await ctx.call("run-script", { code: `delete window.${MARKER}; return true;` });
    ctx.restore(() => ctx.call("run-script", { code: `delete window.${MARKER}; return true;` }).catch(() => {}));
    const choice = await send("dnd5e-combat.choice", {
      actor: seen.actor, item: "Test", seconds: 2, options: [{ id: "a", label: "A" }],
      prompt: `<img src="data:image/png;base64,AA==" onerror="window.${MARKER} = true">Question`
    });
    await pause(1000);
    const marker = (await ctx.call("run-script", { code: `return { marker: window.${MARKER} ?? null };` }))?.result?.marker ?? null;
    ctx.expect(choice.answer?.id === "a", `choice : le MJ répond au joueur (${JSON.stringify(choice)})`);
    ctx.expect(marker === null, `choice : le code de la question ne s'exécute pas chez le MJ (marqueur ${JSON.stringify(marker)})`);

    // 2. A "heal" that wounds, without a use card.
    const hp0 = await ctx.hp(zombie);
    ctx.restore(() => ctx.setHp(zombie, hp0));
    const cure = await send("dnd5e-combat.cure", { target: tokenUuid, status: "hp", value: 1 });
    await pause(500);
    const hp1 = await ctx.hp(zombie);
    ctx.expect(!cure.answer, `cure : refusée (${JSON.stringify(cure)})`);
    ctx.expect(hp1 === hp0, `cure : PV du Zombi inchangés (${hp0} → ${hp1})`);

    // 3. A Reaction "answered automatically" that would delete a journal.
    const made = (await ctx.call("run-script", { code: `
      const j = await JournalEntry.create({ name: "Scénario — journal témoin", ownership: { default: 0 } });
      return { id: j.id, uuid: j.uuid };` }))?.result;
    if ( !ctx.expect(made?.uuid, `journal témoin créé (${made?.uuid})`) ) return;
    ctx.restore(() => ctx.call("run-script", { code: `await game.journal.get("${made.id}")?.delete(); return true;` }).catch(() => {}));
    // A real activity of the Zombie itself: without an activity, the former handler stopped before `drop` and the test
    // proved nothing.
    const activity = (await ctx.call("run-script", { code: `
      const a = (await fromUuid("${seen.actor}"))?.items.contents.flatMap(i => [...(i.system.activities ?? [])])[0];
      return { uuid: a?.uuid ?? null };` }))?.result?.uuid ?? null;
    if ( !ctx.expect(activity, `une activité du Zombi pour la réaction (${activity})`) ) return;
    const before = new Set(await windows());
    const pending = send("dnd5e-combat.reaction", {
      actor: seen.actor, prompt: { key: "ReactionTitre", data: { name: "Test" } }, target: null, auto: true,
      options: [{ name: "Test", activity, drop: [made.uuid] }]
    });
    // The window placed on the GM's side (`auto` dropped): closed without answering, like a GM who does not react.
    let posed = [];
    for ( let i = 0; (i < 20) && !posed.length; i++ ) { await pause(250); posed = (await windows()).filter(id => !before.has(id)); }
    for ( const id of posed ) await ctx.engine("closeWindow", { id }).catch(() => {});
    const reaction = await pending;
    await pause(500);
    const still = (await ctx.call("run-script", { code: `return { here: !!game.journal.get("${made.id}") };` }))?.result?.here;
    ctx.expect(posed.length > 0, `reaction : « auto » refusé, la fenêtre est posée chez le MJ (${posed.length} fenêtre(s))`);
    ctx.expect(!reaction.answer, `reaction : aucune réaction jouée (${JSON.stringify(reaction)})`);
    ctx.expect(still === true, "reaction : le journal témoin est toujours là");
  }
};
