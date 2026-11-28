/**
 * §417: the "Impossible action" setting (`refusalMode`, "Flow" frame) — what an engine refusal becomes, on the GM's side, in
 * the "Refusal Arena" (`node tools/arene-refus.mjs`), an attack or a spell cast from the sheet on the Distant Target (155 ft):
 *  1. `window`: the "out of range" window with "use anyway"; waived, nothing goes off.
 *  2. `strict`: the GM keeps the full window (the player can only waive: to check with `claude player`).
 *  3. `notice`: no window; the Fighter's javelin goes off, the card is marked, ONE GM alert (§416: the roll does not ask again).
 *  4. `off`: no window; the Cleric's Sacred Flame goes off, with no mark or alert.
 * A different caster per step: forcing a range takes it as acknowledged for 60 s per activity and targets
 * (`acknowledge`, runtime/turn.mjs).
 * The setting is restored to its previous value.
 */
const MODULE_ID = "dnd5e-combat";
const PHB = "Compendium.dnd-players-handbook.spells.Item.";
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export default {
  name: "déroulement : action impossible — fenêtre, refus strict, simple avertissement, aucun contrôle",
  scene: "Arène des refus",

  async run(ctx) {
    const mage = await ctx.token("Mage des refus");
    const fighter = await ctx.token("Guerrier des refus");
    const cleric = await ctx.token("Clerc des refus");
    const far = await ctx.token("Cible lointaine des refus");
    const bolt = await ctx.ensureItem(mage, `${PHB}phbsplFireBolt00`);
    const javelin = await ctx.itemId(fighter.id, "javelin").catch(() => null);
    const flame = await ctx.itemId(cleric.id, "sacred-flame").catch(() => null);
    const script = async code => (await ctx.call("run-script", { code }))?.result;

    const before = (await ctx.engine("setting", { key: "refusalMode" }))?.now ?? "level";
    const mode = value => ctx.engine("setting", { key: "refusalMode", value });
    ctx.restore(() => mode(before));

    const legality = async (name, ms=6000) => {
      for ( const stop = Date.now() + ms; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        // The refusal's window, not the "On hit" one (§516, Martial Savagery), which has the same title.
        const d = (r?.windows ?? []).find(w => (w.title ?? "").endsWith(` — ${name}`)
          && (w.buttons ?? []).some(x => ["go", "cancel"].includes(x.action)));
        if ( d ) return d;
      }
      return null;
    };
    ctx.restore(async () => {
      for ( const t of [mage, fighter, cleric] ) {
        const d = await legality(t.name, 300);
        if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" }).catch(() => {});
      }
    });
    /** From the sheet: the target designated, then `activity.use()` with nothing confirmed — the path of a click on the item. */
    const useFromSheet = (token, itemId, type) => script(`const t = canvas.tokens.get("${token.id}");
      canvas.tokens.get("${far.id}").setTarget(true, { releaseOthers: true });
      const activity = t.actor.items.get("${itemId}").system.activities.find(a => a.type === "${type}");
      activity.use(); return true;`);
    const buttonsOf = d => (d?.buttons ?? []).map(b => b.action);
    const alerts = messages => messages.filter(m => m.flags?.[MODULE_ID]?.gmAlert);
    const marked = messages => messages.filter(m => m.flags?.[MODULE_ID]?.overridden?.length);
    const types = messages => messages.map(m => m.type).join(", ") || "aucun message";

    // 1 and 2. The window — everyone's (`window`), the one the GM keeps in strict refusal.
    for ( const value of ["window", "strict"] ) {
      await mode(value);
      const since = await ctx.lastMessageId();
      await useFromSheet(mage, bolt, "attack");
      const d = await legality(mage.name);
      ctx.expect(!!d && buttonsOf(d).includes("go"), `${value} : la fenêtre s'ouvre chez le MJ, avec « utiliser quand même » (${buttonsOf(d).join(", ") || "pas de fenêtre"})`);
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      await pause(1500);
      const after = await ctx.messagesSince(since);
      ctx.expect(!after.length, `${value} : renoncé, rien ne part (${types(after)})`);
    }

    // 3. Simple warning: the action goes off, marked, the GM warned once.
    if ( ctx.expect(!!javelin, "le Guerrier des refus a une javeline") ) {
      await mode("notice");
      const since = await ctx.lastMessageId();
      await useFromSheet(fighter, javelin, "attack");
      const d = await legality(fighter.name, 3000);
      ctx.expect(!d, "notice : aucune fenêtre");
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      // A hit opens the "On hit" window (Martial Savagery, §516): validated, so that the damage goes off.
      for ( const stop = Date.now() + 5000; Date.now() < stop; ) {
        const r = await ctx.call("list-dialogs", { dialogsOnly: true, waitMs: 1000 }).catch(() => null);
        const hit = (r?.windows ?? []).find(w => (w.buttons ?? []).some(x => x.action === "strike"));
        if ( hit ) { await ctx.call("answer-dialog", { id: hit.id, button: "strike" }).catch(() => {}); break; }
      }
      await pause(2000);
      const after = await ctx.messagesSince(since);
      ctx.expect(after.some(m => m.type === "attack"), `notice : l'attaque part (${types(after)})`);
      ctx.expect(marked(after).length > 0, "notice : la carte est marquée « forcé »");
      ctx.expect(alerts(after).length === 1, `notice : une seule alerte MJ (${alerts(after).length})`);
    }

    // 4. No check: the action goes off, nothing is reported.
    if ( ctx.expect(!!flame, "le Clerc des refus a la Flamme sacrée") ) {
      await mode("off");
      const since = await ctx.lastMessageId();
      await useFromSheet(cleric, flame, "save");
      const d = await legality(cleric.name, 3000);
      ctx.expect(!d, "off : aucune fenêtre");
      if ( d ) await ctx.call("answer-dialog", { id: d.id, button: "cancel" });
      await pause(5000);
      const after = await ctx.messagesSince(since);
      ctx.expect(after.some(m => m.type === "usage"), `off : le sort part (${types(after)})`);
      ctx.expect(!marked(after).length && !alerts(after).length, `off : ni marque ni alerte (${marked(after).length} marque(s), ${alerts(after).length} alerte(s))`);
    }
  }
};
