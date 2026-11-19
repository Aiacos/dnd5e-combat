/**
 * Requêtes entre clients (§471) : depuis un VRAI client joueur (« claude player », ouvert par le banc de test : `players: true`), des
 * requêtes que le moteur n'enverrait jamais sont adressées au MJ actif, comme un joueur pourrait les taper dans sa console. Le MJ n'en
 * fait que ce que ce joueur a le droit de demander :
 *  1. `choice` dont la question porte un `<img onerror>` : la fenêtre s'ouvre et répond (le canal marche), le code ne s'exécute pas
 *     chez le MJ (le texte de la fenêtre est lu dans un document inerte) ;
 *  2. `cure` sans carte d'utilisation, sur un PNJ que le joueur ne possède pas : refusée, PV inchangés ;
 *  3. `reaction` avec `auto: true` et un `drop` visant un journal : `auto` tombe (la fenêtre est posée chez le MJ, elle n'est pas
 *     répondue d'office) et le journal est toujours là.
 * Hors du banc (aucun client joueur), non applicable. Remis en état : PV du Zombi, journal, fenêtres.
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

    // Le joueur voit-il le Zombi, et n'en est-il pas propriétaire ? Un MJ actif répond-il ?
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

    // 1. Une question dont le texte porte du code : la fenêtre répond seule au bout de 2 s ; le marqueur ne doit pas apparaître.
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

    // 2. Un « soin » qui blesse, sans carte d'utilisation.
    const hp0 = await ctx.hp(zombie);
    ctx.restore(() => ctx.setHp(zombie, hp0));
    const cure = await send("dnd5e-combat.cure", { target: tokenUuid, status: "hp", value: 1 });
    await pause(500);
    const hp1 = await ctx.hp(zombie);
    ctx.expect(!cure.answer, `cure : refusée (${JSON.stringify(cure)})`);
    ctx.expect(hp1 === hp0, `cure : PV du Zombi inchangés (${hp0} → ${hp1})`);

    // 3. Une réaction « répondue d'office » qui supprimerait un journal.
    const made = (await ctx.call("run-script", { code: `
      const j = await JournalEntry.create({ name: "Scénario — journal témoin", ownership: { default: 0 } });
      return { id: j.id, uuid: j.uuid };` }))?.result;
    if ( !ctx.expect(made?.uuid, `journal témoin créé (${made?.uuid})`) ) return;
    ctx.restore(() => ctx.call("run-script", { code: `await game.journal.get("${made.id}")?.delete(); return true;` }).catch(() => {}));
    // Une vraie activité du Zombi lui-même : sans activité, l'ancien gestionnaire s'arrêtait avant `drop` et le test ne prouvait rien.
    const activity = (await ctx.call("run-script", { code: `
      const a = (await fromUuid("${seen.actor}"))?.items.contents.flatMap(i => [...(i.system.activities ?? [])])[0];
      return { uuid: a?.uuid ?? null };` }))?.result?.uuid ?? null;
    if ( !ctx.expect(activity, `une activité du Zombi pour la réaction (${activity})`) ) return;
    const before = new Set(await windows());
    const pending = send("dnd5e-combat.reaction", {
      actor: seen.actor, prompt: { key: "ReactionTitre", data: { name: "Test" } }, target: null, auto: true,
      options: [{ name: "Test", activity, drop: [made.uuid] }]
    });
    // La fenêtre posée chez le MJ (`auto` tombé) : fermée sans répondre, comme un MJ qui ne réagit pas.
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
