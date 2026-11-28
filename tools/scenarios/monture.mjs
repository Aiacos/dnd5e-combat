/**
 * §490 (brick B08): mount and order to a non-summoned companion. Two synthetic items lent, their rule placed in the world's
 * overlay (`api.mcp.overrideContent`):
 *   - on the Zombie (the mount): `mount: { rider: <acteur du Guerrier> }` (controlled);
 *   - on the Fighter (the rider): `commands: { actor: <acteur du Zombi>, distance: 60, units: "ft" }`, Bonus Action.
 *  1. neither Prone nor Incapacitated (setup), the Fighter in contact: the Zombie's menu offers "Mount"; they mount — link
 *     noted on both sides, seated on the Zombie;
 *  2. the Zombie walks two cells: the Fighter follows, still in the saddle;
 *  3. in combat, Fighter's Initiative 15, Zombie's 3: the Zombie goes right after them; its attack asks for the order (legality
 *     concern), the order given ("Command", Bonus Action) lifts it for this round;
 *  4. the Zombie knocked Prone: the link falls, the Fighter is placed next to it, Prone.
 * Restores items, overlay, conditions and combat; the positions through the caster's safety net.
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

    // --- Items and rules lent ------------------------------------------------------------------------------------------
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

    // --- 1. Mounting ------------------------------------------------------------------------------------------------------
    // Setup: neither Prone nor Incapacitated (one does not mount while Prone). The `dnd-6` Fighter keeps a "Prone" effect
    // from an earlier run (seen on the test bench on 2026-11-20); the caster's safety net restores its effects after the scenario.
    const BREAKERS = ["prone", "incapacitated", "paralyzed", "petrified", "stunned", "unconscious", "dead"];
    for ( const t of [rider, mount] ) for ( const status of BREAKERS ) await ctx.removeStatusEffects(t, status).catch(() => {});
    await pause(500);
    const m0 = (await state()).target.position.cell;
    await ctx.engine("move", { tokenId: rider.id, cell: { i: m0.i + 1, j: m0.j } }, { timeoutMs: 60000 });
    const { labels, refused } = await ctx.engine("menu", { tokenId: rider.id, targetId: mount.id });
    const entry = labels.find(l => l.includes(mount.name) && /Monter|Mount|Montar|Montare/.test(l));
    ctx.expect(!!entry, `le menu du Zombi offre « Monter » (${labels.join(" | ")})`);
    // Before the move: nothing must refuse (its rider, in contact, out of combat). A refusal would be a "force it?" window in play;
    // the test API goes past it without a window (`force`) so the suite plays, but the refusal is counted here, with its reason.
    const pre = await state();
    ctx.expect(!pre.issues.length && !refused?.[entry], `rien ne refuse de monter (${[...pre.issues, refused?.[entry]].filter(Boolean).join(" | ") || "—"} ; `
      + `Guerrier ${pre.token.position.cell.i},${pre.token.position.cell.j} [${pre.token.statuses.join(", ")}], `
      + `Zombi ${pre.target.position.cell.i},${pre.target.position.cell.j} [${pre.target.statuses.join(", ")}])`);
    const up = await ctx.engine("mount", { action: "mount", tokenId: rider.id, targetId: mount.id }, { timeoutMs: 60000 });
    await pause(1000);
    let s = await state();
    ctx.expect(up.done === true, "le Guerrier monte");
    ctx.expect((s.token.mountedOn === mount.id) && (s.target.ridden === rider.id), "le lien est noté sur le cavalier et sur la monture");
    ctx.expect((s.token.position.x === s.target.position.x) && (s.token.position.y === s.target.position.y), "le Guerrier est assis sur le Zombi");

    // --- 2. Shared movement -----------------------------------------------------------------------------------------------
    const cell = { i: s.target.position.cell.i, j: s.target.position.cell.j + 2 };
    await ctx.engine("move", { tokenId: mount.id, cell }, { timeoutMs: 60000 });
    await pause(1500);
    s = await state();
    ctx.expect(s.target.position.cell.j === cell.j, "le Zombi a marché deux cases");
    ctx.expect((s.token.position.x === s.target.position.x) && (s.token.position.y === s.target.position.y), "le Guerrier a suivi, toujours en selle");

    // --- 3. Controlled mount: Initiative and order ----------------------------------------------------------------------
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
