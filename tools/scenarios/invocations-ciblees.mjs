/**
 * §393: summons that target, in the "Arène des invocations" (`node tools/arene-invocations.mjs` first) — what the summons
 * sweep skips in the Arène des sorts, for lack of a target:
 *  1. Finger of Death, "Raise a zombie" activity, on the Cadavre (a dead commoner): darsh-loot raises the body (§118,
 *     `summonOnTargets`) — the Cadavre's token becomes a Monster Manual zombie.
 *  2. Animate Dead on the already targeted Cadavre: the engine casts the spell without targeting (§388, `summon.untargeted`), but a
 *     target designated beforehand remains the one that darsh-loot raises.
 *  3. Finger of Death on the dead Beast (a wolf): not a Humanoid, darsh-loot does not raise it.
 * Without darsh-loot active, the scenario is not applicable. The raised Cadavre is restored (token recreated, dead); the
 * zombies, their actors and the dead creature's pile of belongings are removed.
 */
const SPELLS = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "invocations ciblées — cadavre relevé par Doigt de mort et Animation des morts, bête morte refusée (Arène des invocations)",
  scene: "Arène des invocations",

  async run(ctx) {
    // darsh-loot active: its setting can be read (an inactive module registers none).
    const lootActive = await ctx.call("get-setting", { namespace: "darsh-loot", key: "dropMode" }).then(() => true, () => false);
    if ( !lootActive ) { ctx.log("darsh-loot inactif : non applicable"); return; }

    const caster = await ctx.token("Lanceur");
    const at = await ctx.position(caster);
    const grid = await ctx.gridSize();
    const sceneId = (await ctx.scene()).sceneId;
    const listTokens = async () => (await ctx.call("list-scene-objects", { sceneId, type: "Token" })).objects.Token ?? [];
    const listRegions = async () => (await ctx.call("list-scene-objects", { sceneId, type: "Region" })).objects.Region ?? [];
    const listTiles = async () => (await ctx.call("list-scene-objects", { sceneId, type: "Tile" })).objects.Tile ?? [];
    const before = { tokens: await listTokens(), regions: new Set((await listRegions()).map(r => r.id)),
      tiles: new Set((await listTiles()).map(t => t.id)), actors: new Set((await ctx.call("list-actors", {})).map(a => a.id)) };
    const corpse0 = before.tokens.find(t => t.name === "Cadavre");
    if ( !ctx.expect(!!corpse0, "le Cadavre est sur la scène (sinon : node tools/arene-invocations.mjs)") ) return;
    const corpseActorId = corpse0.actorId;
    // The tokens already there before each case (the restoration relies on `before`): a zombie from the previous case
    // is not a new one.
    let seen = new Set(before.tokens.map(t => t.id));
    const corpsePos = { x: corpse0.x, y: corpse0.y };

    // The restoration: the tokens and actors born from the test leave, the Cadavre comes back dead on its cell.
    ctx.restore(async () => {
      const keep = new Set(before.tokens.map(t => t.id));
      for ( const t of await listTokens() ) if ( !keep.has(t.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Token", objectId: t.id }).catch(() => {});
      for ( const r of await listRegions() ) if ( !before.regions.has(r.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Region", objectId: r.id }).catch(() => {});
      for ( const t of await listTiles() ) if ( !before.tiles.has(t.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Tile", objectId: t.id }).catch(() => {});
      for ( const a of await ctx.call("list-actors", {}) ) if ( !before.actors.has(a.id) ) await ctx.call("trash-document", { documentType: "Actor", documentId: a.id }).catch(() => {});
      if ( !(await listTokens()).some(t => t.name === "Cadavre") ) {
        await ctx.call("place-token", { sceneId, actorId: corpseActorId, x: corpsePos.x, y: corpsePos.y }).catch(() => {});
      }
      await ctx.call("update-actor", { actorId: corpseActorId, actorData: { system: { attributes: { hp: { value: 0 } } } } }).catch(() => {});
      await ctx.call("set-status", { actorId: corpseActorId, statusId: "dead", active: true }).catch(() => {});
    });

    // A targeted summon, then what the scene became (up to 10 s).
    const cast = async (source, targetName, slot) => {
      const itemId = await ctx.ensureItem(caster, SPELLS + source);
      const target = (await listTokens()).find(t => t.name === targetName);
      await ctx.engine("castFromBar", { tokenId: caster.id, itemId, slot, targetIds: target ? [target.id] : [], x: at.x + (6 * grid), y: at.y });
      let raised = null;
      for ( let i = 0; (i < 20) && !raised; i++ ) {
        await pause(500);
        for ( const t of await listTokens() ) {
          if ( seen.has(t.id) || !t.actorId ) continue;
          const actor = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
          if ( actor?.flags?.["darsh-loot"]?.raised ) raised = { token: t, from: actor.flags["darsh-loot"].raised.from };
        }
        // A window (form, number): its default answer, like a hurried player.
        for ( const w of (await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? [] ) {
          const button = (w.buttons ?? []).find(b => b.default) ?? (w.buttons ?? [])[0];
          if ( button ) await ctx.call("answer-dialog", { id: w.id, button: button.action }).catch(() => {});
        }
      }
      return raised;
    };

    // 1. Doigt de mort sur le Cadavre.
    const finger = await cast("phbsplFingerofDe", "Cadavre", "spell7");
    ctx.expect(finger?.from === "Cadavre", `Doigt de mort : darsh-loot relève le Cadavre (${finger ? `${finger.token.name}` : "rien de relevé"})`);
    ctx.expect(!(await listTokens()).some(t => t.name === "Cadavre"), "Doigt de mort : le token du Cadavre a laissé place au zombi");

    // Put back in place for the next case: the scenario's restoration does the same job.
    for ( const t of await listTokens() ) if ( !before.tokens.some(b => b.id === t.id) ) await ctx.call("delete-scene-object", { sceneId, type: "Token", objectId: t.id }).catch(() => {});
    if ( !(await listTokens()).some(t => t.name === "Cadavre") ) {
      await ctx.call("place-token", { sceneId, actorId: corpseActorId, x: corpsePos.x, y: corpsePos.y });
      await ctx.call("set-status", { actorId: corpseActorId, statusId: "dead", active: true }).catch(() => {});
    }
    seen = new Set((await listTokens()).map(t => t.id));

    // 2. Animate Dead on the Cadavre targeted in advance.
    const animate = await cast("phbsplAnimateDea", "Cadavre", "spell3");
    ctx.expect(animate?.from === "Cadavre", `Animation des morts : la cible désignée d'avance est relevée (${animate ? animate.token.name : "rien de relevé"})`);

    seen = new Set((await listTokens()).map(t => t.id));
    // 3. Finger of Death on the dead Beast: refused.
    const beast = await cast("phbsplFingerofDe", "Bête morte", "spell7");
    ctx.expect(!beast, `Doigt de mort sur un loup mort : rien n'est relevé par darsh-loot (${beast ? beast.token.name : "rien"})`);
    ctx.expect((await listTokens()).some(t => t.name === "Bête morte"), "la Bête morte reste sur la scène");
  }
};
