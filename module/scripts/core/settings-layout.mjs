/**
 * The layout of the "DAS · Core" settings window (2026-10-18, mockup approved by the user: prive/maquettes/): the tabs,
 * the settings they hold and the tools they open. Settings keep their original key and registration — the
 * window only shows them; a visible setting that is not placed anywhere falls into the last tab (`placeSettings`).
 *
 * Pure: no dependency on Foundry.
 */

/**
 * A group of settings for one rule (user's request, 2026-11-06, mockup approved: one frame per rule, always open,
 * the options of a rule indented under it and greyed out while the rule is off). `tag`: a discreet label to the right of the title
 * (`house`: house rule, `dmg`: Dungeon Master's Guide aid); `sub`: key → `{ parent, off }`, the option greyed out when the value of
 * `parent` is one of `off`. Label: `DND5ECOMBAT.Reglages.Groupe.<id>`.
 */
const g = (id, icon, keys, { tag=null, sub={} }={}) => ({ id, icon, keys, ...(tag ? { tag } : {}), sub });
const offIf = (parent, ...off) => ({ parent, off });

/** The tabs, in order. `tools`: the windows that a button of the tab opens (GM only); `groups`: the frames. */
export const SETTINGS_TABS = Object.freeze([
  { id: "general", icon: "fa-solid fa-dragon", keys: ["automationLevel", "refusalMode", "reactionPrompts", "damageFlow", "theaterOfMind", "etherealPlane", "provideBasicActions", "autoUsage", "autoTranslate", "dataFixes", "realTimeClock", "groupRollSeconds", "inlineChecksEngine", "combatLaunchButton", "sidebarButton"],
    groups: [
      g("automation", "fa-solid fa-gauge", ["automationLevel", "theaterOfMind", "autoUsage", "provideBasicActions"]),
      g("flow", "fa-solid fa-sliders", ["refusalMode", "reactionPrompts", "damageFlow"]),   // §417: how the engine proceeds — refusal (then reactions, damage)
      g("ethereal", "fa-solid fa-ghost", ["etherealPlane"]),
      g("data", "fa-solid fa-language", ["autoTranslate", "dataFixes"]),
      g("time", "fa-solid fa-clock", ["realTimeClock"]),
      g("groupRoll", "fa-solid fa-dice-d20", ["groupRollSeconds", "inlineChecksEngine", "combatLaunchButton"]),
      g("interface", "fa-solid fa-window-maximize", ["sidebarButton"])
    ],
    tools: [{ id: "welcome", icon: "fa-solid fa-dragon" }, { id: "releaseNotes", icon: "fa-solid fa-bullhorn" }, { id: "diagnostic", icon: "fa-solid fa-stethoscope" },
      { id: "reports", icon: "fa-solid fa-flag" }, { id: "debugReport", icon: "fa-solid fa-bug", everyone: true }] },
  { id: "combat", icon: "fa-solid fa-shield-halved",
    keys: ["heroicInspiration", "skipDefeatedNpcs", "cover", "flanking", "flankingSide", "flankingConga", "aurasOnlyInCombat", "zoneChoice", "areaVisibility", "npcSaveChoice", "legendaryResistance", "portent", "combatWindowUnlimited", "combatWindowSeconds",
      "critMargin", "criticalMode", "criticalTable", "criticalNpc", "successAtCost", "successAtCostHold", "masteryRules", "sneakAttackMode", "savageAttackerMode", "potionHealing", "nonLethalMenu", "endUnaffected", "somaticHands"],
    groups: [
      g("combatGeneral", "fa-solid fa-shield-halved", ["skipDefeatedNpcs", "aurasOnlyInCombat", "zoneChoice", "areaVisibility", "endUnaffected", "combatWindowUnlimited", "combatWindowSeconds"],
        { sub: { combatWindowSeconds: offIf("combatWindowUnlimited", true) } }),
      g("cover", "fa-solid fa-block-brick", ["cover"]),
      g("flanking", "fa-solid fa-people-arrows", ["flanking", "flankingSide", "flankingConga"],
        { tag: "house", sub: { flankingSide: offIf("flanking", "off"), flankingConga: offIf("flanking", "off") } }),
      g("gmCreatures", "fa-solid fa-crown", ["npcSaveChoice", "legendaryResistance"]),
      g("criticals", "fa-solid fa-burst", ["critMargin", "criticalMode", "criticalTable", "criticalNpc"],
        { tag: "house", sub: { criticalTable: offIf("criticalMode", "standard"), criticalNpc: offIf("criticalMode", "standard") } }),
      g("successAtCost", "fa-solid fa-scale-balanced", ["successAtCost", "successAtCostHold"],
        { tag: "dmg", sub: { successAtCostHold: offIf("successAtCost", false) } }),
      g("weapons", "fa-solid fa-khanda", ["masteryRules", "sneakAttackMode", "savageAttackerMode", "nonLethalMenu"]),
      g("spellcasting", "fa-solid fa-hand-sparkles", ["somaticHands"]),   // §409
      g("potions", "fa-solid fa-flask", ["potionHealing"], { tag: "house" }),   // issue #31
      g("rollAids", "fa-solid fa-star", ["portent", "heroicInspiration"])
    ] },
  { id: "movement", icon: "fa-solid fa-shoe-prints",
    keys: ["climbSystem", "climbSystemButton", "altitude", "climbRules", "autoFall", "highJumpMenu", "fireSpread", "volumes", "clickToMove",
      "pathPreview", "teleportPlanning", "lockFailure", "grateWalls"],
    groups: [
      g("climb", "fa-solid fa-person-hiking", ["climbSystem", "climbSystemButton", "climbRules", "autoFall", "highJumpMenu"],
        { sub: { climbRules: offIf("climbSystem", false), autoFall: offIf("climbSystem", false), highJumpMenu: offIf("climbSystem", false) } }),
      g("height", "fa-solid fa-arrows-up-down", ["altitude", "volumes"]),
      g("mouseMove", "fa-solid fa-route", ["clickToMove", "pathPreview", "teleportPlanning"]),
      g("fire", "fa-solid fa-fire", ["fireSpread"], { tag: "house" }),
      g("doors", "fa-solid fa-door-closed", ["lockFailure", "grateWalls"])   // §476 : murs grilles
    ] },
  { id: "vision", icon: "fa-solid fa-eye",
    keys: ["vision", "passivePerception", "twilightDarkness", "unconsciousSenses", "hearingRange", "anonymousLocated", "visionCones", "coneAngles", "stealthRules", "surpriseFromStealth", "factionRules", "factionIcons",
      "lightIndicator"],
    groups: [
      g("sight", "fa-solid fa-eye", ["vision", "passivePerception", "twilightDarkness", "unconsciousSenses", "hearingRange", "anonymousLocated", "lightIndicator"]),
      g("cones", "fa-solid fa-binoculars", ["visionCones", "coneAngles"], { sub: { coneAngles: offIf("visionCones", false) } }),
      g("stealth", "fa-solid fa-user-ninja", ["stealthRules", "surpriseFromStealth"]),
      g("factions", "fa-solid fa-flag", ["factionRules", "factionIcons"])
    ],
    tools: [{ id: "factions", icon: "fa-solid fa-flag" }] },
  { id: "mouse", icon: "fa-solid fa-crosshairs",
    keys: ["clickToAttack", "targetingMode", "fastAttack", "quickRolls", "ammoPrompt", "releaseTargets", "situationalCursor", "targetingBanner",
      "closeSheetOnUse", "hitChance", "hitChancePlayers", "coverPreview", "attackLine", "attackLineMelee"],
    groups: [
      g("clickAttack", "fa-solid fa-hand-pointer", ["clickToAttack", "fastAttack", "quickRolls", "ammoPrompt"]),
      g("targeting", "fa-solid fa-crosshairs", ["targetingMode", "releaseTargets", "targetingBanner", "situationalCursor"]),
      g("hitChance", "fa-solid fa-percent", ["hitChance", "hitChancePlayers", "coverPreview", "attackLine", "attackLineMelee"]),
      g("sheet", "fa-solid fa-id-card", ["closeSheetOnUse"])
    ] },
  { id: "chat", icon: "fa-solid fa-comments",
    keys: ["chatLight", "chatCompact", "chatRows", "chatPurgeMax", "chatPurgeKeep", "syncAnimations", "animationWait", "gmAlerts", "gmAlertBanner", "gmAlertSeconds", "forcedAlerts", "overrideVisibility"],
    groups: [
      g("cards", "fa-solid fa-message", ["chatLight", "chatCompact", "chatRows"]),
      g("purge", "fa-solid fa-broom", ["chatPurgeMax", "chatPurgeKeep"]),
      g("animations", "fa-solid fa-wand-sparkles", ["syncAnimations", "animationWait"], { sub: { animationWait: offIf("syncAnimations", false) } }),
      g("gmAlerts", "fa-solid fa-triangle-exclamation", ["gmAlerts", "gmAlertBanner", "gmAlertSeconds", "forcedAlerts", "overrideVisibility"],
        { sub: { gmAlertBanner: offIf("gmAlerts", false), gmAlertSeconds: offIf("gmAlertBanner", false), forcedAlerts: offIf("gmAlerts", false) } })
    ] },
  // §228: the texts that scroll over tokens — pace, then what is displayed.
  { id: "float", icon: "fa-solid fa-comment-dots",
    // §400: the table's switch (turns off the system's texts), and the imported theme's window.
    tools: [{ id: "floatTheme", icon: "fa-solid fa-palette" }],
    keys: ["floatSystem", "feedbackText", "floatSounds", "floatSoundVolume", "floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons",
      "timerHideSeconds", "awaitingShow", "awaitingGm", "awaitingHide", "floatAttacks", "floatHits", "floatAdvantage", "floatSaves", "floatChecks", "floatCover", "floatReactions", "floatStrikes", "floatEffects", "floatResources", "floatPrompts", "floatInitiative"],
    groups: [
      g("floatLook", "fa-solid fa-sliders", ["floatSystem", "feedbackText", "floatSounds", "floatSoundVolume", "floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons"],
        { sub: Object.fromEntries(["floatDuration", "floatSpacing", "floatDistance", "floatDirection", "floatScale", "floatDice", "floatIcons"]
          .map(k => [k, offIf("feedbackText", false)])) }),
      g("floatWhat", "fa-solid fa-list-check", ["floatAttacks", "floatHits", "floatAdvantage", "floatSaves", "floatChecks", "floatCover", "floatReactions",
        "floatStrikes", "floatEffects", "floatResources", "floatPrompts", "floatInitiative"]),
      g("timers", "fa-solid fa-gear", ["timerHideSeconds"]),
      // §381 (issue #35): the hourglass above the token being waited for.
      g("awaiting", "fa-solid fa-hourglass-half", ["awaitingShow", "awaitingGm", "awaitingHide"],
        { sub: { awaitingGm: offIf("awaitingShow", false) } })
    ] },
  { id: "advanced", icon: "fa-solid fa-gears", keys: ["perfWarnMs", "automationBadges", "debugCapture", "debugAllModules", "debugNotify", "debugMenu", "connectionTest"] }
]);

/**
 * The frames of a tab for these settings (already filtered: present, visible, of one scope): each group with its present keys, in
 * the group's order; what no group holds, in a last `other` frame. A tab without `groups`: a single frame without a title
 * (`id: null`), as before. Empty frames are omitted.
 * @param {string[]} keys
 * @param {Array<{id: string, keys: string[]}>|undefined} groups
 * @returns {Array<{id: string|null, icon?: string, tag?: string, sub: object, keys: string[]}>}
 */
export function groupSettings(keys, groups) {
  if ( !groups?.length ) return keys.length ? [{ id: null, sub: {}, keys: [...keys] }] : [];
  const present = new Set(keys);
  const placed = new Set();
  const out = [];
  for ( const group of groups ) {
    const own = (group.keys ?? []).filter(k => present.has(k) && !placed.has(k));
    own.forEach(k => placed.add(k));
    if ( own.length ) out.push({ ...group, sub: group.sub ?? {}, keys: own });
  }
  const rest = keys.filter(k => !placed.has(k));
  if ( rest.length ) out.push({ id: "other", icon: "fa-solid fa-ellipsis", sub: {}, keys: rest });
  return out;
}

/**
 * An option of a rule: `{ sub, off }` — `sub`: it is placed under its rule (its rule is in the same frame, before it); `off`:
 * greyed out, the rule being off (`valueOf(parent)` equals one of the `off` values). An option whose rule has itself been
 * turned off higher up is off too.
 * @param {string} key
 * @param {{keys: string[], sub: object}} group
 * @param {(key: string) => any} valueOf  The value in effect (pending save included).
 */
export function subState(key, group, valueOf, seen=new Set()) {
  const rule = group?.sub?.[key];
  if ( !rule || seen.has(key) ) return { sub: false, off: false };
  seen.add(key);
  const above = group.keys.indexOf(rule.parent);
  const sub = (above >= 0) && (above < group.keys.indexOf(key));
  const off = (rule.off ?? []).some(v => Object.is(v, valueOf(rule.parent)))
    || subState(rule.parent, group, valueOf, seen).off;
  return { sub, off };
}

/**
 * Places the visible settings in the tabs: those of the layout in their place (in the layout's order), the others at the end
 * of the last tab — a setting added later without being placed thus stays accessible. The layout is the engine's default,
 * or the one a neighbouring module declares (`api.settings.registerWindow`); each tab keeps its other fields (label, tools).
 * @param {string[]} visibleKeys   The keys of the module's settings declared visible.
 * @param {Array<{id: string, keys: string[]}>} [tabs]
 * @returns {Array<object>}  The tabs, each with `keys` restricted to the present settings and `tools` (empty by default).
 */
export function placeSettings(visibleKeys, tabs=SETTINGS_TABS) {
  const present = new Set(visibleKeys);
  const placed = new Set(tabs.flatMap(t => t.keys ?? []));
  const orphans = visibleKeys.filter(k => !placed.has(k));
  return tabs.map((t, i) => ({
    ...t, tools: t.tools ?? [],
    keys: [...(t.keys ?? []).filter(k => present.has(k)), ...((i === tabs.length - 1) ? orphans : [])]
  }));
}

/**
 * What a neighbouring module declares for its window (`api.settings.registerWindow`): returns the list of problems (empty = valid).
 * `namespace`: the module's id; `tabs`: at least one tab, each with a unique `id` and `keys` (array of strings); each
 * tool has an `id` and an `open` function.
 */
export function validateWindow(def) {
  const problems = [];
  if ( !def || (typeof def.namespace !== "string") || !def.namespace ) problems.push("namespace: module id expected");
  if ( !Array.isArray(def?.tabs) || !def.tabs.length ) problems.push("tabs: at least one tab expected");
  const ids = new Set();
  for ( const [i, t] of (Array.isArray(def?.tabs) ? def.tabs : []).entries() ) {
    if ( !t?.id || ids.has(t.id) ) problems.push(`tabs[${i}]: unique id expected`);
    ids.add(t?.id);
    if ( !Array.isArray(t?.keys) || t.keys.some(k => typeof k !== "string") ) problems.push(`tabs[${i}].keys: array of setting keys expected`);
    // 2026-11-06: optional per-rule frames — each an `id` and `keys`; `sub`: key → `{ parent, off: [...] }`.
    if ( (t?.groups !== undefined) && !Array.isArray(t.groups) ) problems.push(`tabs[${i}].groups: array expected`);
    for ( const [j, group] of (Array.isArray(t?.groups) ? t.groups : []).entries() ) {
      if ( !group?.id || !Array.isArray(group.keys) ) problems.push(`tabs[${i}].groups[${j}]: id and keys expected`);
      for ( const [key, rule] of Object.entries(group?.sub ?? {}) ) {
        if ( !rule?.parent || !Array.isArray(rule.off) ) problems.push(`tabs[${i}].groups[${j}].sub.${key}: parent and off[] expected`);
      }
    }
    for ( const [j, tool] of (t?.tools ?? []).entries() ) {
      if ( !tool?.id || (typeof tool.open !== "function") ) problems.push(`tabs[${i}].tools[${j}]: id and open() expected`);
    }
  }
  // §291: the module's tab in the top row — `end` (on the right, after the others), `kind: "workshop"` (a workshop: tools
  // as cards), `icon`.
  const tab = def?.tab;
  if ( (tab !== undefined) && ((typeof tab !== "object") || (tab === null)) ) problems.push("tab: object expected");
  else if ( tab?.kind && !["settings", "workshop"].includes(tab.kind) ) problems.push("tab.kind: \"settings\" or \"workshop\" expected");
  return problems;
}

/** Does a setting match the search? Name and help, ignoring case and accents. */
export function matchesQuery(query, ...texts) {
  const fold = s => String(s ?? "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const q = fold(query).trim();
  return !q || fold(texts.join(" ")).includes(q);
}

/**
 * §291: a suite module is recognized by its public title, "DAS · …" (user's decision, 2026-10-05) — the engine does not
 * name any neighbour. The middle dot may be surrounded by any spaces.
 */
export function isSuiteTitle(title) {
  return /^DAS\s*·\s*\S/.test(String(title ?? ""));
}

/** The short name of a suite module, for its tab: "DAS · Combat UI" → "Combat UI". */
export function shortTitle(title) {
  return String(title ?? "").replace(/^DAS\s*·\s*/, "").trim() || String(title ?? "");
}

/**
 * The module tabs in order: the engine first, then by name, and at the end those that ask for it (`end`: a workshop).
 * `modules`: `[{ id, title, end? }]`.
 */
export function orderModules(modules, coreId) {
  return [...modules].sort((a, b) => ((b.id === coreId) - (a.id === coreId)) || ((!!a.end) - (!!b.end))
    || String(a.title).localeCompare(String(b.title)));
}
