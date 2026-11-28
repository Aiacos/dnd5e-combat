/**
 * Walking from one level to another by the ENGINE's path (P2 b, SPEC §14.2) on a scene with levels and staircases
 * (Restored Keep) — like a movement click, through `call-module-api` (connector ≥ 0.28.0) and `api.mcp.move`.
 *  1. Out of combat: the A* goes to a cell of the other level next to a staircase — a single `displace` step on the staircase,
 *     with its height (`climb`), then walking. The token arrives at the planned level and cell, at the plan's elevation,
 *     without the core's "Change Level" dialog (one never enters a staircase by walking), and the GM's view follows.
 *  2. Return to the starting cell, same path in reverse.
 *  2 bis. Click on a staircase cell of its own level (§18.26): the token stops beside it and enters it by walking, the
 *     core opens its "Change Level" dialog, the scenario answers it (connector ≥ 0.29.0: list-dialogs, answer-dialog)
 *     and the token moves to the other level.
 *  3. In combat, placed beside the staircase: a budget one unit under the height leaves the staircase out of budget; with
 *     the turn's budget, the climb passes and its height is noted (`climbed`) and counted as spent.
 * Restores the GM's view on its level; the safety net puts the token back. Without a staircase, not applicable.
 */
const NAMES = ["Paladin", "Guerrier"];
const NEIGHBOURS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];
const MAX_CANDIDATES = 40;

export default {
  scene: "keep",   // §83: floors and staircases, in Restored Keep
  name: "escaliers — l'A* du moteur change de niveau par un escalier",

  async run(ctx) {
    const { levels } = await ctx.call("list-levels", {});
    if ( !(levels?.length > 1) ) { ctx.log("scène à un seul niveau : non applicable"); return; }
    const { tokens } = await ctx.scene();
    const name = NAMES.find(n => tokens.some(t => t.name === n));
    if ( !name ) { ctx.log(`aucun de ${NAMES.join(", ")} sur la scène : non applicable`); return; }
    const walker = await ctx.token(name);
    const levelName = id => levels.find(l => l.id === id)?.name ?? id;

    const start = await ctx.engine("movement", { tokenId: walker.id });
    const home = start.position;
    const initialView = start.viewedLevel;
    if ( initialView ) ctx.restore(() => ctx.engine("view", { levelId: initialView }));
    const size = await ctx.gridSize();
    const centerOf = w => ({ x: w.x + (size / 2), y: w.y + (size / 2) });

    // The staircases that start from the token's level.
    const stairs = (await ctx.engine("stairs", { tokenId: walker.id })).filter(s => s.levels.includes(home.level) && (s.levels.length > 1));
    if ( !stairs.length ) { ctx.log(`aucun escalier au niveau « ${levelName(home.level)} » : non applicable`); return; }

    // A destination: a cell next to a staircase, on the other level, off the staircase, that the A* reaches by going through it.
    let found = null;
    let tried = 0;
    search: for ( const s of stairs ) {
      const inside = new Set(s.cells.map(c => `${c.i},${c.j}`));
      for ( const other of s.levels.filter(l => l !== home.level) ) {
        for ( const c of s.cells ) for ( const [di, dj] of NEIGHBOURS ) {
          const cell = { i: c.i + di, j: c.j + dj };
          if ( inside.has(`${cell.i},${cell.j}`) ) continue;
          if ( ++tried > MAX_CANDIDATES ) break search;
          const plan = await ctx.engine("plan", { tokenId: walker.id, cell, levelId: other, maxCost: 1e9 });
          const index = plan.found ? plan.waypoints.findIndex(w => (w.action === "displace") && w.level) : -1;
          if ( plan.arrives && (index >= 0) && (index < plan.waypoints.length - 1) ) { found = { stairs: s, level: other, cell, plan, index }; break search; }
        }
      }
    }
    if ( !ctx.expect(found, `un chemin vers un autre niveau par un escalier (${tried} case(s) essayée(s))`) ) return;
    const { plan, index, level } = found;
    const change = plan.waypoints[index];
    const last = plan.waypoints.at(-1);
    ctx.log(`destination : case ${found.cell.i},${found.cell.j} au niveau « ${levelName(level)} » par « ${found.stairs.name} », ${plan.waypoints.length} point(s)`);
    ctx.expect(plan.waypoints.filter(w => w.action === "displace").length === 1, "un seul pas `displace` dans le chemin");
    ctx.expect((change.level === level) && (change.climb > 0), `le pas d'escalier change de niveau et porte sa hauteur (climb ${change.climb})`);

    // 1. Aller.
    const there = await ctx.engine("move", { tokenId: walker.id, cell: found.cell, levelId: level });
    ctx.log(`aller : ${there.elapsedMs} ms`);
    ctx.expect(there.after.level === level, `arrivé au niveau « ${levelName(there.after.level)} »`);
    ctx.expect((there.after.x === last.x) && (there.after.y === last.y), `à la case prévue (${there.after.x}, ${there.after.y} ; plan ${last.x}, ${last.y})`);
    if ( last.elevation !== null ) ctx.expect(there.after.elevation === last.elevation, `à l'élévation du plan (${there.after.elevation} ; plan ${last.elevation})`);
    ctx.expect(!there.newWindows.length, `aucun dialogue ouvert${there.newWindows.length ? ` — ${there.newWindows.map(w => w.title ?? w.id).join(", ")}` : ""}`);
    if ( initialView === home.level ) ctx.expect(there.viewedLevel === level, `la vue du MJ suit le token (« ${levelName(there.viewedLevel)} »)`);

    // 2. Retour.
    const back = await ctx.engine("move", { tokenId: walker.id, cell: home.cell, levelId: home.level });
    ctx.log(`retour : ${back.elapsedMs} ms`);
    ctx.expect((back.after.level === home.level) && (back.after.x === home.x) && (back.after.y === home.y), `revenu à la case de départ, niveau « ${levelName(back.after.level)} »`);
    ctx.expect(!back.newWindows.length, "aucun dialogue au retour");

    // 2 bis. §18.26: a click on the staircase of its own level — the token stops beside it then enters it by walking, and the
    // core opens its "Change Level" dialog; we answer it (connector ≥ 0.29.0: list-dialogs, answer-dialog).
    const ownStairs = found.stairs.cells.find(c => (c.i !== home.cell.i) || (c.j !== home.cell.j));
    // §167: the core dialog's id is the same for a given staircase and token ("dialog-<behavior>-<token>") — a dialog
    // left open from a previous pass hid the new one (excluded as "already there"). We first close those that linger.
    for ( const w of (await ctx.call("list-dialogs", { dialogsOnly: true }).catch(() => ({ windows: [] }))).windows ?? [] ) {
      if ( String(w.id).startsWith("dialog-") && /Change Level|Changer de niveau/i.test(w.title ?? "") ) {
        await ctx.call("answer-dialog", { id: w.id, button: "no" }).catch(() => ctx.call("answer-dialog", { id: w.id, close: true }).catch(() => {}));
      }
    }
    const known = (await ctx.call("list-dialogs", {})).windows.map(w => w.id);
    let entering = await ctx.call("call-module-api", { moduleId: "dnd5e-combat", fn: "move", args: { tokenId: walker.id, cell: ownStairs, levelId: home.level }, waitMs: 500 });
    let dialog = null;
    // §167: in slices of 2.5 s — GM window in the background, the browser slows its timers and an 8 s wait
    // overran the connector's 10 s delay ("Timeout en attente de la reponse a list-dialogs"); an isolated exceeded delay stops
    // nothing.
    for ( let n = 0; (n < 12) && !dialog && !entering.settled; n++ ) {
      dialog = (await ctx.call("list-dialogs", { dialogsOnly: true, excludeIds: known, waitMs: 2500 }).catch(() => null))?.windows?.[0] ?? null;
    }
    const levelField = dialog?.fields?.find(f => f.name === "level");
    ctx.expect(!!levelField && levelField.options.some(o => o.value === level), `le cœur ouvre son dialogue « ${dialog?.title ?? "—"} » (niveaux proposés : ${levelField?.options.map(o => o.label).join(", ") ?? "—"})`);
    if ( dialog ) {
      const yes = dialog.buttons.find(b => b.action === "yes");
      const answer = await ctx.call("answer-dialog", { id: dialog.id, ...(levelField?.disabled ? {} : { fields: { level } }), button: "yes" });
      ctx.expect(!answer.stillOpen, `répondu « ${answer.clicked?.label ?? yes?.label} », dialogue fermé`);
    }
    for ( let n = 0; (n < 24) && !entering.settled; n++ ) {
      entering = (await ctx.call("call-module-api", { callId: entering.callId, waitMs: 2500 }).catch(() => null)) ?? entering;
    }
    if ( ctx.expect(entering.settled, "le déplacement s'achève après la réponse") ) {
      // The core changes the level AFTER the step ends (change-level.mjs, `#moveToken`): we wait for it to do so.
      let upstairs = entering.result.after;
      for ( let n = 0; (n < 20) && (upstairs.level !== level); n++ ) {
        await new Promise(r => setTimeout(r, 250));
        upstairs = (await ctx.engine("movement", { tokenId: walker.id })).position;
      }
      ctx.expect(upstairs.level === level, `passé au niveau « ${levelName(upstairs.level)} » par le dialogue du cœur`);
    }

    // 3. In combat, from the cell where the staircase step starts (on the starting level).
    const from = index > 0 ? plan.waypoints[index - 1] : home;
    const placed = await ctx.call("move-token", { tokenId: walker.id, x: from.x, y: from.y, levelId: home.level, elevation: home.elevation });
    if ( initialView ) await ctx.engine("view", { levelId: initialView });
    if ( !ctx.expect(placed.moved, `posé à côté de l'escalier (${from.x}, ${from.y})`) ) return;
    await ctx.startCombat([walker]);
    const fresh = await ctx.engine("movement", { tokenId: walker.id });
    if ( !ctx.expect(fresh.combat, "le token est dans le combat") ) return;
    ctx.log(`vitesse ${fresh.combat.speed} ${fresh.combat.units}, plafond ${fresh.cap}, dépensé ${fresh.combat.spent}`);
    const stairsCell = { point: centerOf(change) };

    const short = await ctx.engine("plan", { tokenId: walker.id, ...stairsCell, levelId: level, maxCost: change.climb - 1 });
    ctx.expect(short.found && !short.arrives && short.beyond.some(w => (w.action === "displace") && (w.level === level)),
      `budget d'une unité sous la hauteur : l'escalier passe hors budget (${short.waypoints?.length ?? 0} point(s) parcourables)`);

    const climb = await ctx.engine("plan", { tokenId: walker.id, ...stairsCell, levelId: level });
    const fits = (fresh.cap === null) || (change.climb <= fresh.cap);
    if ( !fits ) {
      ctx.expect(!climb.arrives, `hauteur ${change.climb} au-delà du plafond du tour ${fresh.cap} : escalier hors budget`);
      return;
    }
    ctx.expect(climb.arrives && (climb.waypoints.at(-1)?.level === level), "avec le budget du tour, la montée passe");
    const up = await ctx.engine("move", { tokenId: walker.id, ...stairsCell, levelId: level });
    ctx.expect(up.after.level === level, `en combat, arrivé au niveau « ${levelName(up.after.level)} »`);
    const spent = await ctx.engine("movement", { tokenId: walker.id });
    const climbed = spent.combat?.climbed ?? 0;
    const want = climb.waypoints.find(w => w.action === "displace")?.climb ?? change.climb;
    ctx.expect(climbed === want, `hauteur notée au budget du tour (climbed ${climbed}, attendu ${want})`);
    ctx.expect((spent.combat?.spent ?? 0) >= climbed, `et comptée comme dépensée (dépensé ${spent.combat?.spent} ${spent.combat?.units})`);
  }
};
