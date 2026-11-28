# API publique — `game.modules.get("dnd5e-combat").api`

> Généré par `npm run reference` (`tools/reference.mjs`) : ne pas modifier à la main. `npm test` échoue si cette page n'est plus à jour.

355 fonctions dans 35 groupes, relevées sur l'objet réel du module chargé. La description est le
commentaire de la fonction dans le code (début seulement) ; le fichier est relatif à `module/scripts/`. Les valeurs non
fonctions (`active`, `reason`…) sont l'état du module. `mcp` : fonctions de test du connecteur, MJ seulement.

## `api`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.active` | _boolean_ |  |  |
| `api.approach` | `(token, { cells, level=null, target=null, reachCells=1, seeing=false }={})` | `runtime/actions.mjs` | §39.1: public walk (`api.approach`), for modules that want a token to go somewhere by the engine's path — A*, doors opened on the way, Opportunity Attacks, turn budget — without it knowing the module: they give the perm… |
| `api.drop` | `(token)` | `runtime/neighbours.mjs` | §180: drop what the creature holds (like the "Drop" order of Command: on the ground if a neighbor makes a pile of it, otherwise unequipped). Returns `{ items, pile, kept }` (adapter/orders.mjs `dropHeld`). |
| `api.flee` | `(token, anchor, { extra=0, dryRun=false }={})` | `runtime/actions.mjs` | §180: move away from a threat (a neighbor: an NPC's flight). "As far as the turn's movement allows" — plus `extra` (the Speed: a Dash taken first) —, by the engine's A* and its walk (Opportunity Attacks, budget). The ga… |
| `api.gap` | `(a, b)` | `dnd5e-combat.mjs` | §196: the gap between two tokens in cells (3D, and its vertical void), for a neighbor judging a reach — null if unmeasurable. |
| `api.level` | `()` | `runtime/levels.mjs` | Le niveau en vigueur sur ce client. |
| `api.levelAtLeast` | `(min)` | `runtime/levels.mjs` | Does the current level include what requires `min`? |
| `api.light` | `(token)` | `ui/illumination.mjs` | The light a token stands in, for an interface (`api.light`, requested by Darsh UI DnD5 on 2026-09-27). @param {Token\|TokenDocument} token @returns {{key: "bright"\|"dim"\|"dark"\|"magical", icon: string, name: string, tool… |
| `api.path` | `(token, { cells=null, level=null, target=null, reachCells=1, seeing=false }={}, { maxCost=null, extra=0 }={})` | `runtime/actions.mjs` | §179: a path without walking it — toward cells (`cells`, `level`) or a target (`target`, `reachCells`, `seeing`). `maxCost`: the cost ceiling to test (default: what remains to the token this turn, Infinity out of combat… |
| `api.reason` | _valeur_ |  |  |
| `api.routes` | `()` | `runtime/router.mjs` | Who listens to what, in which order: for inspection (`api.routes()`). |
| `api.save` | `(actor, { ability, dc, advantage=false, disadvantage=false, flavor=null }={})` | `runtime/neighbours.mjs` | §180: a saving throw requested of a creature outside a resolution (a neighbor: an NPC's morale check), rolled without a window, visible in chat like the saving throws of NPCs that the engine rolls. Returns `{ total, d20… |
| `api.skippedRoutes` | `()` | `runtime/router.mjs` | The registrations set aside by `withoutRoutes`: `[{ hook, label, feature }]`. |
| `api.stopWalks` | `()` | `adapter/movement.mjs` | §102: stops all engine walks started by this client (each token, at the next control point); returns nothing. |
| `api.unitFactors` | _valeur_ |  |  |

## `api.ammo`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.ammo.options` | `(item, activity=null)` | `dnd5e-combat.mjs` | The ammunition the weapon can fire and the one its next roll would fire: `{ options, current, ask }`, or null if it fires none. |
| `api.ammo.set` | `(item, ammoId)` | `adapter/ammo.mjs` | Retains an ammunition for the weapon's next attacks (all its attack activities), and announces it (hook `dnd5e-combat.ammunition`, `(item, ammoId)`, on every client through the item update). @param {Item5e} item @param… |

## `api.antimagic`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.antimagic.blocks` | `(activity)` | `runtime/antimagic.mjs` | Is this activity refused only by the field (so forceable)? |
| `api.antimagic.use` | `(subject, usage={}, dialog={}, message={})` | `runtime/antimagic.mjs` | `api.antimagic.use(subject, usage, dialog, message)`: use an item or an activity like dnd5e (`item.use` / `activity.use`, same arguments), but a spell or magical ability that only the field refuses goes through the "do… |

## `api.atCost`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.atCost.candidates` | `()` | `runtime/success-at-cost.mjs` | The open opportunities (interface, menu, scenarios). |
| `api.atCost.dismiss` | `(id)` | `runtime/success-at-cost.mjs` | The GM lets the opportunity pass (badge closed): the failure stands, right away. |
| `api.atCost.enabled` | `()` | `runtime/success-at-cost.mjs` | Issue #32: is the "success at a cost" rule on (world setting, off by default)? |
| `api.atCost.margin` | _number_ |  |  |
| `api.atCost.offer` | `(id, { cost }={})` | `runtime/success-at-cost.mjs` | The GM takes the opportunity: the pause stops, their window describes the cost (unless `cost` is given: macro, scenario), then the question to the player. Returns true if the player accepted. @param {string} id @param {… |
| `api.atCost.offerOnMessage` | `(messageId, { what, cost }={})` | `runtime/success-at-cost.mjs` | The GM offers the success at a cost on a roll already placed (card button). Accepted: the roll is marked by the active GM. @param {string} messageId The roll's message. @param {{what: string, cost?: string}} options |
| `api.atCost.offerOnRow` | `(cardId, row, { cost }={})` | `runtime/success-at-cost.mjs` | A line of a requested roll (§242): the DC comes from the request (the roll has no target when the DC is hidden). |

## `api.basics`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.basics.data` | `(kind)` | `adapter/basics.mjs` | The item data of a basic action, in this client's language. |
| `api.basics.take` | `(actor, kind)` | `runtime/neighbours.mjs` | §179: have a creature in combat take a basic action (Dash, Disengage, Dodge), as its item would: the action spent and the turn state set (doubled movement, no Opportunity Attack, Dodge); Disengage also opens the Reactio… |

## `api.budget`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.budget.issues` | `(actor, cost="action")` | `runtime/neighbours.mjs` | What prevents this spend ("notYourTurn", "noAction", "noBonus", "noReaction"); empty list if it is possible, or if the actor is not in combat. @param {Actor} actor @param {"action"\|"bonus"\|"reaction"} [cost="action"] |
| `api.budget.spend` | `(actor, cost="action")` | `runtime/neighbours.mjs` | Spend an action (or a Bonus Action, a Reaction) from this actor's budget, if they are in combat. To call on the active GM (the budget is a combatant flag). Returns true if a spend was written. |

## `api.climb`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.climb.ceiling` | `(token)` | `runtime/climb.mjs` | Climb up to the ceiling ("house" rules check if due); client that owns the token → boolean. |
| `api.climb.down` | `(token, { cells=null }={})` | `runtime/climb.mjs` | Climb down along the wall (or ceiling) by `cells` cells (without `cells`: the window); client that owns the token → boolean. |
| `api.climb.drop` | `(token)` | `runtime/climb.mjs` | Let go of the wall or ceiling (voluntary fall); false if the token is not climbing or not on this client. |
| `api.climb.edges` | `(token)` | `runtime/climb.mjs` | §216: the edges from which the token can hang to descend along the wall: `[{ dir, x, y, elevation, level, drop }]`. |
| `api.climb.enabled` | `()` | `core/climb-system.mjs` | Is the climbing and falling system on? |
| `api.climb.entries` | `(token)` | `runtime/climb.mjs` | The token menu's climbing entries (`{ icon, label, run }`: Climb the wall, the ceiling, Climb down, Let go…). |
| `api.climb.grab` | `(token, edge)` | `runtime/climb.mjs` | §216: "Grab the edge" `edge` (an element of `edges`); client that owns the token → boolean. |
| `api.climb.holds` | `(token, cell)` | `runtime/climb.mjs` | §196: would this climber hold on this cell (top-left corner, at its height) — on the wall, a climbable wall touches it; on the ceiling, the ceiling is there at its height (and does not slip under Slippers)? Always true… |
| `api.climb.run` | `(token, { cells=null }={})` | `runtime/climb.mjs` | §195: "Run up the wall" (the monk's Acrobatic Movement), without a check; like `up` → boolean. |
| `api.climb.setEnabled` | `(on)` | `runtime/climb-system.mjs` | Turns the climbing and falling system on or off (GM). |
| `api.climb.state` | `(token)` | `runtime/climb.mjs` | §196: a token's climbing state, for an interface or an AI — what the engine holds (mode, flag, status) and what its menu would offer now. null without token or actor. @param {Token\|TokenDocument} token @returns {{climbi… |
| `api.climb.toward` | `(token, target, { reachCells=1 }={})` | `runtime/climb.mjs` | §196: reach a target out of reach across a vertical void (on the wall, on the ceiling near a wall) by climbing — the simple case: go to the foot of the wall next to it (`api.approach`, within the turn budget), then clim… |
| `api.climb.up` | `(token, { cells=null }={})` | `runtime/climb.mjs` | Climb the wall by `cells` cells (without `cells`: the "how many cells" window); client that owns the token → boolean. |

## `api.combat`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.combat.addEvent` | `({ combat=game.combat, name, img=null, initiative=20, rounds=1, key=null, data={}, hidden=false }={})` | `runtime/combat-events.mjs` | Add an event to the combat. `rounds`: how many rounds it plays from the current round (1 by default: this round only; null: until removed). An event with the same `key` already there is replaced. @returns {Promise<Comba… |
| `api.combat.events` | `(combat=game.combat)` | `runtime/combat-events.mjs` | The events of a combat. |
| `api.combat.isEvent` | `(combatant)` | `runtime/combat-events.mjs` | An event of the combat (not a creature)? |
| `api.combat.removeEvent` | `(target, combat=game.combat)` | `runtime/combat-events.mjs` | Remove an event (by its key or the combatant). |

## `api.combatLaunch`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.combatLaunch.begin` | `()` | `runtime/combat-launch.mjs` | GM: the pause for the whole table, with its message. |
| `api.combatLaunch.cancel` | `()` | `runtime/combat-launch.mjs` | GM: the window closed without launching — the previous pause comes back. |
| `api.combatLaunch.candidates` | `(scene=canvas.scene)` | `runtime/combat-launch.mjs` | The scene's tokens, sorted for the window (core/combat-launch.mjs `classify`). |
| `api.combatLaunch.launch` | `({ participants=[], npcAuto=true, grouped=false, playlist=null }={})` | `runtime/combat-launch.mjs` | GM: launches the combat. @param {object} input @param {Array<{uuid: string, surprised?: boolean}>} input.participants @param {boolean} [input.npcAuto=true] NPCs roll their Initiative on their own. @param {boolean} [inpu… |
| `api.combatLaunch.open` | `()` | `ui/combat-launch.mjs` | Opens the window (GM): the pause first. |
| `api.combatLaunch.pending` | `()` | `runtime/combat-launch.mjs` | Is a combat launch in progress (pause placed by `begin`, participants not yet chosen)? World setting, any client. |

## `api.content`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.content.builtin` | _données (1003 clés)_ |  |  |
| `api.content.facts` | _liste (98)_ |  |  |
| `api.content.identifierOf` | `(item)` | `adapter/content.mjs` | The identifier under which an item is recognized, and where it comes from. §19.9: a premium item without an identifier (Ravenloft) gets one when created on a sheet — dnd5e 6 writes it from the name (documents/item.mjs:1… |
| `api.content.inspect` | `(actor)` | `adapter/content.mjs` | For in-play inspection: what each item of an actor declares, and where from. |
| `api.content.of` | `(item)` | `adapter/content.mjs` | An item's effective entry, layers combined. `null` if nothing is declared anywhere. @returns {{entry: object\|null, identifier: string\|null, layers: {module: boolean, world: boolean, item: boolean}}} |
| `api.content.recipes.build` | `(recipes=[], ctx={})` | `core/recipes.mjs` | The schema entry drawn from a list of recipes. Triggers are appended, `usageLimits` is merged per activity, a `unique` key comes only once. `base`: an existing entry to build on (resuming an item), kept as is — its trig… |
| `api.content.recipes.condition` | `(clauses=[], { at="condition", errors=[] }={})` | `core/recipes.mjs` | An engine condition (core/triggers.mjs, `holds`) built from `{ fact, arg?, not? }` clauses, all required. No clauses: `null` (no condition). Problems go into `errors` (see `issue`). |
| `api.content.recipes.factOptions` | _données (4 clés)_ |  |  |
| `api.content.recipes.facts` | _données (25 clés)_ |  |  |
| `api.content.recipes.fieldKinds` | _liste (11)_ |  |  |
| `api.content.recipes.list` | _données (15 clés)_ |  |  |
| `api.content.recipes.publicKeys` | _liste (7)_ |  |  |
| `api.content.recipes.version` | _number_ |  |  |
| `api.content.register` | `(source, table, { sources={} }={})` | `runtime/content.mjs` | Registers another module's content table (see the header). Validated entry by entry like the shipped content. @param {string} source The id of the module that provides it. @param {Record<string, object>} table `{ identi… |
| `api.content.registered` | `()` | `content/index.mjs` | What is registered: `{ source: [identifiants] }`. |
| `api.content.set` | `(identifier, entry)` | `adapter/content.mjs` | Writes (or removes, with `null`) the entry of an identifier in the world overlay. GM only. |
| `api.content.shipped` | _données (1003 clés)_ |  |  |
| `api.content.sources` | `()` | `content/index.mjs` | The registered sources: `{ source: { id de document: identifiant } }`. |
| `api.content.unregister` | `(source)` | `content/index.mjs` | Removes a module's table (and its sources, §277). @returns {boolean} Whether it was registered. |
| `api.content.validate` | `(entry)` | `runtime/content.mjs` | The errors of a content entry (`string[]`, empty = valid), against the schema `core/content/entry.mjs`. Changes nothing. |
| `api.content.validateSources` | `(sources)` | `core/content/entry.mjs` | §277: the errors of a table of sources `{ id de document: identifiant }` — the mappings a module registers with its table (`api.content.register(source, table, { sources })`) for items that have no usable identifier, li… |
| `api.content.version` | _number_ |  |  |
| `api.content.world` | `()` | `adapter/content.mjs` | The world overlay: `{ identifiant: entrée }`, held by the GM. Do not modify the returned object: it is shared. |

## `api.correction`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.correction.apply` | `(input)` | `runtime/correction.mjs` | Applies a correction (GM). Returns `{ ok, message, lines }` or `{ ok: false, reason }`. @param {object} input @param {string} input.activity uuid of the activity (on the character's sheet). @param {number\|null} [input.l… |
| `api.correction.open` | `(subject)` | `ui/correction.mjs` | Opens the correction window (GM) on an item or an activity. |
| `api.correction.shape` | `(activity)` | `runtime/correction.mjs` | Does the activity make an attack roll, impose a saving throw, have damage, effects? |
| `api.correction.undo` | `(messageId)` | `runtime/correction.mjs` | GM: undoes a correction — HP given back as a delta (the damage comes back, a heal is taken back), Unconscious / Dead removed if they came with that damage and the creature has HP again, the applied effects removed, the… |

## `api.debug`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.debug.clear` | `()` | `runtime/debug.mjs` | Clears, on this client, the collected errors, the trail, the kept lines and what was waiting to be sent to the active GM. |
| `api.debug.enabled` | `()` | `runtime/debug.mjs` | Is the capture running on this client (client setting `debugCapture`)? |
| `api.debug.errors` | `()` | `runtime/debug.mjs` | The collected errors, grouped by signature, most recent first — on the active GM, including those the players send it. |
| `api.debug.logs` | `()` | `runtime/debug.mjs` | The console lines of the suite's modules kept in verbose mode (300 at most) on this client. |
| `api.debug.onError` | `(fn)` | `runtime/debug.mjs` | Listen to new errors (the interface badge); returns a function to stop. |
| `api.debug.open` | `({ token=null }={})` | `ui/debug-report.mjs` | Opens the window (or brings it to the front). `token`: the attached context, from the context menu. |
| `api.debug.openConnectionTest` | `(userId)` | `ui/connection-test.mjs` | Opens the test window for a player and starts it (or brings the one already open to the front). |
| `api.debug.register` | `({ module, repo=null, collect=null }={})` | `runtime/debug.mjs` | A neighbor declares itself: `{ module, repo?, collect? }` — `collect()` returns an environment section (simple values). |
| `api.debug.registered` | `()` | `runtime/debug.mjs` | The neighbors declared through `register`: `[{ module, repo, collect }]`. |
| `api.debug.testConnection` | `(target, { count=PING_COUNT, progress=() => {} }={})` | `runtime/connection.mjs` | The test, on the GM's side: round trips then probe, compared with their own client. @param {User\|string} target @param {object} [options] @param {number} [options.count] Number of round trips. @param {(step: string) =>… |
| `api.debug.total` | `(which)` | `runtime/debug.mjs` | The number of collected errors: `total()` all; `total("suite")` the DAS errors; `total("others")` non-DAS. |
| `api.debug.trail` | `(module, kind, text)` | `runtime/debug.mjs` | A neighbor's gesture in the trail: `trail(module, kind, text)`. |
| `api.debug.trailList` | `()` | `runtime/debug.mjs` | This client's trail: its last 50 DAS gestures (and the neighbors'), from oldest to most recent. |
| `api.debug.verbose` | `(on)` | `runtime/debug.mjs` | With no argument: is this client's verbose mode on? With `on`: turns it on or off on this client, and returns the new state. |
| `api.debug.verboseEverywhere` | `(on)` | `runtime/debug.mjs` | The GM: verbose mode on all connected clients (the others on receiving the request). |

## `api.diagnostic`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.diagnostic.open` | `({ check=null }={})` | `ui/diagnostic.mjs` | For the API and macros: open the diagnostic, optionally on a single check. |
| `api.diagnostic.registerImporter` | `(def)` | `runtime/diagnostic/checks.mjs` | Another module declares its item importer: the diagnostic lists those of its items whose rule cites an id the item does not have, and replaces them with the official item as for DDB Importer (same id, sheet state and im… |
| `api.diagnostic.unregisterImporter` | `(id)` | `runtime/diagnostic/checks.mjs` | The importer is no longer declared. @returns {boolean} whether it was |

## `api.ethereal`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.ethereal.enabled` | `()` | `runtime/ethereal.mjs` | Is Ethereal Plane automation on (world setting `etherealPlane`)? Hook `dnd5e-combat.etherealPlane`. |
| `api.ethereal.is` | `(t)` | `runtime/ethereal.mjs` | Is the creature (token, document or actor) in the Ethereal Plane (dnd5e `ethereal` condition)? |
| `api.ethereal.perceives` | `(observer, target)` | `runtime/ethereal.mjs` | Can the observer perceive the target as far as the plane goes (same plane: yes; otherwise the core's rule)? The rest of the view is not judged. |
| `api.ethereal.setEnabled` | `(on)` | `runtime/ethereal.mjs` | GM: turns Ethereal Plane automation on (`on` absent or true) or off → the written setting's promise; null for a player. |
| `api.ethereal.toggle` | `(tokens=null, active=null)` | `runtime/ethereal.mjs` | Toggles the Ethereal condition of the given tokens (by default the controlled tokens). `active`: true / false forces the direction; without it, each token flips from one to the other — except a mixed group, which goes e… |

## `api.factions`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.factions.add` | `({ name, color }={})` | `runtime/factions.mjs` | Add a faction (id derived from the name). Returns its id. |
| `api.factions.assign` | `(documents, id)` | `runtime/factions.mjs` | Sets faction `id` (null: removes it) on tokens or actors — write permission on these documents required (the GM); returns their count. |
| `api.factions.explicit` | `(token)` | `runtime/factions.mjs` | The faction set by hand (token, else actor), without the rules or `party`; null if none. |
| `api.factions.grudge` | `(a, b, { clear=false, scene=canvas?.scene }={})` | `runtime/factions.mjs` | Makes two sides (faction ids or token uuid) hostile on a scene (the displayed scene by default), or lifts that grudge (`clear`); writes the scene (GM) and returns the list of grudges. |
| `api.factions.grudges` | `(scene=canvas?.scene)` | `runtime/factions.mjs` | A scene's grudges (the displayed scene by default): `[[a, b], …]`. |
| `api.factions.list` | `()` | `runtime/factions.mjs` | The setting's factions, each with its displayed name (`label`). |
| `api.factions.name` | `(id)` | `runtime/factions.mjs` | The displayed name of faction `id` (translated, unless the GM renamed it). |
| `api.factions.NONE` | _string_ |  |  |
| `api.factions.of` | `(token)` | `runtime/factions.mjs` | A token's faction id (set on the token, else on the actor, else `party` for a PC, else the setting's rules), or null. |
| `api.factions.open` | `()` | `dnd5e-combat.mjs` | Opens (or brings to the front) the factions window on this client. |
| `api.factions.PARTY` | _string_ |  |  |
| `api.factions.relation` | `(a, b)` | `runtime/factions.mjs` | The relation of two tokens: `"hostile"`, `"neutral"` or `"allied"` (factions matrix, else deduced from the dispositions). |
| `api.factions.relations` | `()` | `runtime/factions.mjs` | A copy of the relations matrix: `{ "<id>\|<id>": relation }` (an absent pair follows the disposition). |
| `api.factions.remove` | `(id)` | `runtime/factions.mjs` | Remove a faction: its relations go with it; flags that name it are ignored (unknown faction). |
| `api.factions.setRelation` | `(a, b, relation)` | `runtime/factions.mjs` | Set a relation (`null`: follow the disposition). |
| `api.factions.side` | `(token)` | `runtime/factions.mjs` | A token's side as the engine compares it: `{ disposition, faction, uuid, stance }`. |
| `api.factions.stance` | `(token, stance=null)` | `runtime/factions.mjs` | Poser ou lever l'attitude d'un token (`"neutral"` : rendu, l'ennemi de personne hors de sa faction). |
| `api.factions.suggest` | `()` | `runtime/factions.mjs` | The suggested relations, below those already set. |

## `api.floats`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.floats.export` | `()` | `ui/float-theme.mjs` | The world's theme, as export JSON. |
| `api.floats.fonts` | `()` | `ui/feedback.mjs` | This world's font families: the core's and the modules', and those the GM added (Additional Fonts). |
| `api.floats.import` | `(json)` | `ui/float-theme.mjs` | Imports a theme (JSON text or object) for the table: looks and pace. GM only. @returns {Promise<{kinds: number, problems: string[]}>} |
| `api.floats.open` | `()` | `ui/float-theme.mjs` | Opens the window (GM). |
| `api.floats.play` | `(token, kind, text, extra={})` | `ui/feedback.mjs` | §400: replays a kind on a token (trial from the theme window, `api.floats.play`). |
| `api.floats.reset` | `()` | `ui/float-theme.mjs` | Returns to the original look (the empty theme). |
| `api.floats.try` | `(kind)` | `ui/float-theme.mjs` | Tries a kind on the selected token (or nothing, with a notice). |

## `api.gm`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.gm.alert` | `({ text, item=null, actor=null })` | `runtime/gm-alert.mjs` | Flags to the GM what falls to them. From any client: the card is created by the active GM. @param {{ text: string, item?: Item\|string\|null, actor?: Actor\|null }} alert |
| `api.gm.forced` | `({ actor, item=null, reasons, targets=[], token=null })` | `runtime/forced.mjs` | Warns the GM and the table that a rule was overridden. @param {object} forced @param {Actor5e\|null} forced.actor Who acts. @param {Item5e\|string\|null} [forced.item] What is used (or its name). @param {string[]} forced.r… |

## `api.heroic`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.heroic.has` | `(actor)` | `adapter/heroic.mjs` | Does the player character have Heroic Inspiration? |
| `api.heroic.mode` | `()` | `adapter/heroic.mjs` | This client's setting: "on", "failure" or "off" ("on" if it cannot be read). |
| `api.heroic.set` | `(actor, on)` | `dnd5e-combat.mjs` | GM: grants (`on` true) or removes the Heroic Inspiration of a player character, with a chat card → true if it changed. |

## `api.mastery`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.mastery.judge` | `(actor, keys)` | `ui/mastery.mjs` | Judges a choice of mastery choice (`keys`: weapon ids) for the actor, writing nothing → `{ ok, reason, slots, removed }`. |
| `api.mastery.open` | `(actor)` | `ui/mastery.mjs` | §222: opens, on this client, the actor's weapon mastery window (if already open: it comes to the front). |
| `api.mastery.sources` | `(actor)` | `ui/mastery.mjs` | The actor's sources of weapon mastery properties ("Trait" advancements in "mastery" mode of its classes, subclasses and feats), read from its items. |

## `api.mcp`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.mcp.actionEnd` | `({ tokenId, targetId=null })` | `runtime/testing-rules.mjs` | §43.2: without `targetId`, the token `tokenId` escapes its grapple; with it, it ends the target's first effect that its action ends → `{ done }`. |
| `api.mcp.advanceTime` | `({ seconds })` | `runtime/testing.mjs` | GM: advances world time by `seconds` seconds (`game.time.advance`) → `{ worldTime }`. |
| `api.mcp.animations` | `()` | `runtime/animations.mjs` | The tracked animations and the recent survey (test). |
| `api.mcp.atCost` | `({ action="list", id=null, cost, card=null, tokenId=null, message=null }={})` | `runtime/testing.mjs` | Issue #32: successes at a cost, for scenarios — `list` (the pauses open on the active GM), `offer` (a pause taken; `cost` given: without the GM's window), `dismiss`, `row` (a row of a requested roll, `card` + `tokenId`)… |
| `api.mcp.attackReasons` | `({ attackerId, targetId, itemId, attackMode=null })` | `runtime/testing-rules.mjs` | The Advantage and Disadvantage reasons the engine would give this attack (core/conditions.mjs), and the hostile creatures in contact with the attacker — to understand an unexpected "normal" roll. |
| `api.mcp.attacksThisTurn` | `({ sourceId=null, targetId=null }={})` | `runtime/testing-rules.mjs` | §492: the "who attacked whom this turn" registry of the current combat, and, between two tokens, the kinds of attack from `sourceId` against `targetId` during this turn. |
| `api.mcp.awaiting` | `({ action="list", tokenId=null, kind="reaction", seconds=null }={})` | `runtime/testing.mjs` | §381: `action` "list" (this client's known waits), "open" (a probe window marked for `tokenId`) or "result" (its answer). |
| `api.mcp.barrier` | `({ attackerId, targetId, itemId, activityType=null })` | `runtime/testing.mjs` | O9h (§363): the barrier that stops this action from reaching its target (Antilife Shell, Scroll of Protection), or null. |
| `api.mcp.budget` | `({ tokenId })` | `runtime/testing-rules.mjs` | §20: a combatant's turn budget (action, Bonus Action, Dash, Disengage, Speed at 0, extra movement). |
| `api.mcp.burning` | `({ tokenId, extinguish: put=false }={})` | `runtime/testing-rules.mjs` | §212: On Fire, for a scenario — the state, and `extinguish`: put out its flames like the menu entry. |
| `api.mcp.castFromBar` | `({ tokenId, itemId, slot=null, x, y, sheet=false, type="summon", targetIds=null })` | `runtime/testing-areas.mjs` | GM: runs the `type` activity (summon by default) like the DAS · Combat UI bar, without waiting for the window or consuming (unless `sheet: true`) → `{ started, profiles }`; what is placed is read through `summonCaptured… |
| `api.mcp.castPicked` | `({ targetIds=[], upgrade=false, ...args })` | `runtime/testing.mjs` | §293: what the window's "Use" does — checked `targetIds`, `upgrade`: the checkbox of the activity that replaces it. |
| `api.mcp.catalyst` | `({ tokenId })` | `runtime/testing-rules.mjs` | §289: "Second Skin" — the GM declares the catalyst experienced (token menu). |
| `api.mcp.chainCheck` | `({ tokenId, itemId, targetIds })` | `runtime/testing-areas.mjs` | §286: Chain Lightning — the targets (after the first) too far from the first, by name. |
| `api.mcp.chatCards` | `({ count=6 }={})` | `runtime/testing.mjs` | §58: the latest log cards as the GM sees them — type, collapsed or not (`display` computed), summary of the rolls of the single card and verdict. Read-only. |
| `api.mcp.clickCard` | `({ id, index=0 })` | `runtime/testing.mjs` | §391: clicks card no. `index` (greyed ones excluded) of an engine card window (`.dnd5e-combat-form`: the weapon of Elemental Weapon, summoning form, Wild Shape…), like a player — the connector can fill a field and click… |
| `api.mcp.climb` | `({ tokenId, cells, acrobatic=false })` | `runtime/testing-moves.mjs` | Climb `cells` cells, like the menu entry (without a window), and wait for the ascent; `acrobatic`: "Run on the wall" (§195). |
| `api.mcp.climbCeiling` | `({ tokenId })` | `runtime/testing-moves.mjs` | §192 batch 2: "Climb the ceiling", like the menu entry, and wait for the ascent. |
| `api.mcp.climbDown` | `({ tokenId, cells })` | `runtime/testing-moves.mjs` | §192 batch 2: "Climb down the wall" by `cells` cells, like the menu entry (without a window). |
| `api.mcp.climbHolds` | `({ tokenId, cell })` | `runtime/testing-moves.mjs` | §196: `api.climb.holds` on a cell (`cell`: { i, j }) — would the climber hold there? |
| `api.mcp.climbState` | `({ tokenId })` | `runtime/testing-moves.mjs` | The state of a climber (or a candidate): walls touched, mode, status, what it can climb, world rules; §192 batch 2: the ceiling. |
| `api.mcp.climbToward` | `({ tokenId, targetId, reachCells=1 })` | `runtime/testing-moves.mjs` | §196: `api.climb.toward` — climb up to a target's reach; returns its result, the positions and the (3D) gap before / after. |
| `api.mcp.clock` | `()` | `runtime/testing.mjs` | §251: the state of the engine's real-time clock (null: it is running) and the world time. |
| `api.mcp.closeWindow` | `({ id })` | `runtime/testing.mjs` | Closes a window (a closed dialog counts as "no": the move paused by the core ends). |
| `api.mcp.combatOutcome` | `({ action="read", combatId=null, tokenId=null }={})` | `runtime/testing.mjs` | §555: records the `combatEnded` / `creatureDefeated` hooks on this client. `action`: "watch" (starts, clears), "read" (what was heard), "stop" (stops, returns what was heard), "tracker" (ticks "defeated" for `tokenId` i… |
| `api.mcp.concentrate` | `({ tokenId, itemId })` | `runtime/testing-rules.mjs` | §285: the caster concentrates on the item's first activity (dnd5e's Concentration effect), without casting anything. |
| `api.mcp.connectionTest` | `({ userId, count=5 }={})` | `runtime/testing-debug.mjs` | §388: the connection test of a connected player, as the player list menu entry launches it (without the window). |
| `api.mcp.controls` | `({ tokenId=null }={})` | `runtime/testing.mjs` | §220, §224: the engine's buttons in the token toolbar (`present`, `active`) and, for a token, what climbing offers in its menu (labels) — the climbing switch read by the `escalade-interrupteur` scenario. |
| `api.mcp.controlToken` | `({ tokenId=null }={})` | `runtime/testing-vision.mjs` | Issue #42: selects a token on the GM's client (its vision becomes the screen's), or releases everything (`tokenId` null) — to replay a GM's gesture: the token already selected, then a state placed, without resetting all… |
| `api.mcp.cover` | `({ attackerId, targetId, itemId=null, effective=false })` | `runtime/testing-rules.mjs` | §172: the target's Cover against the attacker, as the verdict will compute it (`coverFor`), or null. |
| `api.mcp.coverPreview` | `({ attackerId, targetId, itemId })` | `runtime/testing-rules.mjs` | #33: the Cover preview (`api.ui.cover`) of the target against an attacker's item attack, on this client (the GM: everything). |
| `api.mcp.damageTypes` | `({ tokenId, itemId })` | `runtime/testing-areas.mjs` | §288: the damage types at the choice of an item's attack ("Coup au but": the weapon's or radiant), as the roll will offer them. |
| `api.mcp.dash` | `({ tokenId, itemId, x, y, preview=false })` | `runtime/testing-moves.mjs` | §57: a straight-line rush ("Wind Strike") toward a given cell (top-left corner), without aiming: the same cell check, the same targets, the same use without a template. `preview: true`: only the targets and what would r… |
| `api.mcp.debugClear` | `()` | `runtime/testing-debug.mjs` | Clears what this client recorded (errors, trail, log). |
| `api.mcp.debugReport` | `({ description="", includeNames=false, token=null, all=false }={})` | `runtime/testing-debug.mjs` | This client's report (GM): groups captured, Markdown, length of the JSON and of the GitHub address, proposed repositories. By default, like the window, without the entries outside the suite; `all` keeps them all. |
| `api.mcp.debugThrow` | `({ message="test", via="route" }={})` | `runtime/testing-debug.mjs` | Makes the router probe fail (`via: "route"`) or rejects an unhandled promise (`via: "rejection"`). |
| `api.mcp.debugVerbose` | `({ on }={})` | `runtime/testing-debug.mjs` | This client's verbose mode, and an immediate send to the active GM (no effect on the GM itself). |
| `api.mcp.diagnosticBackups` | `()` | `runtime/testing.mjs` | The world diagnostic's backups, most recent first: `[{ id, uuid, name, date, roots, checks }]`. |
| `api.mcp.diagnosticForget` | `({ uuids=[], dropPack=false, actors=[] }={})` | `runtime/testing.mjs` | After a scenario: removes these backup entries, and the compendium if it is empty and the scenario created it (`dropPack`). |
| `api.mcp.diagnosticRepair` | `({ checks=null, roots=null, options={} }={})` | `runtime/testing.mjs` | Repairs the repairable tasks of these checks whose root is one of these uuids (all if `roots` is absent), with these check options (`{ [checkId]: { [optionId]: valeur } }`). |
| `api.mcp.diagnosticRestore` | `({ uuid })` | `runtime/testing.mjs` | GM: restores the diagnostic backup `uuid`, after saving the current state of the same documents → `{ lines, before }`. |
| `api.mcp.diagnosticScan` | `({ checks=null }={})` | `runtime/testing.mjs` | Analysis (nothing is written): the tasks, without their functions. |
| `api.mcp.door` | `({ tokenId, wallId, open=true })` | `runtime/testing-moves.mjs` | §152: open or close a door like the "Open / Close" menu entry (`setDoorOpen`: move up to contact via `approachDoor`, then act). Returns the door's state and the token's position afterwards. |
| `api.mcp.dropDown` | `({ tokenId })` | `runtime/testing-moves.mjs` | "Drop down": a voluntary fall, like the menu entry. |
| `api.mcp.effectOrigins` | `({ tokenId })` | `runtime/testing-rules.mjs` | §53: for each effect of a token, the origin item the engine finds (destroyed item: reread from the message). |
| `api.mcp.enchant` | `({ tokenId, itemId, activityId, targetItemId, profile=null })` | `runtime/testing-rules.mjs` | §29: applies an activity's enchantment (its first profile, or `profile`) to an actor's item — what dnd5e does by a drag-and-drop onto the card (Repelling Blast on Eldritch Blast). Returns the id of the placed effect. |
| `api.mcp.endings` | `({ tokenId })` | `runtime/testing-rules.mjs` | §43.2: the effects an action ends — the token's own (`own`), those another removes from it (`byOther`); and the gesture: without `targetId`, the token takes "Escape" for itself; with it, it ends the target's first effec… |
| `api.mcp.etherealWalls` | `({ tokenId, point })` | `runtime/testing-rules.mjs` | §225, batch 3: walls that stop ethereal travel, seen from the token, and if a step from its center to `point` crosses one. |
| `api.mcp.factions` | `({ op="state", tokenIds=[], faction=null, actor=false, a, b, relation=null, aId, bId, name, value, clear=false, stance=null, keepOpen=false }={})` | `runtime/testing-rules.mjs` | §181: the factions, for a scenario. `op`: `state` (setting, grudges, factions of the given tokens), `snapshot` / `restore` (the whole setting, `value`), `add` ({ name } → id), `relation` ({ a, b } faction ids, `relation… |
| `api.mcp.familiar` | `({ tokenId, clear=false })` | `runtime/testing-moves.mjs` | §107: the state of a familiar or master — recognized familiar, vision, basic actions, pocket dimension (the kept familiar and its HP; `clear` empties it); and the gestures: dismissal (`tokenId` of the familiar), recall… |
| `api.mcp.familiarPocket` | `({ tokenId })` | `runtime/testing-moves.mjs` | §107: the familiar `tokenId` goes into its pocket dimension (like the menu entry) → `{ done }`. |
| `api.mcp.familiarRecall` | `({ tokenId, point })` | `runtime/testing-moves.mjs` | §107: the master `tokenId` recalls its familiar to `point` → `{ done, refusal, tokens }` (the scene's familiars, with their HP). |
| `api.mcp.flammable` | `({ tokenId, ignite: light=false, regionId=null, fireAt=null })` | `runtime/testing-rules.mjs` | §188: the flammable areas of the scene (on fire or not) and those this token can light; `ignite`: sets fire to the first it can light (or `regionId`), like the "Light" menu entry. |
| `api.mcp.flight` | `({ tokenId, run=false })` | `runtime/testing-moves.mjs` | §238: what the menu offers a token for flight (choices, labels); `run`: play it, like a click on the entry. |
| `api.mcp.follow` | `({ followerId, leaderId })` | `runtime/testing-moves.mjs` | §41.3: the order to follow, to stop following, and who follows whom. |
| `api.mcp.followState` | `({ tokenId })` | `runtime/testing-moves.mjs` | Whom the token `tokenId` follows, who follows it, and its position: `{ leader, followers, position }` (§41.3). Read-only. |
| `api.mcp.forcePlayerWait` | `({ id=null }={})` | `runtime/testing.mjs` | §290: force a wait (`{ id }`, or the oldest). |
| `api.mcp.foreignSetting` | `({ namespace, key, value })` | `runtime/testing.mjs` | GM: reads a world setting of another namespace (`namespace.key`) and, with `value`, writes it → `{ key, before, now }`, or `{ absent: true }`. |
| `api.mcp.fortified` | `({ tokenId })` | `runtime/testing-rules.mjs` | §289: "Favor of Vigor" — the Constitution bonus granted now to a heal (0 if already taken since the start of its turn). |
| `api.mcp.gmAlerts` | `()` | `runtime/testing.mjs` | §364: the GM alerts shown in this client's banner (texts). |
| `api.mcp.gmQueue` | `()` | `runtime/testing.mjs` | §421: the GM's Queue — `{ mine, players, blocked, count, window }` (`window`: is the panel open?). |
| `api.mcp.gmQueueAnswer` | `({ id, action })` | `runtime/testing.mjs` | §422: the GM answers from their queue — the `action` button of the window of the row `id` of "Up to me to decide". |
| `api.mcp.gmQueueForce` | `({ id })` | `runtime/testing.mjs` | §421: the GM forces the row `id` of "I'm waiting for a player". |
| `api.mcp.gmQueueRoll` | `({ id })` | `runtime/testing.mjs` | §421: the GM rolls, in place of an absent author, the roll of the row `id` of "Blocked". |
| `api.mcp.grab` | `({ tokenId, dir=null })` | `runtime/testing-moves.mjs` | §216: "Grab the edge" toward `dir` (or the first edge), like the menu entry; returns the proposed edges and the position. |
| `api.mcp.grappleState` | `({ tokenId })` | `runtime/testing-rules.mjs` | K4 (§325): the grapples a token suffers — escape DC, reach of the hold, hold held. |
| `api.mcp.groupRoll` | `({ tokenIds=[], wait=true, ...request })` | `runtime/testing-rules.mjs` | §242: a roll request to the given tokens, like the "Request" button; `wait: false` returns the card right away (the players can take their time), otherwise the final status. |
| `api.mcp.groupRollBreakdown` | `({ tokenId, ...request })` | `runtime/testing-rules.mjs` | §242: the bonus tiles of the actor of token `tokenId` for the given request (like `api.rolls.breakdown`). |
| `api.mcp.groupRollForce` | `({ id, tokenId })` | `runtime/testing-rules.mjs` | §242: "Roll for them" on a card row (refused if it already has a roll), and the system's mode for a request. |
| `api.mcp.groupRollMode` | `({ tokenId, ...request })` | `runtime/testing-rules.mjs` | §242: the Advantage / Disadvantage dnd5e will give the actor of token `tokenId` for the request (like `api.rolls.mode`). |
| `api.mcp.groupRollState` | `({ id })` | `runtime/testing-rules.mjs` | §242: the status of a request card, and a token's bonus tiles for a request. |
| `api.mcp.hampered` | `({ tokenId })` | `runtime/testing.mjs` | §134: Speedy — the name of the item that gives Disadvantage to Opportunity Attacks against token `tokenId`'s actor, or null. |
| `api.mcp.heal` | `({ tokenId, amount })` | `runtime/testing-rules.mjs` | §23: heals a token as a spell would (`applyDamage` of type "healing"); returns its HP before and after. |
| `api.mcp.hoist` | `({ tokenId, dir=null })` | `runtime/testing-moves.mjs` | §209: pull up onto the ledge `dir` ("n", "s", "e", "w"; the first otherwise), like the menu entry. |
| `api.mcp.hood` | `({ actorId, itemId, down=null })` | `runtime/testing.mjs` | §346: lowers (`down: true`) or raises the hood of a lit source. |
| `api.mcp.hurt` | `({ tokenId, amount, type="bludgeoning", properties=[] })` | `runtime/testing-rules.mjs` | §23: damage to a token, through `applyDamage` (Resistances included); returns its HP before and after. |
| `api.mcp.identify` | `({ tokenId })` | `runtime/testing-rules.mjs` | §19.9: under which identifier the engine recognizes each item of a token, where it gets it from (item, source, compendium, name) and the content keys attached to it — for premium items without an identifier (Ravenloft),… |
| `api.mcp.inventory` | `({ types=null, textLength=700 }={})` | `runtime/testing.mjs` | The inventory of the world's capabilities (world actors, not unlinked tokens): one line per identifier and item type, with who carries it, what the engine knows of it (`rules`: the content keys), its activities, its eff… |
| `api.mcp.issues` | `({ tokenId, itemId, activityType=null, activityId=null, cost=null, attackMode=null })` | `runtime/testing-rules.mjs` | What is wrong with a use (turn legality, conditions), without using it; `cost` forces the cost ("bonus", "reaction"). `attackMode`: dnd5e's attack mode, as chosen by the click (§532: `offhand`, the Light extra attack). |
| `api.mcp.itemData` | `({ tokenId, itemId, paths=[] })` | `runtime/testing-rules.mjs` | §335: the source data of a token's item, at the requested paths (`effect:<id>:<chemin>` for an effect of the item) — what a premium data fix wrote. |
| `api.mcp.jump` | `({ tokenId, cell, high=false })` | `runtime/testing-moves.mjs` | §208: a jump like the menu entry ("Jump here", "High jump here"), toward the center of `cell`. Returns the before and after positions, what the jump allowed (`options`, in feet), the warnings shown, and the turn budget… |
| `api.mcp.lightState` | `({ actorId, itemId })` | `runtime/testing.mjs` | §121: the state of a carried source (lit, time left, fuel), or null if it is no longer there. |
| `api.mcp.lock` | `({ tokenId, wallId, method="pick", total=null })` | `runtime/testing-moves.mjs` | §244: a door lock. Without `total`, the menu path (move up, pay the action in combat, roll the check, judge); with `total`, only the active GM's judgment, for a wanted result. Returns the verdict, the door's state, the… |
| `api.mcp.longRest` | `({ tokenId })` | `runtime/testing.mjs` | §305: a Long Rest for the token, without a window or card (the `dnd5e.restCompleted` hook fires as on a player's rest). |
| `api.mcp.makeScroll` | `({ tokenId, spellUuid, quantity=1 })` | `runtime/testing.mjs` | O8g (§350): a spell scroll made as dnd5e does it from a compendium (`createScrollFromSpell`), given to the token's actor. |
| `api.mcp.masteries` | `({ actorId, keys=null })` | `runtime/testing-rules.mjs` | §222: an actor's chosen masteries — sources, slots, recorded choice, what the Long Rest lets change, and the rule's verdict for `keys` if given. |
| `api.mcp.masteryWindow` | `({ actorId, keys=null })` | `runtime/testing-rules.mjs` | §510: the actor's masteries window, opened on this client (GM) by the public API (`api.mastery.open`), the current choice replaced by `keys` if given (nothing is recorded) → `{ rest }`: the text of the Long Rest green l… |
| `api.mcp.menu` | `({ tokenId, targetId, run=null })` | `runtime/testing.mjs` | §240: the context menu entries of `targetId` for `tokenId` (taken over while reading), read through the public API `api.ui.tokenMenu` — `runtime/` does not import `ui/`. `run`: launches the entry with this label without… |
| `api.mcp.missedOpportunities` | `({ tokenId, point, explain=false })` | `runtime/testing-moves.mjs` | §479: why creatures whose reach would be left by this straight-line move have no Opportunity Attack — `[{ name, reason, notice }]`. `explain`: like a real move (debugger log, GM alert once per combat). |
| `api.mcp.mount` | `({ action="state", tokenId, targetId=null, force=true })` | `runtime/testing-moves.mjs` | §490 (B08): mount and order to a companion. `action`: "state" (read), "mount" (`tokenId` mounts `targetId`), "dismount" (`tokenId` dismounts). `issues`: what would refuse the mount, read BEFORE the gesture (keys `Montur… |
| `api.mcp.move` | `({ tokenId, cell, point, levelId, action, stopAfterMs, pauseAfterMs })` | `runtime/testing-moves.mjs` | Moves the token like a move click (`moveTo`: A*, doors, stairs, Opportunity Attacks, budget), and waits until it has arrived. Returns the before / after positions and the windows opened during the move (the core's "Chan… |
| `api.mcp.movement` | `({ tokenId })` | `runtime/testing-moves.mjs` | The token's movement budget in the current combat (null outside combat). |
| `api.mcp.naturalOne` | `({ tokenId })` | `runtime/testing-rules.mjs` | §93: what a natural 1 triggers on the creature (the roll itself is not forced) — not awaited: the scenario answers. |
| `api.mcp.overrideContent` | `({ identifier, entry=null })` | `runtime/testing-rules.mjs` | §27: sets (or removes, `entry: null`) the entry of an identifier in the world overlay, and returns the one that was there — so that a scenario restores it (Potent Spellcasting instead of Divine Strike). |
| `api.mcp.owners` | `({ tokenId })` | `runtime/testing-areas.mjs` | O8f (§349): a token's disposition and the players (non-GM, or "default") who have at least one permission on its world actor. |
| `api.mcp.perceived` | `({ observerId, targetIds=[] })` | `runtime/testing-rules.mjs` | §62: what the client sees on screen through a token's eyes — the GM takes control of it (their vision becomes that of this token), we read `isVisible` and each target's detection filter (the outline of hearing, or of a… |
| `api.mcp.perf` | `({ limit=20, reset=false }={})` | `runtime/testing.mjs` | §98: the survey of the engine's timings on the GM's client (the `limit` costliest lines), and the long tasks. |
| `api.mcp.pickTargets` | `(args)` | `runtime/testing.mjs` | §293: the "creatures of your choice within a radius" list the window would have (without what the user sees). |
| `api.mcp.placeItemEffect` | `({ tokenId, casterId, itemId, effectId, uuid=null })` | `runtime/testing-rules.mjs` | §285: places on a token the effect `effectId` of item `itemId` of caster `casterId`, with its id (like dnd5e's application) and the item as origin — what the failed save would have placed, without the luck of the roll.… |
| `api.mcp.placeMenu` | `({ tokenId, wallId=null, x=null, y=null, probe=null })` | `runtime/testing.mjs` | §243, §247: the menu entries of a door (`wallId`) or a cell (`x`, `y`) for `tokenId`, read through the public API (`api.ui.doorMenu`, `api.ui.groundMenu`), with those of the neighbors. `probe`: a trial entry added for t… |
| `api.mcp.placeRegionAt` | `({ x, y })` | `runtime/testing-areas.mjs` | §70: validates the region placement in progress (`RegionLayer#placeRegion`: dnd5e's for a spell's area, or the bolt's aiming) at the scene point (x, y), like a click: the shape is centered there, then the end of `#nextP… |
| `api.mcp.plan` | `({ tokenId, cell, point, levelId, maxCost })` | `runtime/testing-moves.mjs` | The path the engine would take, without moving. `maxCost`: cost ceiling (grid unit), otherwise the turn's. |
| `api.mcp.planning` | `()` | `runtime/testing-areas.mjs` | The aiming of a teleportation in progress on this client: the engine's, and the core's planning (`_movementPlanningContext`). |
| `api.mcp.portent` | `({ tokenId, roll=false, rolls=null, clear=false })` | `runtime/testing-rules.mjs` | §36: the noted rolls of a token's Portent — `roll: true` rolls them as at a Long Rest; `rolls: [n…]` sets them (scenario: known values); `clear: true` clears them. Returns the diviner's d20 count and its state. |
| `api.mcp.potionOptions` | `({ tokenId, itemId })` | `runtime/testing-rules.mjs` | Issue #31: what the Combat UI would read for the potion `itemId` of the token (`api.ui.potion`), or null. |
| `api.mcp.range` | `({ tokenId, itemId, activityType=null })` | `runtime/testing-rules.mjs` | §236: the range the engine applies to an activity (content rules included: Spell Sniper, Improved Elemental Fury). |
| `api.mcp.rangeCheck` | `({ tokenId, itemId, targetIds=[], activityType=null })` | `runtime/testing-rules.mjs` | O8h (§351): the range issues (out of range, long range, too close) of an activity against these targets, designated here. |
| `api.mcp.rangedPlacement` | `({ tokenId, itemId, shapes })` | `runtime/testing-areas.mjs` | §286: what the placement would refuse for these shapes of the item's area activity (`far`, `hidden`, `apart` — non-contiguous cubes), or null; without opening dnd5e's placement. `shapes`: region shapes in pixels (`circl… |
| `api.mcp.rawMove` | `({ tokenId, cell=null, elevation=null, action=null, settleMs=1500 })` | `runtime/testing-moves.mjs` | §224: a "by hand" move, like dragging or the HUD elevation field — `token.move` of a single point (cell `cell`, otherwise in place) to `elevation` (otherwise its own), in the `action` mode (otherwise its own), without t… |
| `api.mcp.reachCheck` | `({ tokenId, targetId, engage: doEngage=false, approach: doApproach=false })` | `runtime/testing-moves.mjs` | §192 batch 2: what `tokenId`'s basic attack thinks of `targetId` — gap in cells (3D), vertical gap, too high for an approach, and the range verdict; `engage: true` launches the basic attack like a click on the enemy (wi… |
| `api.mcp.ready` | `({ tokenId, name=null, trigger="enters", targetId=null }={})` | `runtime/testing-rules.mjs` | §211: Ready, for a scenario — without `name`, what the token can prepare and its plan; with it, the stored plan (the option whose name contains `name`, the trigger, the creature `targetId`, the lowest slot for a spell),… |
| `api.mcp.reload` | `()` | `runtime/testing.mjs` | The GM client's F5, so that it rereads the engine code after a change: the response goes out before the reload. GM only; `call-module-api` exists only in a world where the connector's "Test tools" setting is enabled. |
| `api.mcp.removeItemEffect` | `({ actorId, itemId, effectId })` | `runtime/testing.mjs` | §346: removes an effect from an actor's item (an applied enchantment). |
| `api.mcp.reports` | `()` | `runtime/testing.mjs` | The items partly reported by the GM (SPEC §9.2), for the summary reread by Claude. |
| `api.mcp.restoreItem` | `({ actorId, itemData })` | `runtime/testing.mjs` | Gives an item back to an actor under its original identifier (`keepId`), for a scenario that made it lose it ("Coward of Command" dropped in a heap by a neighboring module): the connector always creates a new identifier… |
| `api.mcp.rollCard` | `({ messageId })` | `runtime/testing.mjs` | The click on "Damage" or "Healing" of a use card for which the engine awaits the author's roll (healing, damage left to the system): what the connector does not do alone (it only rolls attacks). Same path as the engine… |
| `api.mcp.rollCheck` | `({ tokenId, skill=null, ability=null })` | `runtime/testing-rules.mjs` | §90: a skill check (`skill`) or ability check (`ability`), without a window; what follows the roll (added die) is not awaited. |
| `api.mcp.rollSave` | `({ tokenId, ability })` | `runtime/testing-rules.mjs` | §23: a token's saving throw, without a window; returns its formula and its total. |
| `api.mcp.runMacro` | `({ uuid }={})` | `runtime/testing.mjs` | GM: runs the macro `uuid` without waiting for it (an error goes to the console) → `{ started }` (its name). |
| `api.mcp.saveChance` | `({ casterId, targetId, itemId, activityId=null })` | `runtime/testing-rules.mjs` | The save failure chance the badge would show (§15.3), to compare with the real roll. |
| `api.mcp.scatter` | `({ tokenId, pickUp: take=false })` | `runtime/testing-rules.mjs` | §187: the scattered objects of the scene (caltrops, ball bearings) and those this token can pick up; `pickUp`: picks up the first, like the "Pick up" menu entry. |
| `api.mcp.sceneBright` | `({ check=null }={})` | `runtime/testing.mjs` | Discord (Fanarie, 2026-11-18): the "Bright Light" checkbox put back in the displayed scene's configuration (ui/scene-bright.mjs). Opens the window, reads the checkbox; `check`: ticks or unticks it and saves the form. Re… |
| `api.mcp.screenAfterUpdate` | `({ observerId, targetIds=[] })` | `runtime/testing-vision.mjs` | Issue #42, continued (Archibald): the observer's screen AFTER an update of their actor, without resetting all the sources — token data preparation wiped the in-memory modes (Devil's Sight, a Blinded creature's hearing).… |
| `api.mcp.screenHere` | `({ targetIds=[] }={})` | `runtime/testing-vision.mjs` | What THIS client shows of the displayed scene's tokens, with the tokens it controls (or all those it owns when it controls none: a player's view). No GM required, for a player client. Empty `targetIds`: all tokens. |
| `api.mcp.scrollReading` | `({ tokenId, itemId })` | `runtime/testing.mjs` | O8g (§350): what the engine judges of a scroll for its bearer (`scrollReadingFor`), activity by activity. |
| `api.mcp.sees` | `({ observerId, targetId })` | `runtime/testing-rules.mjs` | §182: does the observer see the target (engine vision), and its Cone. |
| `api.mcp.sequencer` | `({ end=null }={})` | `runtime/testing.mjs` | The running Sequencer effects and sounds (third-party module: Boss Loot / BLFX animations), and the ending of those designated — so that the scenario runner finishes what a scenario spawned (seen on 2026-09-29: the loop… |
| `api.mcp.setOwners` | `({ actorId, users=[], level=3 })` | `runtime/testing-vision.mjs` | Gives a world actor to players (owners), by their names — the connector ignores `ownership` when creating and updating an actor. For arenas (tools/arene-vision.mjs: the observers at `claude player`). The other rights do… |
| `api.mcp.setting` | `({ key, value })` | `runtime/testing.mjs` | A setting of the engine (and of it alone): returns the previous value, so a scenario can restore it; `value` absent: read-only. GM only (§38.4: the `presage` scenario disables Portent for the length of a game). |
| `api.mcp.settingsChanged` | `()` | `runtime/testing.mjs` | The engine's world settings that are not at their default value (read-only): what the table chose. |
| `api.mcp.sheetUse` | `({ tokenId, itemId, targetIds=null })` | `runtime/testing-rules.mjs` | GM: uses the token's item `itemId` like a click on the dnd5e sheet (`item.use({ event })`, without the engine or the forced activity window), the GM having designated `targetIds`; does not wait for the rest → `{ started… |
| `api.mcp.shortRest` | `({ tokenId })` | `runtime/testing.mjs` | C12-j: a Short Rest for the token, without a window (Hit Dice are not spent). |
| `api.mcp.sightIssues` | `({ tokenId, identifier, targetIds=[] })` | `runtime/testing-vision.mjs` | Issue #42: the "{name} is not in view: this spell targets a creature you can see" issue of an aim, without opening the legality window — the same computation as runtime/turn.mjs (the activity's `sightRequired`, then the… |
| `api.mcp.skillAid` | `({ tokenId, helperTokenId, kind, skill=null, tool=null })` | `runtime/testing-rules.mjs` | §113: the aid requested as the window button would; returns whether it is given and whether Help is placed (awaited 10 s). |
| `api.mcp.skillAids` | `({ tokenId, skill=null, tool=null })` | `runtime/testing-rules.mjs` | §113: the aids that the skill or tool check window would offer this token. |
| `api.mcp.stairs` | `({ tokenId })` | `runtime/testing-moves.mjs` | The scene's stairs and ladders, with the cells they cover (center in the region). |
| `api.mcp.stairsAt` | `({ tokenId, point })` | `runtime/testing-moves.mjs` | §41.2: where the stairs under this point lead for this token (what the cursor and the menu read). |
| `api.mcp.stand` | `({ tokenId })` | `runtime/testing-rules.mjs` | §285: standing up (`standUp`), for a scenario — returns whether it stood up and whether the menu entry is offered. |
| `api.mcp.stats` | `({ tokenId })` | `runtime/testing-rules.mjs` | A token's computed values (data prepared by dnd5e, which the connector does not return: it reads the source): AC, speeds, HP, attack and save bonuses — to check a passive effect without going through an attack. |
| `api.mcp.status` | `()` | `runtime/testing.mjs` | The state of the executing client (the connector's GM): engine version and load time, and whether it is the active GM — the one running the engine (`game.users.activeGM`). `tools/reload.mjs` uses it to know that the F5… |
| `api.mcp.stealth` | `({ op="state", tokenId, on=true }={})` | `runtime/testing-rules.mjs` | §184: BG3 Stealth, for a scenario. `op`: `state` \| `set` ({ on }) \| `check` \| `forget`. |
| `api.mcp.storm` | `({ tokenId, itemId })` | `runtime/testing-areas.mjs` | §70: an item's storm on the scene (cloud, "already there", aiming in progress). |
| `api.mcp.stormStrike` | `({ x, y })` | `runtime/testing-areas.mjs` | §70: the click of the bolt's aiming (a point of the scene): the core's placement is closed, the bolt placed at the point. |
| `api.mcp.summonAlert` | `()` | `dnd5e-combat.mjs` | §542: the load-time summon permissions check, as at `ready` → `{ gaps, opened, windowId }` (the window opened, or not). |
| `api.mcp.summonAt` | `({ tokenId, itemId, activityId=null, profile=null, actorUuid=null, x, y })` | `runtime/testing-areas.mjs` | GM: uses the item's summon activity (`activityId`, otherwise the first) consuming nothing, then places the creatures of the profile (`profile`, otherwise the first) at cell `x`, `y` → `{ messageId, tokens: [{ id, name,… |
| `api.mcp.summonBlocked` | `({ userId, tokenId, itemId, activityId=null, tell=true }={})` | `runtime/testing.mjs` | §542: what would happen if the user `userId` (a player) used this summon activity — the bench has no player client. Rights are read for that user (`User#can` reads the role table for any user); with `tell: true` (defaul… |
| `api.mcp.summonCaptured` | `()` | `runtime/testing-areas.mjs` | §383: what the last `castFromBar` summoned (profile received by dnd5e, tokens placed), or null while nothing has started. |
| `api.mcp.takeStairs` | `({ tokenId, point, levelId })` | `runtime/testing-moves.mjs` | §41.2: take the stairs under this point to `levelId`, like a click on them (without the core's dialog). |
| `api.mcp.teleport` | `({ tokenId, itemId, x, y, passengers=[] })` | `runtime/testing-moves.mjs` | A self-teleport destination (Misty Step), as the core's planning click would return it: the plan goes through the same checkpoint (`dnd5e.teleport`, which the engine holds: range, occupied cell, view — runtime/actions.m… |
| `api.mcp.teleportPick` | `({ x, y })` | `runtime/testing-moves.mjs` | §67 ter: the engine's click during teleport aiming (a point of the scene), without the mouse. |
| `api.mcp.threats` | `({ tokenId, point })` | `runtime/testing-moves.mjs` | §23: who would threaten an Opportunity Attack on a straight-line move to this point (names). |
| `api.mcp.timer` | `({ tokenId, seconds=5, label="" }={})` | `dnd5e-combat.mjs` | Starts on every client a timer of `seconds` s above the token `tokenId` of the displayed scene → `{ id }`. |
| `api.mcp.toggleLight` | `({ actorId, itemId, on=null })` | `runtime/testing.mjs` | §121: light or extinguish a carried source without going through its activity (the Torch has none), like the inventory menu; returns the result and the source's state. `on` absent: the opposite. |
| `api.mcp.tokenLight` | `({ tokenId })` | `runtime/testing-areas.mjs` | §287: the token's light as its effects render it (`token.light.*` applied by the core), not that of its source. |
| `api.mcp.transpose` | `({ tokenId })` | `runtime/testing-moves.mjs` | §38.2: the place swap of "Trickster's Swap", like the menu entry (from the illusion or its caster); before / after positions. |
| `api.mcp.unfollow` | `({ tokenId })` | `runtime/testing-moves.mjs` | The token `tokenId` (displayed scene) stops following its leader (§41.3) → `{ stopped }`. |
| `api.mcp.upkeep` | `({ tokenId, maintain=false })` | `runtime/testing-rules.mjs` | §285: maintaining a spell (Crown of Madness) — the state, the menu entry offered, and `maintain`: the Magic action taken. |
| `api.mcp.use` | `({ tokenId, itemId, activityType=null, activityId=null, extra=null, consume=false })` | `runtime/testing-rules.mjs` | An activity used as on click (§47): including dnd5e's area placement — unlike the connector's `use-activity`, which cuts it (`create.measuredTemplate: false`). Without a slot; the dnd5e window, if it opens, is captured… |
| `api.mcp.view` | `({ levelId })` | `runtime/testing-moves.mjs` | Displays a scene level for the GM (an engine move makes the view follow: the scenario restores it). |
| `api.mcp.viewScene` | `({ sceneId })` | `runtime/testing.mjs` | Displays a scene for the GM (`Scene#view`): activating an already active scene does not change what the GM is looking at (seen on 2026-10-22: a sweep played against the Test Arena, displayed, while the Spell Arena was a… |
| `api.mcp.visionMatrix` | `({ observerIds=[], targetIds=[], screen=true })` | `runtime/testing-vision.mjs` | The vision of each pair: rules and screen. @param {{observerIds: string[], targetIds: string[], screen?: boolean}} args @returns {{vision: boolean, rows: Array<{observer: string, target: string, rules: object, screen: s… |
| `api.mcp.waits` | `()` | `runtime/testing.mjs` | §290: the GM's waits (combat windows without a delay) — `{ waits: [...], window: bool }`. |
| `api.mcp.wall` | `({ tokenId, itemId, activityId=null, points })` | `runtime/testing-areas.mjs` | §162: a wall placed by points, as the interface's aiming would do after the clicks (ui/pointer.mjs, `aimWall`): the activity is used with the points (`aimed: { type: "wall", points }`), the region and its walls follow `… |
| `api.mcp.wallSide` | `({ regionId, flip=false })` | `runtime/testing-areas.mjs` | §169: the state of a wall with a burning face — its side, its burning face (id, shapes), its core walls; `flip: true` flips it first (like the caster menu entry). |
| `api.mcp.windows` | `()` | `runtime/testing-shared.mjs` | The windows open on the GM (ApplicationV2): to find a dialog that a blocked move is waiting for. The core's fixed interface (sidebar, chat log, tokens tab, macro bar…) is also an ApplicationV2, without a frame: not a wi… |

## `api.nonLethal`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.nonLethal.get` | `(actor)` | `adapter/knockout.mjs` | Are this actor's blows non-lethal? |
| `api.nonLethal.knockedOut` | `(actor)` | `adapter/knockout.mjs` | Is the creature knocked out (Unconscious at 1 HP from a non-lethal blow)? |
| `api.nonLethal.set` | `(actor, on)` | `adapter/knockout.mjs` | Turns this actor's non-lethal blows on or off. |

## `api.perf`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.perf.longTasks` | `()` | `runtime/perf.mjs` | The browser's "long tasks" since loading or `reset()`: `{ count, totalMs, maxMs, sinceMinutes }` (Chromium only). |
| `api.perf.report` | `()` | `runtime/perf.mjs` | The time spent by each router registrant on this client, the costliest first: `[{ hook, label, calls, totalMs, avgMs, maxMs, slow, asyncMaxMs }]`. |
| `api.perf.reset` | `()` | `runtime/perf.mjs` | Resets this client's survey (registrant timings, warnings, long tasks). |
| `api.perf.table` | `(limit=25)` | `runtime/perf.mjs` | Prints to the console the `limit` costliest lines of `report()`, then the long tasks; returns nothing. |

## `api.queue`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.queue.answer` | `(id, action)` | `runtime/gm-queue.mjs` | §422: the GM answers from their queue to what the engine asks of them — the `action` button of the window of line `id` of `mine`, as if they had clicked it in the window. Returns false if the line has no window (any mor… |
| `api.queue.force` | `(id)` | `runtime/gm-queue.mjs` | The GM forces line `id` of "I'm waiting for a player": its window closes on their side with the answer the delay would have given. The table sees it (text above the token). Returns false if the line no longer exists, or… |
| `api.queue.list` | `()` | `runtime/gm-queue.mjs` | GM: the queue — `{ mine, players, blocked, count }` (what the engine asks of them, the players awaited, the actions whose author left); empty on a player. A line: `{ id, userId, userName, actor, kind, label, since, seco… |
| `api.queue.open` | `()` | `ui/player-waits.mjs` | Opens (or brings to the front) the "GM Queue" panel, GM only. |
| `api.queue.roll` | `(id)` | `runtime/gm-queue.mjs` | The GM rolls in place of an author who left the roll owed by line `id` of "Blocked" (or the identifier of its message). Active GM. @param {string} id |

## `api.releaseNotes`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.releaseNotes.open` | `({ since=null }={})` | `ui/release-notes.mjs` | For the API, the welcome screen and the settings: open the update message. `since`: the last version seen (the notes of the versions released since); without it, the latest notes. |

## `api.reports`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.reports.clear` | `(uuid)` | `ui/automation.mjs` | Removes an item's flag (by uuid), or all with no argument; writes a world setting (GM). |
| `api.reports.list` | `()` | `ui/automation.mjs` | The items flagged by the GM (world setting): `{ uuid de l'item: { actor, actorUuid, item, identifier, note, at } }`. |
| `api.reports.open` | `()` | `ui/automation.mjs` | Opens the recap panel on this client. |
| `api.reports.text` | `()` | `ui/automation.mjs` | The recap of the flags as plain text, per actor, to paste into a conversation. |

## `api.rolls`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.rolls.breakdown` | `(actor, input)` | `runtime/group-roll.mjs` | The tiles of an actor's bonus for a request (`{ type, key, … }` like `request`): `[{ kind, label, value, … }]`, indicative; [] if the request is invalid. |
| `api.rolls.force` | `(messageId, actorUuid)` | `runtime/group-roll.mjs` | GM: rolls for a character who is lagging (tracking window). Their window closes on their player's side (the roll arrives from elsewhere). @returns {Promise<boolean>} true if a roll was made. |
| `api.rolls.mode` | `(actor, input)` | `runtime/group-roll.mjs` | The Advantage / Disadvantage that dnd5e will give this actor by itself for the request (sheet, effects, conditions): `{ advantage, disadvantage }`. |
| `api.rolls.open` | `({ actors=[], values={} }={})` | `ui/group-roll.mjs` | Opens the request window (GM). `actors`: actors, tokens or uuids checked by default; `values`: the pre-filled fields (`type`, `key`, `dc`, `hideDc`, `mode`, `bonus`, `label`, `group`, and `ability` for a skill or tool w… |
| `api.rolls.request` | `({ actors, ...input }={})` | `runtime/group-roll.mjs` | Places the request and has each one roll. GM only. @param {object} options The request (core/group-roll.mjs `normalizeRequest`) and: @param {Array<Actor\|Token\|TokenDocument\|string>} options.actors @returns {Promise<obje… |
| `api.rolls.title` | `(input)` | `runtime/group-roll.mjs` | The title of the requested check, in dnd5e's words ("Wisdom (Insight) Check"); "" if the request is invalid. |
| `api.rolls.tracker` | `()` | `ui/group-roll-tracker.mjs` | Opens (or brings to the front) the tracking window, GM only. |
| `api.rolls.view` | `(messageId)` | `runtime/group-roll.mjs` | A card's point, for a neighbor (filtered for a player when the DC is hidden). |

## `api.scrolls`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.scrolls.spellOf` | `(item)` | `adapter/scrolls.mjs` | The spell of a scroll `{ identifier, level, school }`, or null (not a scroll, or spell not found). A scroll made from a compendium (`createScrollFromCompendiumSpell`, documents/item.mjs) does not copy the spell: it carr… |

## `api.settings`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.settings.open` | `(ns=MODULE_ID)` | `ui/settings.mjs` | The window, opened on a module's tab (the engine by default). |
| `api.settings.registerWindow` | `(def)` | `ui/settings.mjs` | `api.settings.registerWindow(def)`: a neighbouring module arranges its settings in sub-tabs in its tab of the DAS window. To call at its `init` (or its `setup`), after declaring its settings. `def`: `{ namespace, title,… |

## `api.sneak`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.sneak.check` | `()` | `runtime/stealth.mjs` | `bg3` rules: judge the displayed scene right away (who enters whose view, Stealth checks, spotting). To be run on the active GM. |
| `api.sneak.is` | `(token)` | `adapter/stealth.mjs` | Is the token (or actor) hidden? |
| `api.sneak.rules` | `()` | `runtime/stealth.mjs` | The world's stealth rules (setting `stealthRules`): `"2024"`, `"bg3"` or `"off"` (not handled, issue #65). |
| `api.sneak.set` | `(token, on=undefined)` | `runtime/stealth.mjs` | Hide or stop being hidden (`on` absent: toggle). |
| `api.sneak.spottedBy` | `(token)` | `adapter/stealth.mjs` | The tokens that have spotted this hidden token (ids, BG3 rules). |
| `api.sneak.toggle` | `(token)` | `runtime/stealth.mjs` | Toggles the token's Stealth action (hidden ↔ visible), like the Alt+C shortcut → `{ hidden, … }` (the result of `set`). |

## `api.theater`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.theater.active` | `()` | `runtime/theater-state.mjs` | Is Theater of the Mind active (automations switched off)? |
| `api.theater.set` | `(on)` | `runtime/theater.mjs` | Toggles Theater of the Mind (GM). |

## `api.ui`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.ui.awaiting` | `()` | `ui/awaiting.mjs` | `api.ui.awaiting()`: the waits in progress known to this client (public form), and what this client shows of them. |
| `api.ui.budget` | `(combatant)` | `ui/api.mjs` | The budget of a combatant's turn, as the engine judges it: an action stays available as long as the Attack action has attacks left to give; the Reaction follows "not two in the same turn" (§19.6). null outside a started… |
| `api.ui.carriedLight` | `(item)` | `ui/api.mjs` | The state of a carried light source (item or uuid): `{ uuid, name, img, lit, left, full, fuel }`, or null if the item is not one. |
| `api.ui.carriedLights` | `(actor)` | `ui/api.mjs` | §121: `carriedLights(actor)` — the actor's carried light sources: `{ uuid, name, img, lit, left, full, fuel }` (`left`, `full` in seconds or null; `fuel`: `{ identifier, name, quantity }` or null). `toggleLight(item, on… |
| `api.ui.cell` | `(activity)` | `ui/api.mjs` | §205: the reasons (`issues`) and the cost (`cost`) of an interface cell in a single computation. Both go through `useIssues`: a bar that asked for them separately did it twice per cell (28 cells: ~14 ms each, measured o… |
| `api.ui.cost` | `(activity)` | `ui/api.mjs` | §137: what this activity would cost the turn's budget, as the engine will judge it — "action", "bonus", "reaction", something else or null. Differs from the data's activation when a rule changes it (Observant: Search as… |
| `api.ui.cover` | `(attacker, target, activity, options={})` | `ui/api.mjs` | #33: the Cover `target` would have against an attack by `attacker` with `activity`, as THIS client can show it — the computation of the verdict, but a player counts only the creatures they see (the Invisible does not gi… |
| `api.ui.doorMenu` | `(wall)` | `ui/pointer-menu.mjs` | The menu of a door (`wall`: Wall, WallDocument or id) and that of a cell (`point`: `{ x, y }` of the scene) for the token in hand, like `menuEntriesFor`: the same entries as the right click, those of the neighbours incl… |
| `api.ui.globalLight` | `()` | `ui/illumination.mjs` | What the displayed scene's global light gives, per the engine's rules (§16.52: darkness range, "bright", twilight) — for a display module that wants the same "full daylight" as the rules (`api.ui.globalLight`, §40.2). @… |
| `api.ui.groundMenu` | `(point)` | `ui/pointer-menu.mjs` | The menu of a cell (`point`: `{ x, y }` of the scene) for the token in hand: `[{ icon, label, run }]`, neighbours included; empty without a token in hand. |
| `api.ui.issues` | `(activity, options={})` | `ui/api.mjs` | What is wrong if this activity were used now, before knowing who it targets (budget and turn, slot already cast this turn, Silence, usage limits, conditions that prevent acting, Rage): the reasons, translated; empty = n… |
| `api.ui.light` | `(token)` | `ui/illumination.mjs` | The light a token stands in, for an interface (`api.light`, requested by Darsh UI DnD5 on 2026-09-27). @param {Token\|TokenDocument} token @returns {{key: "bright"\|"dim"\|"dark"\|"magical", icon: string, name: string, tool… |
| `api.ui.movableZone` | `(activity)` | `ui/api.mjs` | §111: does the activity have a movable area already placed (Moonbeam)? Using it then moves it (ui/pointer.mjs, §16.14): nothing is cast, no slot is spent — an interface must neither gray it out for lack of a slot nor as… |
| `api.ui.movement` | `(token)` | `ui/api.mjs` | The movement of a token's turn in combat, in the grid's unit: spent (stairs and survey included, teleports excluded), allowed (speed, Dash, movement opened by an effect), and what **really** remains — the cap the engine… |
| `api.ui.multiattackLeft` | `(actor)` | `ui/api.mjs` | §18.19: what remains of the Multiattack opened this turn by this actor — uuids of the items still playable (`left`), of those of the plan that have nothing left (`spent`), names of the first ones. null with no open plan… |
| `api.ui.potion` | `(activity)` | `ui/api.mjs` | Issue #31: `potion(activity)` — the house rule for healing potions (setting `potionHealing`): null if it does not apply (setting off, something other than a healing potion as a Bonus Action); otherwise `{ ask, mode, ava… |
| `api.ui.ritual` | `(activity)` | `ui/api.mjs` | §139: how this spell would be cast now — "ritual": as a ritual outright (no slot, even unprepared with Ritual Adept); "ask": the player will choose ritual or slot; "none": as usual. An interface does not gray out a "rit… |
| `api.ui.spellWeapons` | `(actor)` | `ui/api.mjs` | §554: the actor's active spell weapons (a spell that puts an attack in hand while it lasts: Flame Blade, Produce Flame) — `[{ uuid, item, itemId, activityId, effect, name, img, level, favorite }]`, `uuid` the attack act… |
| `api.ui.targeting` | `()` | `ui/pointer.mjs` | §118: the aiming this client is waiting for, for neighbouring modules (`api.ui.targeting()`) — while it is open, the left click belongs to the engine, whatever is under the mouse (corpse, chest, merchant). `{ token, act… |
| `api.ui.timer` | `({ token, seconds, label="", icon="gear", id=null }={})` | `ui/timers.mjs` | Starts a timer above a token, on all connected clients. @param {{token: TokenDocument\|Token\|string, seconds: number, label?: string, icon?: string, id?: string}} options @returns {{id: string, done: Promise<void>, stop:… |
| `api.ui.toggleLight` | `(item, on=null)` | `ui/api.mjs` | §121: turns a carried source on or off (item or uuid; `on` absent: the opposite), on the bearer's client → `{ changed, lit?, left?, refilled?, reason? }`. |
| `api.ui.tokenMenu` | `(target)` | `ui/pointer-menu.mjs` | §41.4: the entries of a token's context menu, for an interface that wants to offer them elsewhere than on the canvas (the Party portrait of Darsh UI DnD5): what the token in hand (the only one controlled, one's own) can… |
| `api.ui.wards` | `(actor)` | `ui/api.mjs` | §108: the pools that absorb this actor's damage, active (Arcane Ward created since the last Long Rest): remaining points and maximum (the item's uses, adapter/absorb.mjs). Empty with no active pool. @param {Actor5e} act… |

## `api.vanilla`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.vanilla.is` | `(x)` | `adapter/vanilla-state.mjs` | Does this document, these data or this configuration come from an action cast without DAS? Follows dnd5e's links to the originating card or the Concentration (one level, no chain). |
| `api.vanilla.use` | `(subject, { event=null }={})` | `runtime/vanilla.mjs` | Uses an item or an activity through dnd5e alone (§395). An item with several activities opens dnd5e's choice. @param {Item\|object} subject Item5e or activity. @param {object} [options] @param {Event} [options.event] The… |

## `api.vision`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.vision.canHear` | `(observer, target)` | `dnd5e-combat.mjs` | §186: the engine's hearing for a neighbor (read-only) — walls and floors that stop sound, Deafened, hidden target; no range. |
| `api.vision.canSee` | `(observer, target)` | `dnd5e-combat.mjs` | §178: the engine's vision for a neighbor (read-only) — null when simulated vision is off or cannot judge. |
| `api.vision.cone` | `(token)` | `dnd5e-combat.mjs` | §182: a creature's vision cone (`{ angle, rotation }`, core convention), or null when it sees in 360°. |
| `api.vision.locates` | `(observer, target)` | `dnd5e-combat.mjs` | Is the target's position known to the observer: they see it, or a sense that is not sight locates it (Tremorsense)? Issue #107: such a sense also pinpoints a creature Hidden from the observer, which stays unseen (`canSe… |
| `api.vision.sensed` | `(observer, target)` | `dnd5e-combat.mjs` | What a sense declared by content (`sense`) tells the observer about the target: `"sight"` (sight), `"locate"` (position known, not seen), `"presence"` (presence known, not the position), `"aura"` (an aura on the creatur… |

## `api.waits`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.waits.force` | `(id)` | `dnd5e-combat.mjs` | GM: forces the wait `id` (the player's client resolves its windows as at the end of the delay) → true if the wait existed; false for a player. |
| `api.waits.list` | `()` | `adapter/player-wait.mjs` | Les attentes en cours, la plus ancienne d'abord. |
| `api.waits.open` | `()` | `ui/player-waits.mjs` | Opens (or brings to the front) the "GM Queue" panel, GM only. |

## `api.welcome`

| Chemin | Signature | Fichier | Description |
|---|---|---|---|
| `api.welcome.open` | `()` | `ui/welcome.mjs` | Pour l'API : ouvrir l'accueil. |
