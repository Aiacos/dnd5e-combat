/**
 * §490 (brique B08) : monture et ordre à un compagnon non invoqué. Deux items synthétiques prêtés, leur règle posée dans la surcouche du
 * monde (`api.mcp.overrideContent`) :
 *   - sur le Zombi (la monture) : `mount: { rider: <acteur du Guerrier> }` (contrôlée) ;
 *   - sur le Guerrier (le cavalier) : `commands: { actor: <acteur du Zombi>, distance: 60, units: "ft" }`, action Bonus.
 *  1. le Guerrier au contact : le menu du Zombi offre « Monter » ; il monte — lien noté des deux côtés, assis sur le Zombi ;
 *  2. le Zombi marche deux cases : le Guerrier suit, toujours en selle ;
 *  3. en combat, initiative du Guerrier 15, du Zombi 3 : le Zombi passe juste après lui ; son attaque demande l'ordre (souci de
 *     légalité), l'ordre donné (« Commander », action Bonus) le lève pour ce round ;
 *  4. le Zombi mis À terre : le lien tombe, le Guerrier est posé à côté, À terre.
 * Remet items, surcouche, états et combat ; les positions par le filet du lanceur.
 */
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

const MOUNT_ID = "essai-monture-das";
const COMMAND_ID = "essai-ordre-das";
const COMMAND_ACTIVITY = "essaiOrdreDas001";

export default {
  name: "monture — monter, déplacement commun, monture contrôlée et ordre, chute (§490, B08)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Guerrier ou Zombi absent : non applicable"); return; }
    const rider = await ctx.token("Guerrier");
    const mount = await ctx.token("Zombi");
    const state = async () => ctx.engine("mount", { tokenId: rider.id, targetId: mount.id });

    // --- Items et règles prêtés ----------------------------------------------------------------------------------------
    const lend = async (token, identifier, itemData, rule) => {
      await ctx.call("upsert-actor-item", { actorId: token.actorId, itemData, match: { path: "system.identifier", value: identifier } });
      const lent = await ctx.itemId(token.id, identifier);
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: token.actorId, itemId: lent }).catch(() => {}));
      const { before } = await ctx.engine("overrideContent", { identifier, entry: rule });
      ctx.restore(() => ctx.engine("overrideContent", { identifier, entry: before }).catch(() => {}));
      return lent;
    };
    await lend(mount, MOUNT_ID, { name: "Essai : monture", type: "feat", img: "icons/svg/upgrade.svg", system: { identifier: MOUNT_ID } },
      { mount: { rider: rider.actorId } });
    const commandItem = await lend(rider, COMMAND_ID, { name: "Essai : ordre", type: "feat", img: "icons/svg/upgrade.svg",
      system: { identifier: COMMAND_ID, activities: { [COMMAND_ACTIVITY]: { _id: COMMAND_ACTIVITY, type: "utility", name: "Ordre",
        activation: { type: "bonus", value: 1 }, target: { affects: { type: "self" } } } } } },
      { commands: { actor: mount.actorId, distance: 60, units: "ft" } });
    ctx.restore(async () => {
      await ctx.engine("mount", { action: "dismount", tokenId: rider.id }).catch(() => {});
      for ( const t of [rider, mount] ) await ctx.removeStatusEffects(t, "prone").catch(() => {});
    });

    // --- 1. Monter -------------------------------------------------------------------------------------------------------
    const m0 = (await state()).target.position.cell;
    await ctx.engine("move", { tokenId: rider.id, cell: { i: m0.i + 1, j: m0.j } }, { timeoutMs: 60000 });
    const { labels, refused } = await ctx.engine("menu", { tokenId: rider.id, targetId: mount.id });
    const entry = labels.find(l => l.includes(mount.name) && /Monter|Mount|Montar|Montare/.test(l));
    ctx.expect(!!entry, `le menu du Zombi offre « Monter » (${labels.join(" | ")})`);
    // Avant le geste : rien ne doit refuser (son cavalier, au contact, hors combat). Un refus serait une fenêtre « forcer ? » en jeu ;
    // l'API de test passe outre sans fenêtre (`force`) pour que la suite se joue, mais le refus est compté ici, avec sa raison.
    const pre = await state();
    ctx.expect(!pre.issues.length && !refused?.[entry], `rien ne refuse de monter (${[...pre.issues, refused?.[entry]].filter(Boolean).join(" | ") || "—"} ; `
      + `Guerrier ${pre.token.position.cell.i},${pre.token.position.cell.j}, Zombi ${pre.target.position.cell.i},${pre.target.position.cell.j})`);
    const up = await ctx.engine("mount", { action: "mount", tokenId: rider.id, targetId: mount.id }, { timeoutMs: 60000 });
    await pause(1000);
    let s = await state();
    ctx.expect(up.done === true, "le Guerrier monte");
    ctx.expect((s.token.mountedOn === mount.id) && (s.target.ridden === rider.id), "le lien est noté sur le cavalier et sur la monture");
    ctx.expect((s.token.position.x === s.target.position.x) && (s.token.position.y === s.target.position.y), "le Guerrier est assis sur le Zombi");

    // --- 2. Déplacement commun -------------------------------------------------------------------------------------------
    const cell = { i: s.target.position.cell.i, j: s.target.position.cell.j + 2 };
    await ctx.engine("move", { tokenId: mount.id, cell }, { timeoutMs: 60000 });
    await pause(1500);
    s = await state();
    ctx.expect(s.target.position.cell.j === cell.j, "le Zombi a marché deux cases");
    ctx.expect((s.token.position.x === s.target.position.x) && (s.token.position.y === s.target.position.y), "le Guerrier a suivi, toujours en selle");

    // --- 3. Monture contrôlée : initiative et ordre ---------------------------------------------------------------------
    const combat = await ctx.startCombat([rider, mount]);
    const c = (await ctx.combat()).combat ?? combat;
    const by = id => (c.combatants ?? []).find(x => x.tokenId === id);
    await ctx.call("set-initiative", { combatId: c.id, combatantId: by(mount.id).id, value: 3 });
    await ctx.call("set-initiative", { combatId: c.id, combatantId: by(rider.id).id, value: 15 });
    await pause(1500);
    const after = ((await ctx.combat()).combat ?? (await ctx.combat())).combatants ?? [];
    const init = id => after.find(x => x.tokenId === id)?.initiative;
    ctx.expect((init(mount.id) < 15) && (init(mount.id) > 14), `le Zombi passe juste après son cavalier (initiative ${init(mount.id)})`);

    const items = (await ctx.call("get-actor", { actorId: mount.actorId })).items ?? [];
    const attack = items.find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    if ( ctx.expect(!!attack, "le Zombi a une attaque") ) {
      const before = await ctx.engine("issues", { tokenId: mount.id, itemId: attack._id, activityType: "attack" });
      const used = await ctx.use({ tokenId: rider.id, itemId: commandItem });
      await ctx.settle(used?.usageMessageId, { timeoutMs: 30000 }).catch(() => null);
      await pause(1500);
      const commanded = (await state()).target.commanded;
      ctx.expect(Number.isFinite(commanded), `l'ordre est noté sur le Zombi (round ${commanded})`);
      const lifted = await ctx.engine("issues", { tokenId: mount.id, itemId: attack._id, activityType: "attack" });
      const gone = before.filter(l => !lifted.includes(l));
      ctx.expect(gone.length === 1, `sans ordre, l'attaque du Zombi demandait l'ordre ; l'ordre le lève (${gone.join(" | ") || "rien de levé"})`);
    }

    // --- 4. Chute ---------------------------------------------------------------------------------------------------------
    await ctx.call("set-status", { tokenId: mount.id, statusId: "prone", active: true });
    await pause(2500);
    s = await state();
    ctx.expect((s.token.mountedOn === null) && (s.target.ridden === null), "le Zombi À terre : le lien tombe");
    ctx.expect((s.token.position.x !== s.target.position.x) || (s.token.position.y !== s.target.position.y), "le Guerrier est posé à côté");
    ctx.expect(s.token.statuses.includes("prone"), "le Guerrier tombe À terre");
  }
};
