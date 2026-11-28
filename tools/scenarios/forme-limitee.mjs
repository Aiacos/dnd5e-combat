/**
 * §498 (B18) — time-limited change of form, shared spell slots: `changesForm: { activity, keepHp: true,
 * revertAfter: { rounds: 10 }, shareSpellSlots: true }`. Test arena (active scene). Two test actors are created for the length of
 * the scenario: "Essai forme : druide" (30 HP, 3 level 1 spell slots) carries a feature whose "transform" activity has the profile
 * "Essai forme : tertre" (60 HP, 4 level 1 spell slots). An UNLINKED druid token is placed two cells from the Wizard. The
 * rule is placed in the world overlay (`overrideContent`, never in an item flag).
 *  1. Automatic revert: the druid (20 HP, 1 slot left of 3) uses the feature — the token becomes the mound, keeps 20 HP
 *     (`keepHp`), 2 slots of 4 (2 spent, `shareSpellSlots`), flag `formRevert` with `expiresAt` = time + 60 s. The mound
 *     drops to 15 HP and spends a slot (1 of 4). 30 s later: still the mound. 30 s more (10 rounds): the token turns back into
 *     the druid — original name, 15 HP kept, 0 slots (3 spent), flag removed, card `formReverted`.
 *  2. Manual revert (`revertAfter: { seconds: 12, auto: false }`): after 12 s, the token stays a mound, the GM gets the reminder
 *     (`formRevertDue`); the "Revert form" entry of its own token's menu gives it back to the druid.
 * The activity keeps dnd5e's `cr` mode: the engine must prevent the compendium window it would open (otherwise the use never
 * returns control — failure on the test bench of 2026-11-20).
 * The world time advanced by the scenario is restored; token, actors, overlay removed. No window is expected: any window
 * opened on the GM's side is closed (or accepted if it is "do it anyway").
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(r => setTimeout(r, ms));

const IDENTIFIER = "das-essai-forme-limitee";
const ACTIVITY = "dasEssaiFormLimi";
const PROFILE = "dasEssaiFormProf";
// Name in a constant: the test bench and the reference take the first "name:" indented by two spaces as the scenario title.
const ITEM_NAME = "Essai : forme limitée";
const DRUID = "Essai forme : druide";
const MOUND = "Essai forme : tertre";

/** Creates the two actors and the druid's token (unlinked) two cells from `near`. */
const SETUP = `
const { druid, mound, item, near, grid } = args;
const npc = (name, hp, slots, items=[]) => ({ name, type: "npc", img: "icons/svg/mystery-man.svg",
  prototypeToken: { name, actorLink: false, disposition: -1 },
  system: { attributes: { hp: { value: hp, max: hp } }, spells: { spell1: { value: slots, override: slots } } },
  items, flags: { "${MODULE_ID}": { scenario: "forme-limitee" } } });
const b = await Actor.implementation.create(npc(mound, 60, 4));
const feat = foundry.utils.deepClone(item);
feat.system.activities["${ACTIVITY}"].profiles = [{ _id: "${PROFILE}", name: mound, uuid: b.uuid }];
const a = await Actor.implementation.create(npc(druid, 30, 3, [feat]));
const proto = (await a.getTokenDocument({ x: near.x + 2 * grid, y: near.y })).toObject();
const [t] = await canvas.scene.createEmbeddedDocuments("Token", [proto]);
return { druidId: a.id, moundId: b.id, tokenId: t.id, itemId: a.items.contents[0].id };
`;
/** The token's state: actor, name, revert flag, HP and level 1 spell slots of its actor (synthetic). */
const READ = `
const t = canvas.scene.tokens.get(args.tokenId);
if ( !t ) return null;
const s = t.actor?.system;
return { actorId: t.actorId, name: t.name, revert: t.getFlag("${MODULE_ID}", "formRevert") ?? null, hp: s?.attributes?.hp?.value ?? null,
  slot: s?.spells?.spell1?.value ?? null, slotMax: s?.spells?.spell1?.max ?? null, worldTime: game.time.worldTime };
`;
/** Writes HP and level 1 spell slots of the token's actor. */
const WRITE = `
const t = canvas.scene.tokens.get(args.tokenId);
await t.actor.update({ "system.attributes.hp.value": args.hp, "system.spells.spell1.value": args.slot });
return true;
`;
const CLEANUP = `
const { tokenId, druidId, moundId } = args;
for ( const s of game.scenes ) {
  const ids = s.tokens.filter(t => (t.id === tokenId) || [druidId, moundId].includes(t.actorId)).map(t => t.id);
  if ( ids.length ) await s.deleteEmbeddedDocuments("Token", ids);
}
for ( const id of [druidId, moundId] ) await game.actors.get(id)?.delete();
return true;
`;
const ITEM = { name: ITEM_NAME, type: "feat", img: "icons/magic/nature/root-vine-entangled-humanoid.webp",
  system: { identifier: IDENTIFIER, type: { value: "monster" }, description: { value: "<p>Essai §498.</p>" },
    activities: { [ACTIVITY]: { _id: ACTIVITY, type: "transform", activation: { type: "action", value: 1 },
      range: { units: "self" }, target: { affects: { type: "self" } }, profiles: [],
      // `cr` mode (dnd5e default, that of campaign sheets): without the engine, the end of the use would open the compendium.
      transform: { mode: "cr", customize: true } } } } };
const RULE_AUTO = { changesForm: { activity: ACTIVITY, keepHp: true, revertAfter: { rounds: 10 }, shareSpellSlots: true } };
const RULE_MANUAL = { changesForm: { activity: ACTIVITY, keepHp: true, revertAfter: { seconds: 12, auto: false }, shareSpellSlots: true } };

export default {
  name: "forme-limitee — forme prise pour 10 rounds : retour automatique avec PV gardés et emplacements dépensés partagés, ou retour à la main par le menu (§498, brique B18)",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") ) { ctx.log("Magicien requis (point de pose) : non applicable"); return; }
    const mage = tokens.find(t => t.name === "Magicien");
    const grid = await ctx.gridSize();
    const script = async (code, args={}) => (await ctx.call("run-script", { code, args, waitMs: 20000 }))?.result ?? null;

    // --- Windows on the GM's side: none stays unanswered -----------------------------------------------------------------
    const seen = new Set(((await ctx.call("list-dialogs", {})).windows ?? []).map(w => w.id));
    const sweep = async (ms=1000) => {
      const r = await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: [...seen], waitMs: ms, details: true }).catch(() => null);
      for ( const w of r?.windows ?? [] ) {
        seen.add(w.id);
        const go = (w.buttons ?? []).find(b => b.action === "go");
        const button = go ? "go" : ((w.buttons ?? []).find(b => ["cancel", "no", "none"].includes(b.action))?.action ?? null);
        ctx.log(`fenêtre « ${w.title} » : ${button ?? "fermée"}`);
        await ctx.call("answer-dialog", { id: w.id, ...(button ? { button } : {}) }).catch(() => {});
      }
    };

    // --- World time: restored at the end -------------------------------------------------------------------------------------
    const t0 = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
    ctx.restore(async () => {
      const now = (await ctx.engine("advanceTime", { seconds: 0 })).worldTime;
      if ( now !== t0 ) await ctx.engine("advanceTime", { seconds: t0 - now });
    });
    const advance = async seconds => { await ctx.engine("advanceTime", { seconds }); await pause(2500); await sweep(300); };

    // --- Acteurs, token, surcouche ------------------------------------------------------------------------------------------
    const setup = await script(SETUP, { druid: DRUID, mound: MOUND, item: ITEM, near: { x: mage.x, y: mage.y }, grid });
    if ( !ctx.expect(!!setup?.tokenId, `acteurs d'essai et token du druide posés (${JSON.stringify(setup)})`) ) return;
    ctx.restore(() => script(CLEANUP, setup).catch(() => {}));
    const { before } = await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE_AUTO });
    ctx.restore(() => ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: before }).catch(() => {}));
    await pause(800);

    const read = () => script(READ, { tokenId: setup.tokenId });
    const write = (hp, slot) => script(WRITE, { tokenId: setup.tokenId, hp, slot });
    const transform = async () => {
      const since = await ctx.lastMessageId();
      await ctx.use({ tokenId: setup.tokenId, itemId: setup.itemId, activityType: "transform", consume: false });
      await sweep(800);
      let state = null;
      for ( const stop = Date.now() + 15000; Date.now() < stop; await pause(700) ) {
        state = await read();
        if ( state?.actorId === setup.moundId ) break;
      }
      await pause(1200);
      return { state: await read(), since };
    };
    /** Waits for the return to the druid (or the end of the delay); returns the state. */
    const waitDruid = async (ms=15000) => {
      let state = null;
      for ( const stop = Date.now() + ms; Date.now() < stop; await pause(700) ) {
        state = await read();
        if ( state?.actorId === setup.druidId ) break;
      }
      await pause(1000);
      return read();
    };
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      await sweep(300);
      const errors = await ctx.clientErrors();
      ctx.expect(!errors.length, `${label} : aucune erreur dans la console du MJ${errors.length ? ` — ${errors.map(e => e.message ?? e.text).join(" | ").slice(0, 300)}` : ""}`);
    };

    await part("retour automatique", async () => {
      await write(20, 1);
      const { state, since } = await transform();
      if ( !ctx.expect(state?.actorId === setup.moundId && state.name === MOUND, `le token devient le tertre (${JSON.stringify(state)})`) ) return;
      ctx.expect(state.hp === 20, `PV gardés : 20 (${state.hp})`);
      ctx.expect(state.slot === 2 && state.slotMax === 4, `emplacements partagés : 2 sur 4 (${state.slot} sur ${state.slotMax})`);
      ctx.expect(state.revert?.actorId === setup.druidId && state.revert.expiresAt === state.worldTime + 60 && state.revert.auto === true,
        `forme d'origine notée, retour dans 60 s (${JSON.stringify(state.revert && { actorId: state.revert.actorId, expiresAt: state.revert.expiresAt, auto: state.revert.auto })}, temps ${state.worldTime})`);
      const card = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.secondPhase)?.flags?.[MODULE_ID]?.secondPhase ?? null;
      ctx.expect(Number.isFinite(card?.until), `carte du changement de forme, avec son terme (${JSON.stringify(card)})`);

      await write(15, 1);
      await advance(30);
      const mid = await read();
      ctx.expect(mid?.actorId === setup.moundId, `après 30 s : toujours le tertre (${mid?.name})`);
      const sinceBack = await ctx.lastMessageId();
      await advance(30);
      const back = await waitDruid();
      if ( !ctx.expect(back?.actorId === setup.druidId && back.name === DRUID, `après 60 s : le druide revient (${JSON.stringify(back)})`) ) return;
      ctx.expect(back.hp === 15, `PV de la forme quittée gardés : 15 (${back.hp})`);
      ctx.expect(back.slot === 0 && back.slotMax === 3, `emplacements dépensés sous le tertre : 0 sur 3 (${back.slot} sur ${back.slotMax})`);
      ctx.expect(!back.revert, "drapeau de retour retiré");
      const reverted = (await ctx.messagesSince(sinceBack)).find(m => m.flags?.[MODULE_ID]?.formReverted)?.flags?.[MODULE_ID]?.formReverted ?? null;
      ctx.expect(reverted?.token?.endsWith(setup.tokenId) === true, `carte du retour (${JSON.stringify(reverted)})`);
    });

    await part("retour à la main", async () => {
      await ctx.engine("overrideContent", { identifier: IDENTIFIER, entry: RULE_MANUAL });
      await pause(500);
      await write(30, 3);
      const { state } = await transform();
      if ( !ctx.expect(state?.actorId === setup.moundId && state.revert?.auto === false, `le token devient le tertre, retour non automatique (${JSON.stringify(state)})`) ) return;
      const since = await ctx.lastMessageId();
      await advance(12);
      await pause(1500);
      const after = await read();
      ctx.expect(after?.actorId === setup.moundId, `durée écoulée : le tertre reste (${after?.name})`);
      const due = (await ctx.messagesSince(since)).find(m => m.flags?.[MODULE_ID]?.formRevertDue) ?? null;
      ctx.expect(!!due, "rappel au MJ envoyé");
      const { labels } = await ctx.engine("menu", { tokenId: setup.tokenId, targetId: setup.tokenId });
      const entry = labels.find(l => /normal form|Reprendre sa forme/i.test(l)) ?? null;
      if ( !ctx.expect(!!entry, `entrée « Reprendre sa forme » au menu du token (${labels.join(" | ")})`) ) return;
      await ctx.engine("menu", { tokenId: setup.tokenId, targetId: setup.tokenId, run: entry });
      const back = await waitDruid();
      ctx.expect(back?.actorId === setup.druidId && !back.revert, `par le menu : le druide revient (${JSON.stringify(back)})`);
    });
  }
};
