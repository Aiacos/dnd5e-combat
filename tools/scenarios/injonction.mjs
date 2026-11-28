/**
 * Imposed order (SPEC §16.59): the Cleric's Command (added at will), the order fixed in advance on the card
 * (`usageConfig["dnd5e-combat"].order`), Wisdom save replayed until it fails, then a combat: at the start of the target's
 * turn, the order is carried out; at the end of that turn, the effect ends.
 *  - Choice of the order: with no order fixed, the window opens on the author's side; "Halt" chosen, placed.
 *  - Grovel (Zombi): Prone, turn over (no more movement).
 *  - Halt (Zombi): does not move, turn over.
 *  - Approach (Zombi at 4 cells): arrives in contact with the Cleric, turn over.
 *  - Flee (Zombi at 2 cells): moves away from the Cleric. From contact: the Cleric's Opportunity Attack is offered before
 *    the movement, declined ("Do not react"), then the flight resumes.
 *  - Drop (Fighter): its equipped weapon is dropped — a pile on the ground, the weapon leaves the sheet (given back and pile
 *    removed at the end): pile from a neighboring module registered on the hook `dnd5e-combat.dropItems` (§40.3: a region, its
 *    tile — Darsh Loot), otherwise without a neighboring module: unequipped.
 * Restores positions, effects, conditions, equipment and combat.
 */
const MODULE_ID = "dnd5e-combat";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "injonction — Rampe, Halte, Approche, Fuis, Lâche",

  async run(ctx) {
    const { tokens } = await ctx.scene();
    if ( !["Clerc", "Guerrier", "Zombi"].every(n => tokens.some(t => t.name === n)) ) { ctx.log("Clerc, Guerrier ou Zombi absent : non applicable"); return; }
    const cleric = await ctx.token("Clerc");
    const fighter = await ctx.token("Guerrier");
    const zombi = await ctx.token("Zombi");
    const grid = await ctx.gridSize();
    await ctx.ensureItem(cleric, "Compendium.dnd5e.spells24.Item.phbsplCommand000", { system: { method: "atwill" } });
    const all = [cleric, fighter, zombi];
    const home = new Map();
    const effects0 = new Map();
    for ( const t of all ) { home.set(t.id, await ctx.position(t)); effects0.set(t.id, new Set((await ctx.effects(t)).map(e => e._id ?? e.id))); }
    const fighterItems = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
    const equipped0 = fighterItems.filter(i => i.system?.equipped === true).map(i => i._id);
    const targetOf = async t => {
      const { data } = await ctx.call("get-scene-object", { type: "Token", objectId: t.id });
      const sceneId = (await ctx.scene()).sceneId;
      return data.actorLink ? { documentType: "Actor", id: data.actorId } : { uuid: `Scene.${sceneId}.Token.${t.id}.Actor.${data.actorId}` };
    };
    const reset = async () => {
      if ( ctx.ownCombat ) { await ctx.call("end-combat", { combatId: ctx.ownCombat }).catch(() => {}); ctx.ownCombat = null; }
      for ( const t of all ) {
        const target = await targetOf(t);
        for ( const e of (await ctx.effects(t)).filter(e => !effects0.get(t.id).has(e._id ?? e.id) && !e.flags?.["dnd5e-combat"]?.aura) ) {
          await ctx.call("remove-embedded-effect", { ...target, effectId: e._id ?? e.id }).catch(() => {});
        }
        const h = home.get(t.id);
        const now = await ctx.position(t);
        if ( (now.x !== h.x) || (now.y !== h.y) ) await ctx.call("move-token", { tokenId: t.id, x: h.x, y: h.y, elevation: h.elevation }).catch(() => {});
      }
      for ( const id of equipped0 ) await ctx.call("upsert-actor-item", { actorId: fighter.actorId, match: { path: "_id", value: id }, itemData: { system: { equipped: true } } }).catch(() => {});
      await pause(1000);
    };
    ctx.restore(reset);
    const part = async (label, fn) => {
      try { await fn(); }
      catch(err) { ctx.expect(false, `${label} : ${err.message}`); }
      finally { await reset(); }
    };
    const gap = async (a, b) => {
      const pa = await ctx.position(a);
      const pb = await ctx.position(b);
      return Math.max(Math.abs(pa.x - pb.x), Math.abs(pa.y - pb.y)) / grid - 1;   // tokens d'une case
    };
    // Restored Keep (`dnd-6`), column x = 3080: the Cleric at 4900, and to the south up to 5460 four cells free of walls and
    // tokens (survey from the `poussee` scenario). The scenario was checked on 2026-09-27 on the Mac (`dnd-test-module-combat`),
    // where the Zombi was placed east of the Cleric; here, east of the Cleric, a wall and a door separate it from them
    // (seen on 2026-09-28).
    const anchor = { x: 3080, y: 4900, elevation: 0 };
    const place = async (t, dx, dy) => {
      const c = await ctx.position(cleric);
      if ( (c.x !== anchor.x) || (c.y !== anchor.y) ) await ctx.call("move-token", { tokenId: cleric.id, ...anchor });
      await ctx.call("move-token", { tokenId: t.id, x: anchor.x + (dx * grid), y: anchor.y + (dy * grid), elevation: anchor.elevation });
      await pause(1000);
    };
    /** Command until a failed save, the order fixed; returns true if the effect is placed. */
    const command = async (target, order) => {
      for ( let n = 1; n <= 20; n++ ) {
        const used = await ctx.use({ tokenId: cleric.id, identifier: "command", activityType: "save", consume: false,
          targetTokenIds: [target.id], usageConfig: { [MODULE_ID]: { order } } });
        await ctx.settle(used.usageMessageId).catch(() => null);
        await pause(2000);
        if ( (await ctx.effects(target)).some(e => e.flags?.[MODULE_ID]?.order) ) return true;
      }
      return false;
    };
    /** A combat Cleric (20) then the target (10); we move to the target's turn. */
    const toTurnOf = async target => {
      await ctx.startCombat([cleric, target]);
      const c = await ctx.combat();
      for ( const [t, value] of [[cleric, 20], [target, 10]] ) {
        const cb = (c.combatants ?? []).find(x => (x.tokenId === t.id) || (x.name === t.name));
        if ( cb ) await ctx.call("set-initiative", { combatId: ctx.ownCombat, combatantId: cb.id, value });
      }
      const now = await ctx.combat();
      if ( (now.combatants ?? []).find(x => x.isCurrent || x.current)?.name !== cleric.name ) await ctx.nextTurn();
      await pause(800);
      ctx.since = await ctx.lastMessageId();
      await ctx.nextTurn();
      await pause(1500);
    };
    /** Waits for the target's "obéit" message (the order carried out to the end), 20 s at most. */
    const obeyed = async target => {
      for ( let n = 0; n < 40; n++ ) {
        const { messages } = await ctx.call("list-chat-messages", { limit: 20, ...(ctx.since ? { sinceId: ctx.since } : {}) });
        if ( (messages ?? []).some(m => (m.alias === target.name) && /obéit|obeys/i.test(m.text ?? m.content ?? "")) ) return true;
        await pause(500);
      }
      return false;
    };
    const movement = t => ctx.engine("movement", { tokenId: t.id });
    const stopped = m => !!m?.combat && Number.isFinite(m.cap) && (m.cap <= (m.combat.spent ?? 0) + 1e-6);
    const statuses = async t => (await ctx.effects(t)).flatMap(e => e.statuses ?? []);

    await part("Choix de l'ordre", async () => {
      // With no order fixed in advance: on the failed save, the "Which order to give?" window opens on the author's side (the GM
      // here); the scenario chooses "Halt" (connector: list-dialogs, answer-dialog).
      await place(zombi, 0, 3);
      let posed = null;
      for ( let n = 1; (n <= 20) && !posed; n++ ) {
        const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
        const used = await ctx.use({ tokenId: cleric.id, identifier: "command", activityType: "save", consume: false, targetTokenIds: [zombi.id] });
        const r = await ctx.settle(used.usageMessageId).catch(() => null);
        if ( r?.targets?.find(t => t.name === "Zombi")?.save?.success !== false ) continue;
        const dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 8000 })).windows[0] ?? null;
        if ( !ctx.expect(!!dialog, `la fenêtre du choix de l'ordre s'ouvre (${dialog?.title ?? "aucune"} : ${(dialog?.buttons ?? []).map(b => b.label).join(", ")})`) ) return;
        const halt = (dialog.buttons ?? []).find(b => /Halte|Halt/.test(b.label ?? ""));
        await ctx.call("answer-dialog", { id: dialog.id, button: halt?.action ?? halt?.label });
        await pause(2000);
        posed = (await ctx.effects(zombi)).find(e => e.flags?.[MODULE_ID]?.order);
      }
      ctx.expect(posed?.flags?.[MODULE_ID]?.order?.order === "halt", `l'ordre choisi est posé (${posed?.name ?? "aucun"})`);
    });
    await part("Rampe", async () => {
      await place(zombi, 0, 3);
      if ( !ctx.expect(await command(zombi, "grovel"), "Rampe : le Zombi rate sa sauvegarde, l'ordre est posé") ) return;
      await toTurnOf(zombi);
      ctx.expect(await obeyed(zombi), "Rampe : le Zombi obéit à son tour (message)");
      ctx.expect((await statuses(zombi)).includes("prone"), "Rampe : le Zombi est À terre à son tour");
      ctx.expect(stopped(await movement(zombi)), "Rampe : son tour s'achève (plus de déplacement)");
      await ctx.nextTurn();
      await pause(2500);
      ctx.expect(!(await ctx.effects(zombi)).some(e => e.flags?.[MODULE_ID]?.order), "l'effet de l'ordre tombe à la fin de son tour");
    });
    await part("Halte", async () => {
      await place(zombi, 0, 3);
      if ( !ctx.expect(await command(zombi, "halt"), "Halte : l'ordre est posé") ) return;
      const before = await ctx.position(zombi);
      await toTurnOf(zombi);
      await obeyed(zombi);
      const after = await ctx.position(zombi);
      ctx.expect((after.x === before.x) && (after.y === before.y) && stopped(await movement(zombi)), "Halte : le Zombi ne bouge pas, tour achevé");
    });
    await part("Approche", async () => {
      await place(zombi, 0, 4);
      if ( !ctx.expect(await command(zombi, "approach"), "Approche : l'ordre est posé") ) return;
      await toTurnOf(zombi);
      await obeyed(zombi);
      const g = await gap(zombi, cleric);
      ctx.expect(g === 0, `Approche : le Zombi arrive au contact du Clerc (écart ${g} case(s))`);
      ctx.expect(stopped(await movement(zombi)), "Approche : arrivé au contact, son tour s'achève");
    });
    await part("Fuis", async () => {
      await place(zombi, 0, 2);
      if ( !ctx.expect(await command(zombi, "flee"), "Fuis : l'ordre est posé") ) return;
      const g0 = await gap(zombi, cleric);
      await toTurnOf(zombi);
      await obeyed(zombi);
      const g1 = await gap(zombi, cleric);
      ctx.expect(g1 >= g0 + 2, `Fuis : le Zombi s'éloigne du Clerc (écart ${g0} → ${g1} cases)`);
    });
    await part("Fuis depuis le contact", async () => {
      // Leaving the Cleric's reach provokes their Opportunity Attack, offered BEFORE the movement (window on the GM's side); the
      // scenario answers "do not react" (connector: list-dialogs, answer-dialog), then the flight resumes.
      await place(zombi, 0, 1);
      if ( !ctx.expect(await command(zombi, "flee"), "Fuis (au contact) : l'ordre est posé") ) return;
      const g0 = await gap(zombi, cleric);
      const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
      await toTurnOf(zombi);
      let dialog = null;
      for ( let n = 0; (n < 3) && !dialog; n++ ) dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 5000 })).windows[0] ?? null;
      if ( !ctx.expect(!!dialog, `attaque d'opportunité du Clerc proposée (${dialog?.title ?? "aucune fenêtre"})`) ) return;
      const decline = (dialog.buttons ?? []).find(b => !/^use/.test(b.action ?? "")) ?? dialog.buttons?.at(-1);
      await ctx.call("answer-dialog", { id: dialog.id, button: decline?.action ?? decline?.label });
      let g1 = g0;
      await obeyed(zombi);
      g1 = await gap(zombi, cleric);
      ctx.expect(g1 >= g0 + 2, `Fuis (au contact) : refusée l'attaque d'opportunité (« ${decline?.label} »), le Zombi s'éloigne (écart ${g0} → ${g1} cases)`);
    });
    await part("Lâche", async () => {
      await place(fighter, 2, 0);
      const held = fighterItems.filter(i => (i.system?.equipped === true) && (i.type === "weapon") && (i.system?.type?.value !== "natural"));
      if ( !ctx.expect(held.length > 0, `le Guerrier tient une arme (${held.map(i => i.name).join(", ")})`) ) return;
      // The lists re-read each time (`ctx.scene()` keeps the one from the start of the scenario: a pile created afterwards is not
      // in it). A pile is a region and its tile (neighboring module, hook `dnd5e-combat.dropItems`, §40.3).
      const KINDS = ["Token", "Region", "Tile"];
      const sceneObjects = async () => (await ctx.call("list-scene-objects", { types: KINDS })).objects ?? {};
      const before = await sceneObjects();
      const known = Object.fromEntries(KINDS.map(k => [k, new Set((before[k] ?? []).map(o => o.id))]));
      const created = async () => {
        const now = await sceneObjects();
        return Object.fromEntries(KINDS.map(k => [k, (now[k] ?? []).filter(o => !known[k].has(o.id))]));
      };
      // The weapon leaves the sheet for a pile: we will give it back, and remove the pile (the region first: its chest leaves
      // with it).
      ctx.restore(async () => {
        for ( const kind of ["Token", "Region", "Tile"] ) {
          for ( const o of (await created())[kind] ) await ctx.call("delete-scene-object", { type: kind, objectId: o.id }).catch(() => {});
          await pause(500);
        }
        const items = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
        // Under its original identifier: the safety net removes the items it did not know.
        for ( const h of held ) {
          if ( items.some(i => i._id === h._id) ) continue;
          const { folder, ownership, _stats, ...itemData } = h;
          itemData.system = { ...itemData.system, equipped: true };
          await ctx.engine("restoreItem", { actorId: fighter.actorId, itemData }).catch(err => ctx.log(`arme non rendue : ${err.message}`));
        }
      });
      if ( !ctx.expect(await command(fighter, "drop"), "Lâche : le Guerrier rate sa sauvegarde, l'ordre est posé") ) return;
      await toTurnOf(fighter);
      await obeyed(fighter);
      await pause(1500);   // a neighboring module's pile is placed item by item
      const items = (await ctx.call("get-actor", { actorId: fighter.actorId })).items ?? [];
      const still = held.filter(h => items.find(i => i._id === h._id)?.system?.equipped === true);
      ctx.expect(!still.length, `Lâche : plus rien en main (${held.map(i => i.name).join(", ")} lâché)`);
      ctx.expect(stopped(await movement(fighter)), "Lâche : son tour s'achève");
      const made = await created();
      const gone = held.every(h => !items.some(i => i._id === h._id));
      // Where the Zombi must be able to stop: the pile's cell (no obstacle, no occupied cell, §16.60).
      const zombiCanStopAt = async point => {
        // The Fighter steps aside (the pile is placed on their cell).
        const f = await ctx.position(fighter);
        await ctx.call("move-token", { tokenId: fighter.id, x: f.x, y: f.y + grid, elevation: f.elevation });
        await pause(1200);
        const p = await ctx.engine("plan", { tokenId: zombi.id, point, maxCost: 1000 });
        ctx.expect(p.found && p.arrives, `le Zombi peut s'arrêter sur la case du tas (chemin ${p.found ? (p.arrives ? "jusqu'au bout" : "incomplet") : "introuvable"})`);
      };
      if ( made.Region.length ) {
        // Neighboring module (§40.3): a region smaller than a cell, in the Fighter's cell, and its tile.
        ctx.expect((made.Region.length === 1) && !made.Token.length, `module voisin : un tas posé au sol (${made.Region.map(r => r.name).join(", ")})`);
        ctx.expect(gone, "module voisin : l'arme a quitté la fiche du Guerrier");
        const { data } = await ctx.call("get-scene-object", { type: "Region", objectId: made.Region[0].id });
        const shape = data.shapes?.[0] ?? {};
        const f = await ctx.position(fighter);
        const inside = (shape.x >= f.x) && (shape.y >= f.y) && ((shape.x + shape.width) <= f.x + grid) && ((shape.y + shape.height) <= f.y + grid);
        ctx.expect((shape.width < grid) && (shape.height < grid) && inside, `le tas est petit, dans la case du Guerrier (${shape.width}×${shape.height} px en ${shape.x} × ${shape.y})`);
        ctx.expect(made.Tile.length === 1, `le tas a sa tuile (${made.Tile.length})`);
        await zombiCanStopAt({ x: shape.x + 1, y: shape.y + 1 });
      } else ctx.log("aucun module ne pose de tas : l'arme est déséquipée, restée dans l'inventaire");
    });
  }
};
