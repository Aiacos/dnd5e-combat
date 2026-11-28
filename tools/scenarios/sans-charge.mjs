/**
 * §77: the Dretch's Fetid Cloud (Monster Manual 2024) and the GM's cast without a charge. The world's Dretch (`mmDretch00000000`,
 * imported from the compendium) is placed for the scenario in contact with a scene token (the "target"), in combat.
 *  - 1st use: the item's 1/day charge is spent (the premium data looked for it on the activity: refused);
 *    each creature within 3 m makes its Constitution saving throw;
 *  - no charge left: the legality window (forceable refusal, §410: it replaced the GM's former "No more charge") opens —
 *    "Give up" uses nothing, "Use anyway" casts without consuming anything;
 *  - the target Poisoned by the cloud, until the end of its next turn (`targetEnd`: the data said the core's "1 turn"): no more
 *    Reaction; its action taken, no more Bonus Action.
 */
const DRETCH = "mmDretch00000000";
const ITEM = "mmFetidCloud0000";
const MODULE_ID = "dnd5e-combat";
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default {
  name: "sans charge — Nuage fétide du Dretch, le MJ lance quand même",

  async run(ctx) {
    // Absent from `dnd-6`: imported under the id of its sheet (Monster Manual 2024, otherwise SRD 2024), removed at the end.
    await ctx.ensureActor(DRETCH);
    const dretch = await ctx.call("get-actor", { actorId: DRETCH }).catch(() => null);
    if ( !dretch?.items?.some(i => i._id === ITEM) ) { ctx.log("pas de Dretch du Monster Manual dans le monde : non applicable"); return; }
    const { tokens } = await ctx.scene();
    let ref = null;
    for ( const t of tokens.filter(t => t.actorId !== DRETCH) ) {
      const a = await ctx.call("get-actor", { actorId: t.actorId }).catch(() => null);
      if ( (a?.type === "npc") && a.items.some(i => Object.values(i.system?.activities ?? {}).some(x => x.type === "attack")) ) { ref = t; break; }
    }
    if ( !ref ) { ctx.log("aucun PNJ avec une attaque sur la scène : non applicable"); return; }
    const target = await ctx.token(ref.name);
    await ctx.setHp(target, 300);
    const grid = await ctx.gridSize();
    const at = await ctx.position(target);
    const before = new Set((await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.map(t => t.id));
    await ctx.call("place-token", { actorId: DRETCH, x: at.x + grid, y: at.y });
    const placed = (await ctx.call("list-scene-objects", { types: ["Token"] })).objects.Token.find(t => !before.has(t.id));
    ctx.restore(() => ctx.call("delete-scene-object", { type: "Token", objectId: placed.id }).catch(() => {}));
    await ctx.call("update-scene-object", { type: "Token", objectId: placed.id, data: { disposition: -1 } });
    await sleep(800);
    await ctx.startCombat([{ ...placed, actorId: placed.actorId ?? DRETCH }, target]);

    const saves = async since => (await ctx.messagesSince(since)).filter(m => /Constitution/i.test(m.flavor ?? ""));
    // Through the engine's test API (`activity.use`, resources spent): the gesture of a click — the connector's `use-activity`
    // does not place the area on self.
    // `legal`: without the test function's automatic confirmation (`confirmed: true`, which skips the legality window where
    // §410 put "no more uses") — the gesture of a real click, for casts without a charge.
    const cloud = (legal=false) => ctx.call("call-module-api", { moduleId: MODULE_ID, fn: "use", args: { tokenId: placed.id, itemId: ITEM, activityType: "save", consume: true,
      ...(legal ? { extra: { confirmed: false } } : {}) }, waitMs: 1500 }).catch(e => ({ error: e.message }));
    const warning = async known => {
      for ( let k = 0; k < 12; k++ ) {
        await sleep(400);
        // §410: the legality window, titled "… — <token>" (the former "No more charge" talked about charge).
        const w = (await ctx.call("list-dialogs", {})).windows.find(x => !known.includes(x.id)
          && (String(x.title ?? "").endsWith(` — ${placed.name}`) || /charge/i.test(`${x.title} ${JSON.stringify(x.buttons ?? [])}`)));
        if ( w ) return w;
      }
      return null;
    };
    /** This window's button: by its text, otherwise by its action (`go` / `cancel` of the legality window). */
    const pick = (w, label, action) => (w.buttons ?? []).find(b => label.test(b.label ?? ""))?.action ?? action;
    const dialogs = async () => (await ctx.call("list-dialogs", {})).windows.map(w => w.id);

    // 1. La charge de l'item.
    let known = await dialogs();
    let since = await ctx.lastMessageId();
    await cloud();
    await sleep(3500);
    let w = await warning(known);
    if ( w ) {
      ctx.log("le Dretch du monde avait déjà dépensé sa charge : lancé quand même pour la suite");
      await ctx.call("answer-dialog", { id: w.id, button: pick(w, /quand même|anyway/i, "go") });
      await sleep(3500);
    }
    else ctx.expect((await saves(since)).length > 0, `1re utilisation : la charge de l'item est dépensée, sauvegardes de Constitution (${(await saves(since)).length})`);
    ctx.log((await ctx.engineLog()).filter(l => /utilisations de l'activité|activity's uses|charge/.test(l)).slice(-2).join(" / "));

    // 2. No more charge: "Give up".
    known = await dialogs();
    since = await ctx.lastMessageId();
    await cloud(true);
    w = await warning(known);
    if ( !ctx.expect(!!w, "plus de charge : la fenêtre de légalité s'ouvre (« Utiliser quand même »)") ) return;
    await ctx.call("answer-dialog", { id: w.id, button: pick(w, /Renoncer|Cancel/i, "cancel") });
    await sleep(2500);
    ctx.expect(!(await saves(since)).length, "« Renoncer » : rien n'est lancé");

    // 3. "Cast anyway", until the target fails (20 tries at most).
    let poisoned = null;
    for ( let n = 0; (n < 20) && !poisoned; n++ ) {
      known = await dialogs();
      since = await ctx.lastMessageId();
      await cloud(true);
      w = await warning(known);
      if ( !ctx.expect(!!w, `essai ${n + 1} : la fenêtre revient (rien n'a été consommé)`) ) return;
      await ctx.call("answer-dialog", { id: w.id, button: pick(w, /quand même|anyway/i, "go") });
      await sleep(4000);
      if ( n === 0 ) ctx.expect((await saves(since)).length > 0, "« Lancer quand même » : les sauvegardes sont jetées");
      poisoned = (await ctx.effects(target)).find(e => /Empoisonn|Poison/i.test(e.name));
    }
    if ( !ctx.expect(!!poisoned, `la cible rate et est Empoisonnée (${poisoned?.name})`) ) return;
    // In combat, the engine itself keeps the end of turn (runtime/cantrips.mjs: `placedOn`, core duration replaced, §42.2).
    const engineEnd = !!poisoned.flags?.["dnd5e-combat"]?.placedOn;
    ctx.expect((poisoned.duration?.expiry === "targetEnd") || engineEnd,
      `jusqu'à la fin de son tour suivant (${JSON.stringify(poisoned.duration ?? {})}${engineEnd ? ", fin de tour tenue par le moteur" : ""})`);

    // 4. Poisoned by the cloud: no Reaction, no Bonus Action after its action.
    const ta = await ctx.call("get-actor", { actorId: target.actorId });
    const weapon = ta.items.find(i => Object.values(i.system?.activities ?? {}).some(a => a.type === "attack"));
    const api = async (fn, args) => (await ctx.call("call-module-api", { moduleId: MODULE_ID, fn, args, waitMs: 5000 })).result;
    const react = await api("issues", { tokenId: target.id, itemId: weapon._id, activityType: "attack", cost: "reaction" });
    ctx.expect(react.some(l => /Réaction|Reaction/.test(l)), `plus de Réaction (${react.join(" | ")})`);
    await ctx.use({ tokenId: target.id, itemId: weapon._id, activityType: "attack", targetTokenIds: [placed.id], usageConfig: { [MODULE_ID]: { autoReact: "none", confirmed: true } } }).catch(() => null);
    await sleep(3000);
    const bonus = await api("issues", { tokenId: target.id, itemId: weapon._id, activityType: "attack", cost: "bonus" });
    ctx.expect(bonus.some(l => /pas les deux|not both/.test(l)), `son action prise : plus d'action Bonus (${bonus.join(" | ")})`);
  }
};
