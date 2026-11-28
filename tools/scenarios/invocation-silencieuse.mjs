/**
 * §552 (Discord "Summon spells", SpitFire, 2026-11-26): Find Familiar must reach the creature choice, and a summon that cannot
 * place anything must say why instead of staying silent. Arène de test (Magicien for the GM, Clerc for "claude player"),
 * world `dnd-6`.
 *  1. GM, Player's Handbook Find Familiar as from the action bar (`configure: false`): DAS's "Choose the form" window opens, then
 *     dnd5e's compendium browser (CR mode: the creature is picked there). Closed without picking: no warning.
 *  2. GM, the same from the sheet (dnd5e's own usage window, a 1st-level slot): dnd5e's summon window opens. Closed.
 *  3. GM, SRD 2024 Find Familiar from the bar: form window, then compendium browser.
 *  4. A copy with no summon profile: no window, the GM gets an alert card that names the item (noProfile).
 *  5. A copy whose profile names no creature (not CR mode): the GM gets an alert card (noCreature).
 *  6. Player client (claude player, Clerc): Find Familiar from the bar opens the form window, then the compendium browser, on the
 *     player's screen; the no-profile copy warns the player and sends the GM an alert card that names the player.
 * Nothing is consumed from the bar; the sheet case gives the Magicien a slot and puts it back. Lent spells and copies are removed.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.phbsplFindFamili";
const pause = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "invocation silencieuse — Appel de familier va jusqu'au choix de la créature, une invocation impossible le dit (§552)",
  players: true,

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !tokens.some(t => t.name === "Magicien") || !tokens.some(t => t.name === "Clerc") ) {
      ctx.log("Magicien ou Clerc absent : non applicable"); return;
    }
    const mage = await ctx.token("Magicien");
    const cleric = await ctx.token("Clerc");
    const grid = await ctx.gridSize();
    const pos = await ctx.position(mage);
    const alerts = await ctx.engine("setting", { key: "gmAlerts", value: true });
    ctx.restore(() => ctx.engine("setting", { key: "gmAlerts", value: alerts.before }));
    const allow = await ctx.engine("foreignSetting", { namespace: "dnd5e", key: "allowSummoning", value: true });
    ctx.restore(() => ctx.engine("foreignSetting", { namespace: "dnd5e", key: "allowSummoning", value: allow.before }));

    const browsers = async () => (await ctx.engine("windows")).filter(w => w.className === "CompendiumBrowser" || /^compendium-browser/.test(w.id));
    const closeAll = async () => {
      for ( const w of await ctx.engine("windows") ) {
        if ( ["CompendiumBrowser", "SummonUsageDialog"].includes(w.className) || /^compendium-browser/.test(w.id) ) await ctx.engine("closeWindow", { id: w.id });
      }
      for ( const d of (await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? [] ) {
        if ( /Familiar|familier/i.test(d.title ?? "") ) await ctx.call("answer-dialog", { id: d.id, close: true }).catch(() => {});
      }
    };
    ctx.restore(closeAll);
    const waitFor = async (probe, tries=16) => {
      for ( let i = 0; i < tries; i++ ) { const r = await probe(); if ( r ) return r; await pause(500); }
      return null;
    };
    const formDialog = () => waitFor(async () => ((await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? [])
      .find(d => (d.buttons ?? []).some(b => b.action === "summon")));
    // Find Familiar is a ritual: prepared with a slot left, DAS asks first (§139) — "as a Ritual" here (no slot spent). The question
    // goes to the player who owns the caster when they are connected (askChoice, §137): the Magicien is claude player's.
    const ritualFirst = async (button="pick0") => {
      for ( let i = 0; i < 8; i++ ) {
        const asked = ((await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? []).find(d => (d.buttons ?? []).some(b => b.action === button));
        if ( asked ) { await ctx.call("answer-dialog", { id: asked.id, button }); return "gm"; }
        const atPlayer = await ctx.asPlayer(`
          const w = [...foundry.applications.instances.values()].find(a => a.rendered && a.element?.querySelector?.('button[data-action="' + args.button + '"]'));
          w?.element.querySelector('button[data-action="' + args.button + '"]').click();
          return !!w;`, { button });
        if ( atPlayer ) return "player";
        await pause(500);
      }
      return null;
    };
    const alertCards = async mark => (await ctx.messagesSince(mark)).map(m => m.flags?.[MODULE_ID]?.gmAlert?.text).filter(Boolean);

    // A spell copy on the Magicien's sheet, with its summon activity changed (`patch`): `{ id, name }`.
    const lendCopy = async (uuid, name, patch) => {
      const { data } = await ctx.call("get-compendium-entry", { uuid });
      const { _id, folder, ownership, _stats, ...item } = data;
      const [activityId] = Object.keys(item.system.activities);
      Object.assign(item.system.activities[activityId], patch(item.system.activities[activityId]));
      item.name = name;
      item.system.identifier = `das-test-${name.toLowerCase().replace(/[^a-z]+/g, "-")}`;
      item.system.prepared = 1;
      // Not a ritual: no "as a Ritual or with a slot" question in the way (§139).
      item.system.properties = (item.system.properties ?? []).filter(p => p !== "ritual");
      const made = await ctx.call("upsert-actor-item", { actorId: mage.actorId, itemData: item, match: { path: "name", value: name } });
      const id = made?.itemId ?? made?.item?._id ?? made?.id
        ?? (await ctx.call("get-actor", { actorId: mage.actorId })).items.find(i => i.name === name)?._id;
      ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: mage.actorId, itemId: id }).catch(() => {}));
      return { id, name };
    };

    // 1. GM, Player's Handbook, from the bar.
    const phbId = await ctx.ensureItem(mage, PHB);
    let mark = await ctx.lastMessageId();
    await ctx.engine("castFromBar", { tokenId: mage.id, itemId: phbId, x: pos.x + grid, y: pos.y + grid });
    await ritualFirst();
    let form = await formDialog();
    if ( ctx.expect(!!form, "1. barre (MJ, Manuel) : la fenêtre « Choisir la forme » s'ouvre") ) {
      await ctx.call("answer-dialog", { id: form.id, button: "summon" });
      await ritualFirst();   // with a slot left, the relaunch asks "as a Ritual or with a slot" after the form
      const browser = await waitFor(async () => (await browsers())[0]);
      ctx.expect(!!browser, "1. puis le navigateur de compendium pour choisir la créature (mode FP)");
      await closeAll();
      await pause(1500);
      ctx.expect((await alertCards(mark)).length === 0, "1. navigateur fermé sans choisir : aucun avertissement");
    }

    // 2. GM, from the sheet, with a 1st-level slot: dnd5e's own window.
    const sheet = await ctx.call("get-actor", { actorId: mage.actorId });
    const slot1 = sheet.system?.spells?.spell1?.value ?? 0;
    await ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.spells.spell1.value": Math.max(1, slot1) } });
    ctx.restore(() => ctx.call("update-actor", { actorId: mage.actorId, actorData: { "system.spells.spell1.value": slot1 } }));
    // A copy that is not a ritual: the "as a Ritual or with a slot" question (§139, played in 1) is not in the way.
    const plain = await lendCopy(PHB, "Familier fiche", () => ({}));
    await ctx.engine("castFromBar", { tokenId: mage.id, itemId: plain.id, sheet: true, x: pos.x + grid, y: pos.y + grid });
    const usage = await waitFor(async () => (await ctx.engine("windows")).find(w => w.className === "SummonUsageDialog"));
    ctx.expect(!!usage, "2. fiche (MJ, avec un emplacement) : la fenêtre d'invocation de dnd5e s'ouvre");
    await closeAll();

    // 3. GM, SRD 2024, from the bar.
    let srdEntry = null;
    for ( const nameFilter of ["Familiar", "familier"] ) {
      const r = await ctx.call("list-compendium-entries", { packId: "dnd5e.spells24", nameFilter }).catch(() => null);
      srdEntry = (Array.isArray(r) ? r : (r?.entries ?? [])).find(e => /find familiar|appel de familier/i.test(e.name ?? ""));
      if ( srdEntry ) break;
    }
    if ( srdEntry ) {
      const srdId = await ctx.ensureItem(mage, `Compendium.dnd5e.spells24.Item.${srdEntry._id ?? srdEntry.id}`, { byUuid: true });
      await ctx.engine("castFromBar", { tokenId: mage.id, itemId: srdId, x: pos.x + grid, y: pos.y + grid });
      await ritualFirst();
      form = await formDialog();
      if ( ctx.expect(!!form, "3. barre (MJ, SRD 2024) : la fenêtre « Choisir la forme » s'ouvre") ) {
        await ctx.call("answer-dialog", { id: form.id, button: "summon" });
        await ritualFirst();
        ctx.expect(!!(await waitFor(async () => (await browsers())[0])), "3. puis le navigateur de compendium");
      }
      await closeAll();
    } else ctx.log("3. Appel de familier du SRD 2024 introuvable : partie sautée");

    // 4. No profile: the GM is told.
    const empty = await lendCopy(PHB, "Familier sans profil", () => ({ profiles: [] }));
    mark = await ctx.lastMessageId();
    await ctx.engine("castFromBar", { tokenId: mage.id, itemId: empty.id, x: pos.x + grid, y: pos.y + grid });
    await pause(2500);
    ctx.expect(!(await ctx.call("list-dialogs", { dialogsOnly: true })).windows?.some(d => (d.buttons ?? []).some(b => b.action === "summon")),
      "4. sans profil : pas de fenêtre « Choisir la forme »");
    let texts = await alertCards(mark);
    ctx.expect(texts.some(t => t.includes(empty.name)), `4. sans profil : carte d'alerte au MJ qui nomme l'objet (${texts.join(" | ") || "aucune"})`);

    // 5. A profile that names no creature, outside CR mode.
    const blank = await lendCopy(PHB, "Familier sans creature", a => ({
      summon: { ...(a.summon ?? {}), mode: "" },
      profiles: (a.profiles ?? []).map(p => ({ ...p, uuid: null }))
    }));
    mark = await ctx.lastMessageId();
    await ctx.engine("castFromBar", { tokenId: mage.id, itemId: blank.id, x: pos.x + grid, y: pos.y + grid });
    await pause(1500);
    form = ((await ctx.call("list-dialogs", { dialogsOnly: true })).windows ?? []).find(d => (d.buttons ?? []).some(b => b.action === "summon"));
    if ( form ) await ctx.call("answer-dialog", { id: form.id, button: "summon" });
    await pause(2500);
    texts = await alertCards(mark);
    ctx.expect(texts.some(t => t.includes(blank.name)), `5. profil sans créature : carte d'alerte au MJ (${texts.join(" | ") || "aucune"})`);
    await closeAll();

    // 6. The player's client.
    const { data: ctok } = await ctx.call("get-scene-object", { type: "Token", objectId: cleric.id });
    const playerPhb = await ctx.ensureItem(cleric, PHB);
    const emptyData = (await ctx.call("get-actor", { actorId: mage.actorId })).items.find(i => i._id === empty.id);
    const { _id: _e, ...emptyItem } = emptyData;
    await ctx.call("upsert-actor-item", { actorId: ctok.actorId, itemData: emptyItem, match: { path: "name", value: empty.name } });
    const playerEmpty = (await ctx.call("get-actor", { actorId: ctok.actorId })).items.find(i => i.name === empty.name)?._id;
    ctx.restore(() => ctx.call("remove-embedded-item", { documentType: "Actor", id: ctok.actorId, itemId: playerEmpty }).catch(() => {}));
    const sceneId = (await ctx.scene()).sceneId;
    const seen = await ctx.asPlayer(`
      const scene = game.scenes.get(args.scene);
      if ( canvas.scene?.id !== scene.id ) { await scene.view(); await new Promise(r => setTimeout(r, 4000)); }
      return { gm: game.user.isGM, canCreate: game.user.can("TOKEN_CREATE"), allow: game.settings.get("dnd5e", "allowSummoning") };`,
      { scene: sceneId });
    if ( !ctx.expect(!seen.gm && seen.canCreate && seen.allow, `6. client joueur qui peut invoquer (${JSON.stringify(seen)})`) ) return;
    const playerCast = (itemId, click) => ctx.asPlayer(`
      const shown = () => [...foundry.applications.instances.values()].filter(w => w.rendered);
      const actor = game.actors.get(args.actor);
      const activity = actor.items.get(args.item).system.activities.find(a => a.type === "summon");
      const notes = [];
      const warn = ui.notifications.warn;
      ui.notifications.warn = function(message, options) { notes.push(String(message)); return warn.call(this, message, options); };
      const before = new Set(shown().map(w => w.id));
      activity.use({ consume: false }, { configure: false }).catch(err => console.error(err));
      let form = null;
      for ( let i = 0; i < 16 && !form; i++ ) {
        await new Promise(r => setTimeout(r, 500));
        // A prepared ritual with a slot left: "as a Ritual" first (§139).
        shown().find(w => w.element?.querySelector?.('button[data-action="pick0"]'))?.element.querySelector('button[data-action="pick0"]').click();
        form = shown().find(w => !before.has(w.id) && w.element?.querySelector?.('button[data-action="summon"]'));
      }
      let browser = null;
      if ( form && args.click ) {
        form.element.querySelector('button[data-action="summon"]').click();
        for ( let i = 0; i < 16 && !browser; i++ ) {
          await new Promise(r => setTimeout(r, 500));
          // The relaunch then asks "as a Ritual or with a slot" (§139, after the form): as a Ritual.
          shown().find(w => w.element?.querySelector?.('button[data-action="pick0"]'))?.element.querySelector('button[data-action="pick0"]').click();
          browser = shown().find(w => w.constructor.name === "CompendiumBrowser");
        }
        await browser?.close();
      } else await form?.close();
      await new Promise(r => setTimeout(r, 1500));
      ui.notifications.warn = warn;
      return { form: !!form, browser: !!browser, notes, user: game.user.name };`,
      { actor: ctok.actorId, item: itemId, click });
    const ok = await playerCast(playerPhb, true);
    ctx.expect(ok.form, "6. barre (joueur) : la fenêtre « Choisir la forme » s'ouvre chez le joueur");
    ctx.expect(ok.browser, "6. puis le navigateur de compendium chez le joueur");
    mark = await ctx.lastMessageId();
    const bad = await playerCast(playerEmpty, false);
    ctx.expect(!bad.form, "6. sans profil (joueur) : pas de fenêtre « Choisir la forme »");
    ctx.expect(bad.notes.some(n => String(n).includes(empty.name)), `6. sans profil : le joueur est averti (${bad.notes.join(" | ") || "rien"})`);
    texts = await alertCards(mark);
    ctx.expect(texts.some(t => t.includes(bad.user) && t.includes(empty.name)), `6. carte d'alerte au MJ qui nomme le joueur (${texts.join(" | ") || "aucune"})`);
  }
};
