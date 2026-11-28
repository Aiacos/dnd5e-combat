/**
 * §497 (B17) — random movement: `move` step, `random` mode. Test arena: Wizard (linked token), Bandit (unlinked token).
 * A test feature is lent to the Wizard: a save activity (Con, DC 30: the Bandit always fails it) with no effect. Its rule is
 * placed in the world overlay (`overrideContent`, never as an item flag), changed from one case to the next:
 *  1. `{ mode: "random", directions: ["n", "s", "e", "w"], distance: 5, units: "ft", ifBlocked: "stay", minSpeed: 5 }`
 *     (Infestation): a 1d4 shown in the chat; its message carries `flags.dnd5e-combat.randomMove` (face, direction, cells).
 *     The direction is that of the face (1 n, 2 s, 3 e, 4 w) and the Bandit moved that many cells in that direction
 *     (0 if the cell was taken or walled).
 *     The result is read from the roll: no value is expected.
 *  2. `minSpeed: 5000`: its Speed is too low — no roll or movement, the engine log says so.
 *  3. `distance: 5000, ifBlocked: "stay"`: no direction is free that far — roll, nothing moves, `blocked`.
 *  4. `distance: 5000` without `ifBlocked` (default `stop`): as far as possible — the movement follows the recorded cells.
 * Conditions left on the Bandit (synthetic actor) removed first; HP, position, feature, overlay restored. Any "do it anyway"
 * window open on the GM's side is accepted ("go"), any other is closed.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-aleatoire";
const ACTIVITY = "dasEssaiAleaSave";
// Name as a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : nuée qui disperse";
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/svg/hazard.svg",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, description: { value: "<p>Essai §497.</p>" },
    activities: { [ACTIVITY]: { _id: ACTIVITY, type: "save", activation: { type: "action", value: 1 },
      range: { units: "any", override: true }, target: { affects: { type: "creature", count: "1" } },
      save: { ability: ["con"], dc: { calculation: "", formula: "30" } } } } } };
const STEP = { type: "move", mode: "random", directions: ["n", "s", "e", "w"], distance: 5, units: "ft", ifBlocked: "stay", minSpeed: 5 };
const VECTORS = { n: { di: -1, dj: 0 }, s: { di: 1, dj: 0 }, e: { di: 0, dj: 1 }, w: { di: 0, dj: -1 } };

export default {
  name: "deplacement-aleatoire — Infestation : 1d4 visible, déplacement subi dans la direction tirée, rien si bloqué ou trop lent (§497, brique B17)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    const need = ["Magicien", "Bandit"];
    if ( need.some(n => !tokens.some(t => t.name === n)) ) { ctx.log(`${need.join(", ")} requis : non applicable`); return; }
    const mage = await ctx.token("Magicien");
    const bandit = await ctx.token("Bandit");
    const { data: tok } = await ctx.call("get-scene-object", { type: "Token", objectId: mage.id });
    if ( !tok.actorLink ) { ctx.log("Magicien non lié : non applicable (le trait prêté irait à l'acteur de base)"); return; }
    const actorId = tok.actorId;
    const grid = await ctx.gridSize();

    // --- Windows on the GM's side: none stays unanswered ------------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    const sweep = async (ms=1500) => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: ms, details: true }).catch(() => null);
      for ( const w of r?.windows ?? [] ) {
        seen.add(w.id);
        const go = (w.buttons ?? []).find(b => b.action === "go");
        const button = go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null);
        ctx.log(`fenêtre « ${w.title} » : ${button ?? "fermée"}`);
        await ctx.call("answer-dialog", { id: w.id, ...(button ? { button } : {}) }).catch(() => {});
      }
    };

    // --- Clean Bandit (synthetic actor), in place -------------------------------------------------------------------------
    const clearBandit = async () => {
      await ctx.removeEffectsNamed(bandit, /^Essai :/).catch(() => {});
      for ( const s of ["grappled", "restrained", "paralyzed", "incapacitated", "stunned", "prone", "unconscious", "dead"] ) {
        await ctx.removeStatusEffects(bandit, s).catch(() => {});
      }
    };
    await clearBandit();
    ctx.restore(clearBandit);
    const hp0 = await ctx.hp(bandit);
    ctx.restore(() => ctx.setHp(bandit, hp0));
    const home = await ctx.position(bandit);
    const goHome = () => ctx.call("move-token", { tokenId: bandit.id, x: home.x, y: home.y, elevation: home.elevation }).catch(() => {});
    ctx.restore(goHome);

    // --- Feature lent, then rule ------------------------------------------------------------------------------------------
    await ctx.call("upsert-actor-item", { actorId, itemData: ITEM, match: { path: "system.identifier", value: IDENTIFIER } });
    const lent = await ctx.itemId(mage.id, IDENTIFIER);
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: actorId, itemId: lent }).catch(() => {}));
    let before = null;
    const rule = async step => {
      const r = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: { triggers: [{ on: "failedSave", do: [step] }] } });
      if ( before === null ) {
        before = r.before ?? null;
        ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
      }
      await pause(500);
    };

    /** The Bandit in place, the feature used on it; returns the save, the `randomMove` message (or null) and the movement in cells. */
    const cast = async ({ expectRoll=true }={}) => {
      await goHome();
      await pause(800);
      const start = await ctx.position(bandit);
      const since = await ctx.lastMessageId();
      const used = await ctx.use({ tokenId: mage.id, itemId: lent, activityType: "save", targetTokenIds: [bandit.id], consume: false });
      await sweep();
      const r = await ctx.settle(used.usageMessageId, { timeoutMs: 45000 }).catch(() => null);
      const save = r?.targets?.find(t => t.name === "Bandit")?.save ?? null;
      let flag = null;
      for ( const stop = Date.now() + (expectRoll ? 20000 : 4000); !flag && (Date.now() < stop); await pause(500) ) {
        flag = (await ctx.messagesSince(since)).map(m => m.flags?.[MODULE_ID]?.randomMove).filter(Boolean).at(-1) ?? null;
      }
      await pause(1500);
      const end = await ctx.position(bandit);
      return { r, save, flag, di: Math.round((end.y - start.y) / grid), dj: Math.round((end.x - start.x) / grid) };
    };

    // 1. Infestation : 1d4, une case.
    await rule(STEP);
    let res = await cast();
    if ( !ctx.expect(res.save?.success === false, `DD 30 : le Bandit rate sa sauvegarde (${res.save?.total ?? "aucune"})`) ) return;
    ctx.expect((res.r?.plan?.steps ?? []).some(s => (s.type === "move") && (s.mode === "random")), "le plan porte l'étape move random");
    if ( !ctx.expect(!!res.flag, "un jet de direction est montré, son message porte `randomMove`") ) return;
    const { face, direction, cells } = res.flag;
    ctx.expect((face >= 1) && (face <= 4) && (direction === STEP.directions[face - 1]), `1d4 = ${face} → ${direction} (attendu ${STEP.directions[face - 1]})`);
    const v = VECTORS[direction];
    if ( cells === 1 ) ctx.expect((res.di === v.di) && (res.dj === v.dj), `une case vers ${direction} (déplacement ${res.di}, ${res.dj})`);
    else {
      ctx.log(`case ${direction} prise ou murée autour du Bandit : il reste (${cells} case)`);
      ctx.expect((cells === 0) && (res.di === 0) && (res.dj === 0) && res.flag.blocked, `bloqué : le Bandit n'a pas bougé (${res.di}, ${res.dj})`);
    }
    ctx.expect((await ctx.engineLog()).some(l => /random: Bandit rolls \d/.test(l)), "le journal du moteur dit le jet (« random: Bandit rolls … »)");

    // 2. Too slow: no roll, no movement.
    await rule({ ...STEP, minSpeed: 5000 });
    res = await cast({ expectRoll: false });
    ctx.expect(res.save?.success === false, "DD 30 : sauvegarde ratée");
    ctx.expect(!res.flag, "Vitesse sous minSpeed : aucun jet de direction");
    ctx.expect((res.di === 0) && (res.dj === 0), `Vitesse sous minSpeed : le Bandit n'a pas bougé (${res.di}, ${res.dj})`);
    ctx.expect((await ctx.engineLog()).some(l => /random: Bandit not moved — speed/.test(l)), "le journal du moteur dit « not moved — speed … »");

    // 3. All or nothing: 5000 ft fit in no direction.
    await rule({ ...STEP, distance: 5000, minSpeed: 5 });
    res = await cast();
    if ( ctx.expect(!!res.flag, "ifBlocked stay : le jet est montré") ) {
      ctx.expect(res.flag.blocked && (res.flag.cells === 0), `ifBlocked stay : bloqué, 0 case (${res.flag.cells} sur ${res.flag.wanted})`);
      ctx.expect((res.di === 0) && (res.dj === 0), `ifBlocked stay : le Bandit reste (${res.di}, ${res.dj})`);
    }

    // 4. As far as possible (default).
    const { ifBlocked, ...far } = STEP;
    await rule({ ...far, distance: 5000 });
    res = await cast();
    if ( ctx.expect(!!res.flag, "ifBlocked par défaut : le jet est montré") ) {
      const w = VECTORS[res.flag.direction];
      ctx.expect(res.flag.cells < res.flag.wanted, `arrêté avant ${res.flag.wanted} cases (${res.flag.cells})`);
      ctx.expect((res.di === w.di * res.flag.cells) && (res.dj === w.dj * res.flag.cells),
        `${res.flag.cells} case(s) vers ${res.flag.direction} (déplacement ${res.di}, ${res.dj})`);
    }
    await sweep(500);
  }
};
