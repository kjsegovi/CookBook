# Native Apps, Plan 1: Shared Kotlin Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Kotlin Multiplatform shared core for the native apps. It holds the domain model, every recipe command (with results identical to the TypeScript), offline sync, local storage and the Supabase API client. It is proven by tests, before any screens exist.

**Architecture:**
- A new Gradle project at `native/`, with a `shared` KMP module targeting the JVM (fast tests), Android and iOS.
- The TypeScript `applyCommand` stays the source of truth. A Node script exports golden vectors from it, and the Kotlin port must reproduce every vector.
- The sync engine, storage and API client are ported from `src/lib/sync-engine.ts` and `src/lib/api.ts`, and tested against an in-memory fake server built on the Kotlin commands.

**Tech Stack:** Kotlin 2.x Multiplatform, kotlinx.serialization (JSON), kotlinx.coroutines, kotlinx-datetime, SQLDelight 2, Ktor client 3 (OkHttp on Android and JVM, Darwin on iOS, MockEngine in tests), and supabase-kt Auth. Gradle uses the Kotlin DSL and a version catalog.

**Spec:** `docs/superpowers/specs/2026-11-21-kmp-native-apps-design.md`

**Later plans (not in this one):**
- **Plan 2:** Compose Multiplatform screens for full parity, photos, Paprika import and print.
- **Plan 3:** Android and iOS app modules, deep links and share targets, the Supabase test project, the `native.yml` CI workflow, and retiring Capacitor.

## Global Constraints

- Minimum Android API 26; compileSdk 37 (the installed platform is `android-37.0`). Minimum iOS 17. Application and bundle id `app.cookbook.mobile`.
- JVM bytecode target 17. Gradle runs on Android Studio's bundled JDK: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"`. The Android SDK is at `~/Library/Android/sdk`, written to `native/local.properties` as `sdk.dir`, which is gitignored.
- Package root `app.cookbook.core`. All code in this plan lives in `native/shared/src/commonMain/kotlin/app/cookbook/core/` unless a platform folder is named.
- **Records keep unknown fields.** Every record type round-trips JSON keys it doesn't declare. The golden-vector comparison checks only declared fields.
- **Error parity.** Every `DomainError` message and status must equal the TypeScript text exactly, including curly quotes such as `’`. The screens show these messages.
- **No randomness in commands.** Ids come from `<operationId truncated to 90 chars>-<n in base 36>`, and time comes from the `clock` argument. Only `Ids.uuid()` (used outside commands) is random.
- The TypeScript files are the reference: `supabase/functions/_shared/{domain,commands,state-patch,aisles,recipe-schema}.ts` and `src/lib/sync-engine.ts`. When this plan and the TypeScript disagree on behaviour, the TypeScript wins. Report the gap; don't invent new behaviour.
- Library versions: use the latest stable release of each at implementation time, pinned in `native/gradle/libs.versions.toml`.

## Review Focus

1. **JavaScript number and string coercion in payloads** (`amount: ''`, `'2'`, `null`, missing). Forms send loose values, and Kotlin must coerce exactly as `Number()`, `String()` and `!!` do. Pinned in Task 3 (`JsCoercionTest`) and by the `coercion` vector scenario.
2. **Numbers that look different but are equal** (`2` vs `2.0`, `1e-7`). These must not count as a change in `statePatch` or in vector comparisons. Pinned in Task 3 (`StableJsonTest`).
3. **A record from a newer server with extra fields.** Editing it offline twice and syncing must keep those fields. Pinned in Task 2 (`unknown fields survive a round trip`) and Task 9 (`unknownFieldsSurviveOfflineEdits`).
4. **App killed with changes queued.** Reopening must replay the saved outbox, never lose or duplicate a change. Pinned in Task 9 (`outboxSurvivesRestart`) and Task 8 (`OutboxQueriesTest`).
5. **Sync attempted while signed out or with an expired token.** Queued changes are kept, not discarded as problems. Pinned in Task 9 (`unauthorisedKeepsQueue`).

---

## File Structure

```
native/
  settings.gradle.kts, build.gradle.kts, gradle.properties, gradle/libs.versions.toml
  gradlew, gradlew.bat, gradle/wrapper/*            (wrapper, Task 1)
  shared/build.gradle.kts
  shared/src/commonMain/kotlin/app/cookbook/core/
    json/StableJson.kt        canonical JSON + number formatting (Task 3)
    json/Js.kt                JavaScript coercion helpers (Task 3)
    json/Preserving.kt        serializer that keeps unknown keys (Task 2)
    domain/Model.kt           record and state data classes (Task 2)
    domain/DomainError.kt     DomainError + Ids (Task 2)
    domain/Text.kt            clean, positive, fraction, httpUrl, dates (Task 4)
    domain/Units.kt           unit table, convert, formatAmount (Task 4)
    domain/Ingredients.kt     parseIngredient, canonical, inventoryIndex (Task 4)
    domain/Recipes.kt         normalizeRecipe, normalizeNutrition, blankRecipe (Task 4)
    domain/Planning.kt        requirements, availability, reserved, autoLeftovers, generatedShopping (Task 5)
    domain/Aisles.kt          aisle keywords, aisleFor, aisleOrder (Task 5)
    sync/StatePatch.kt        statePatch, applyStatePatch (Task 5)
    commands/ApplyCommand.kt  dispatcher + shared helpers (Task 6)
    commands/RecipeCommands.kt, DraftMenuCommands.kt (Task 6)
    commands/KitchenCommands.kt (pantry, ingredients, shopping) (Task 7)
    commands/PlanCommands.kt  (plan, cook, leftovers, batches, settings) (Task 7)
    store/LocalStore.kt + sqldelight/app/cookbook/core/store/Cookbook.sq (Task 8)
    api/CookbookApi.kt, api/KtorCookbookApi.kt, api/Session.kt (Task 10)
    sync/SyncEngine.kt, sync/Problems.kt (Task 9)
    Cookbook.kt               facade used by the screens (Task 11)
  shared/src/commonTest/kotlin/app/cookbook/core/...  (tests named per task)
  shared/src/commonTest/resources/vectors/*.json      (generated, Task 1)
scripts/export-command-vectors.mjs                   (Task 1)
tests/fixtures/preview-backend.mjs                   (modify, Task 11)
```

---

### Task 1: Gradle project and golden-vector exporter

**Files:**
- Create: `native/settings.gradle.kts`, `native/build.gradle.kts`, `native/gradle.properties`, `native/gradle/libs.versions.toml`, `native/shared/build.gradle.kts`, `native/.gitignore` (`build/`, `.gradle/`, `local.properties`, `.kotlin/`)
- Create: `scripts/export-command-vectors.mjs`, `scripts/vector-scenarios.mjs`
- Modify: `package.json` (script `"vectors:export": "node scripts/export-command-vectors.mjs"`)
- Create: `native/shared/src/commonTest/resources/vectors/*.json` (generated, committed)
- Test: `native/shared/src/commonTest/kotlin/app/cookbook/core/VectorsLoadTest.kt`, `tests/vectors.test.mjs`

**Interfaces:**
- Produces: the vector file format, which every later Kotlin test reads:
```json
{ "name": "recipes-basic", "initial": { /* State */ },
  "steps": [ { "type": "recipe.save", "payload": { }, "operationId": "op-0001", "clock": "2026-11-21T10:00:00.000Z",
               "after": { /* State or null on error */ }, "patch": { /* StatePatch from previous state, or null */ },
               "error": null | { "message": "…", "status": 409 } } ] }
```
- Produces: `fun loadVectors(): List<Vector>` in `commonTest` (`VectorSupport.kt`), with `data class Vector(val name: String, val initial: JsonObject, val steps: List<VectorStep>)` and `data class VectorStep(val type: String, val payload: JsonObject, val operationId: String, val clock: String, val after: JsonObject?, val patch: JsonObject?, val error: VectorError?)`, plus `data class VectorError(val message: String, val status: Int)`. Resources are read through a `expect fun readResource(path: String): String`, with actuals for JVM, Android and iOS test source sets.

- [ ] **Step 1:** Install the Gradle wrapper. Download the latest stable Gradle 9.x distribution zip from `https://services.gradle.org/distributions/` into the scratchpad, unpack it, and from `native/` run `<unpacked>/bin/gradle wrapper --gradle-version <same>`. Expected: `native/gradlew` exists and `./gradlew --version` prints that version, using the JBR JVM.
- [ ] **Step 2:** Configure `shared/build.gradle.kts`:
  - targets `jvm()`, `androidTarget()` (namespace `app.cookbook.core`, minSdk 26, compileSdk 37), `iosArm64()`, `iosSimulatorArm64()`
  - plugins: kotlin-multiplatform, kotlinx-serialization, android-library (current KMP Android library plugin), sqldelight
  - dependencies: serialization-json, coroutines-core, datetime; in commonTest, kotlin-test and coroutines-test
  - commonTest resources dir `src/commonTest/resources`
- [ ] **Step 3: Write `scripts/vector-scenarios.mjs`.** It exports `scenarios: Array<{ name, initial?: object, steps: Array<{ type, payload, operationId, clock }> }>` covering every command and every error branch in `commands.ts`. Required scenario names:
  - `recipes-basic` (save new, save existing with and without `expectedUpdatedAt`, update incl. images/categories-only changes, favorite, rate incl. 6 → error, delete blocked by plan/leftovers, delete with related/menu cleanup, 2,001st recipe → error)
  - `recipes-import` (skip, replace, incomplete → draft, 26 → error)
  - `drafts`
  - `menus` (save, `expectedUpdatedAt` conflict, missing recipe, plan, delete)
  - `pantry-ingredients` (alias collision error, aisle preserved)
  - `shopping` (generate, toggle, save with aisle memory, purchase merge vs new row, duplicate purchase error, purchased-row errors)
  - `planning` (save cook/leftover, every plan.save error, move incl. both errors, delete errors)
  - `cooking` (cook with usage incl. `expected` mismatch and order-independent match, insufficient stock, autoLeftovers, leftover.eat, batch.update trimming)
  - `settings` (`__expected` conflict, categories 0/101 errors, aisles)
  - `coercion` (payload amounts `''`, `'2'`, `null`, missing; booleans as strings; numbers as strings)
  - `same-millisecond` (two updates with the same clock: `updatedAt` must move forward)

  Every ingredient in every payload carries an `id`, and every record payload carries an `id` unless the step tests id generation.
- [ ] **Step 4: Write `scripts/export-command-vectors.mjs`.**
  - It replaces `globalThis.crypto.randomUUID` with a function that throws `Error('Non-deterministic id in vector scenario: ' + name)`.
  - It runs each scenario through `applyCommand(state, type, payload, operationId, clock)`. Each step's `after` and `patch = statePatch(previous, after)` are recorded, or `error = { message, status }` with the state left unchanged.
  - It writes one file per scenario as `native/shared/src/commonTest/resources/vectors/<name>.json`, pretty-printed with keys sorted, so diffs stay readable.
  - With `--check`, it compares against the committed files instead of writing, and exits 1 on a difference.
- [ ] **Step 5: Write `tests/vectors.test.mjs`.**
```js
test('committed command vectors match the TypeScript commands', () => {
  execFileSync('node', ['scripts/export-command-vectors.mjs', '--check'], { stdio: 'pipe' });
});
```
- [ ] **Step 6: Run** `npm run vectors:export && npm test`. Expected: 11+ vector files written, and all tests pass (145+).
- [ ] **Step 7: Write `VectorsLoadTest`:** `loadVectors()` returns every scenario name from Step 3, and every step has exactly one of `after` or `error`.
- [ ] **Step 8: Run** `cd native && ./gradlew :shared:jvmTest`. Expected: PASS.
- [ ] **Step 9: Commit.**
```bash
git add native scripts/export-command-vectors.mjs scripts/vector-scenarios.mjs tests/vectors.test.mjs package.json
git commit -m "native: KMP shared module and TypeScript golden command vectors"
```

### Task 2: Domain model with unknown-field preservation

**Files:**
- Create: `json/Preserving.kt`, `domain/Model.kt`, `domain/DomainError.kt`
- Test: `commonTest/.../domain/ModelTest.kt`

**Interfaces:**
- Produces, in `domain/Model.kt`: `@Serializable` data classes mirroring `domain.ts` exactly. Field names and types:
  - `IngredientLine(id: String, name: String, amount: Double?, unit: String, group: String, note: String, raw: String)`
  - `Nutrition(calories: Double? = null, protein: Double? = null, carbs: Double? = null, fat: Double? = null, fiber: Double? = null, sugar: Double? = null, sodium: Double? = null, servingSize: String? = null, text: String? = null, estimated: Boolean? = null)`
  - `Recipe(id, title, description, servings: Double, prepMinutes: Double, cookMinutes: Double, category, tags: List<String>, favorite: Boolean, wantToTry: Boolean, image, sourceUrl, author, ingredients: List<IngredientLine>, steps: List<String>, notes, createdAt, updatedAt, rating: Int = 0, categories: List<String> = emptyList(), images: List<String> = emptyList(), related: List<String> = emptyList(), nutrition: Nutrition? = null)`
  - `PantryItem`, `PlanEntry(… auto: Boolean? = null)`, `PreparedBatch`, `ShoppingItem`, `ImportDraft(id, recipe: Recipe, text, warnings: List<String>, createdAt)`, `MenuItem(recipeId, day: Int, slot)`, `Menu`, `Ingredient(id, name, aliases: List<String>, aisle: String? = null)`, `Movement(id, name, amount: Double?, unit, reason, at)`, `Settings(categories: List<String>, servings: Double, weekStartsOn: Int, autoLeftovers: Boolean? = null, aisles: List<String>? = null)`
  - `State(recipes, pantry, plan, batches, shopping, shoppingWeek: String, menus: List<Menu> = emptyList(), ingredients, drafts, movements, operations: List<String>, settings: Settings, reminders: JsonArray? = null)`
  - Every class above also has `val extra: JsonObject = JsonObject(emptyMap())`, carrying unknown keys through `Preserving`.
- Produces, in `json/Preserving.kt`: `open class PreservingSerializer<T>(base: KSerializer<T>) : KSerializer<T>`. When decoding, keys not in `base.descriptor` move into `extra`; when encoding, `extra` keys are merged back. Each model class annotates `@Serializable(with = …Serializer::class)`, using an `object` subclass.
- Produces: `val CookbookJson: Json` (`ignoreUnknownKeys = false`, `explicitNulls = true`, `encodeDefaults = true`).
- Produces, in `domain/DomainError.kt`: `class DomainError(message: String, val status: Int = 400) : Exception(message)`; `object Ids { fun uuid(): String }` (expect/actual: `java.util.UUID` on JVM/Android, `NSUUID` on iOS); `fun initialState(): State` with `DEFAULT_CATEGORIES = listOf("Breakfast", "Entrées", "Sauces", "Sides", "Snacks", "Pastries & Desserts")`, servings 2.0, weekStartsOn 1, autoLeftovers true.

- [ ] **Step 1: Write `ModelTest`**
```kotlin
@Test fun unknownFieldsSurviveARoundTrip() {
    val json = """{"id":"r","title":"T","description":"","servings":2,"prepMinutes":0,"cookMinutes":0,"category":"Sides","tags":[],"favorite":false,"wantToTry":false,"image":"","sourceUrl":"","author":"","ingredients":[],"steps":[],"notes":"","createdAt":"a","updatedAt":"b","futureField":{"x":1}}"""
    val recipe = CookbookJson.decodeFromString<Recipe>(json)
    assertEquals(JsonObject(mapOf("x" to JsonPrimitive(1))), recipe.extra["futureField"])
    assertTrue(CookbookJson.encodeToString(recipe).contains("\"futureField\":{\"x\":1}"))
}
@Test fun everyVectorStateDecodesAndReencodesWithoutLoss() // for each vector's initial and every after: decode State, re-encode, stableJson-equal to source
```
- [ ] **Step 2:** Run `./gradlew :shared:jvmTest --tests '*ModelTest*'`. Expected: FAIL (unresolved references).
- [ ] **Step 3:** Implement the files listed under Interfaces.
- [ ] **Step 4:** Run the same command. Expected: PASS. (`everyVector…` depends on `stableJson` from Task 3; mark it `@Ignore` until Task 3 lands, then remove the annotation in Task 3, Step 4.)
- [ ] **Step 5:** Commit: `git commit -m "native: domain model that keeps unknown fields"`.

### Task 3: Canonical JSON and JavaScript coercion

**Files:**
- Create: `json/StableJson.kt`, `json/Js.kt`
- Test: `commonTest/.../json/StableJsonTest.kt`, `commonTest/.../json/JsCoercionTest.kt`

**Interfaces:**
- Produces:
  - `fun stableJson(e: JsonElement): String`: sorted keys, and numbers written as `jsNumberString`.
  - `fun jsNumberString(d: Double): String`: matches JavaScript `Number#toString`.
  - `fun JsonElement.sameAs(other: JsonElement): Boolean = stableJson(this) == stableJson(other)`.
  - `fun JsonElement.declaredOnly(): JsonElement`: strips `extra`-only keys using model descriptors, for vector comparison.
- Produces, the JavaScript coercions, each argument `JsonElement?` (Kotlin `null` = `undefined`):
  - `jsString(v)` = `String(v ?? '')`
  - `jsNumber(v)` = `Number(v)` (`undefined` → NaN, `null` → 0, `''` → 0, whitespace trimmed, `true` → 1)
  - `jsTruthy(v)` = `!!v`
  - `jsIsFinite(d)`

- [ ] **Step 1: Write the tests**
```kotlin
@Test fun numbersFormatLikeJavaScript() {
    assertEquals("2", jsNumberString(2.0)); assertEquals("0.1", jsNumberString(0.1))
    assertEquals("0.3333333333333333", jsNumberString(1.0 / 3)); assertEquals("1e-7", jsNumberString(1e-7))
    assertEquals("1e+21", jsNumberString(1e21)); assertEquals("-0.5", jsNumberString(-0.5))
}
@Test fun keyOrderAndNumberSpellingDoNotMatter() {
    assertTrue(Json.parseToJsonElement("""{"b":2,"a":1.0}""").sameAs(Json.parseToJsonElement("""{"a":1,"b":2.0}""")))
}
@Test fun coercionMatchesJavaScript() {
    assertEquals("", jsString(null)); assertEquals("", jsString(JsonNull)); assertEquals("2", jsString(JsonPrimitive(2.0)))
    assertEquals("1,2", jsString(JsonArray(listOf(JsonPrimitive(1), JsonPrimitive(2))))); assertEquals("[object Object]", jsString(JsonObject(emptyMap())))
    assertTrue(jsNumber(null).isNaN()); assertEquals(0.0, jsNumber(JsonNull)); assertEquals(0.0, jsNumber(JsonPrimitive(""))); assertEquals(2.0, jsNumber(JsonPrimitive(" 2 ")))
    assertTrue(jsNumber(JsonPrimitive("2a")).isNaN()); assertEquals(1.0, jsNumber(JsonPrimitive(true)))
    assertFalse(jsTruthy(JsonPrimitive(""))); assertFalse(jsTruthy(JsonPrimitive(0))); assertTrue(jsTruthy(JsonPrimitive("0")))
}
```
- [ ] **Step 2:** Run `./gradlew :shared:jvmTest --tests '*json*'`. Expected: FAIL.
- [ ] **Step 3:** Implement. `jsNumberString` follows the ECMAScript Number::toString steps: shortest round-trip digits; exponent form when the exponent is ≥ 21 or ≤ −7; integral values have no `.0`.
- [ ] **Step 4:** Run. Expected: PASS. Remove the `@Ignore` from `ModelTest.everyVectorStateDecodesAndReencodesWithoutLoss` and run all JVM tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "native: canonical JSON and JavaScript coercion helpers"`.

### Task 4: Text, units, ingredients and recipe normalisation

**Files:**
- Create: `domain/Text.kt`, `domain/Units.kt`, `domain/Ingredients.kt`, `domain/Recipes.kt`
- Modify: `scripts/export-command-vectors.mjs` (also write `vectors/helpers.json`)
- Test: `commonTest/.../domain/HelpersVectorTest.kt`

**Interfaces:**
- Produces, ports of the `domain.ts` functions with the same names and semantics (arguments that are `unknown` in TypeScript become `JsonElement?`):
  - `clean(v: JsonElement?, max: Int = 500): String`, plus `clean(s: String, max: Int = 500)`
  - `positive(v: JsonElement?, label: String, allowZero: Boolean = false): Double`
  - `fraction(v: JsonElement?): Double?`
  - `httpUrl(v: JsonElement?): String`
  - `validDate(v: JsonElement?): String`, `weekEnd(week: String): String`, `shiftDate(date: String, days: Int): String`
  - `unitInfo(unit: String): Triple<String, Double, String>`, `convert(amount: Double, from: String, to: String): Double?`, `formatAmount(n: Double?, unit: String = ""): String`
  - `parseIngredient(raw: String, id: String = Ids.uuid()): IngredientLine`
  - `canonical(state: State, name: String): String`, `inventoryIndex(state: State): InventoryIndex`
  - `normalizeNutrition(v: JsonElement?): Nutrition?`
  - `normalizeRecipe(input: JsonObject, allowIncomplete: Boolean = false, now: String, newId: () -> String = Ids::uuid): Recipe`. This one returns the input's unknown keys in `extra`, which is the deliberate difference from TypeScript.
  - `blankRecipe(id: String, now: String): Recipe`
- Produces: `vectors/helpers.json`, shaped as `{ "fraction": [[input, output]], "parseIngredient": [[raw, {amount, unit, name, note}]], "convert": [[amount, from, to, output]], "formatAmount": [[n, unit, output]], "normalizeRecipe": [[input, now, output | {error}]] }`. The exporter fills it with at least 40 parseIngredient lines (unicode fractions, ranges, mixed numbers, "salt to taste"), 20 conversions and 15 normalizeRecipe inputs (bad URLs, image-vs-images primary rules, rating clamping, related self-link, nutrition junk).

- [ ] **Step 1: Write `HelpersVectorTest`**: one `@Test` per section of `helpers.json`. Each asserts that every case's Kotlin output is `sameAs` the expected value; errors compare the message.
- [ ] **Step 2:** Run `npm run vectors:export`, then `./gradlew :shared:jvmTest --tests '*HelpersVectorTest*'`. Expected: FAIL.
- [ ] **Step 3:** Implement the four files by porting `domain.ts`, reading the TypeScript line by line. Regular expressions transfer to Kotlin `Regex` unchanged, except that JavaScript `\d` and `\s` already match Kotlin's defaults.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "native: port text, unit, ingredient and recipe helpers"`.

### Task 5: Planning, aisles and state patches

**Files:**
- Create: `domain/Planning.kt`, `domain/Aisles.kt`, `sync/StatePatch.kt`
- Test: `commonTest/.../sync/StatePatchVectorTest.kt`, `commonTest/.../domain/PlanningTest.kt`

**Interfaces:**
- Produces:
  - `requirements(state: State, inputs: List<Pair<Recipe, Double>>, inventory: InventoryIndex? = null): List<Requirement>`
  - `availability(state: State, recipe: Recipe, servings: Double = recipe.servings): List<Availability>`
  - `reserved(state: State, batchId: String, exceptId: String = ""): Double`
  - `autoLeftovers(state: State, batchId: String, remaining: Double, startDate: String): List<Pair<String, Double>>` (date to portions), `AUTO_LEFTOVER_DAYS = 4`
  - `rememberedAisle(state: State, key: String, name: String): String?`
  - `generatedShopping(state: State, week: String, makeId: () -> String): List<ShoppingItem>`
  - `DEFAULT_AISLES`, `keywordAisle(name: String): String`, `aisleFor(name: String, remembered: String?): String`, `aisleOrder(aisles: List<String>?): (String) -> Int`. These port `aisles.ts` verbatim, keyword lists included.
  - `data class StatePatch(val collections: Map<String, CollectionPatch>, val values: JsonObject, val appendOperations: List<String>)` and `data class CollectionPatch(val upsert: List<JsonObject>, val remove: List<String>, val order: List<String>? = null)`, both `@Serializable` with the TypeScript key names
  - `COLLECTIONS = listOf("recipes","pantry","plan","batches","shopping","ingredients","drafts","movements","menus")`
  - `fun statePatch(before: State, after: State): StatePatch` and `fun applyStatePatch(original: State, patch: StatePatch): State`. The operations window is kept to the last 200, as in TypeScript.

- [ ] **Step 1: Write the tests.** `StatePatchVectorTest`: for every vector step with a `patch`, `statePatch(previous, after)` is `sameAs` the recorded patch (declared fields), and `applyStatePatch(previous, patch)` is `sameAs` `after`. `PlanningTest`: `keywordAisle("frozen peas") == "Frozen"`, `keywordAisle("tomato paste") == "Canned & Jarred"`, `keywordAisle("mystery") == "Other"`, and `aisleOrder(listOf("Dairy & Eggs","Produce"))` sorts `["Produce","Other","Dairy & Eggs"]` into `["Dairy & Eggs","Produce","Other"]`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement by porting the TypeScript. `statePatch` compares rows with `sameAs` (native comparison first is unnecessary in Kotlin).
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "native: port planning, aisles and state patches"`.

### Task 6: Commands, part 1: dispatcher, recipes, drafts, menus, import

**Files:**
- Create: `commands/ApplyCommand.kt`, `commands/RecipeCommands.kt`, `commands/DraftMenuCommands.kt`
- Test: `commonTest/.../commands/CommandVectorTest.kt`

**Interfaces:**
- Produces: `fun applyCommand(original: State, type: String, payload: JsonElement?, operationId: String, clock: String? = null): State`. Semantics match `commands.ts`, in order:
  1. Return `original` if `operationId` is already in `operations`.
  2. Throw `DomainError("Action details are required.")` unless the payload is an object.
  3. Copy the state; default `menus` to empty.
  4. `at = clock ?: now`, and `nextId()` returns `"${operationId.take(90)}-${(++n).toString(36)}"`.
  5. Run the `__expected` guard for pantry.save, shopping.save, plan.save, batch.update and settings.save.
  6. Dispatch.
  7. Append `operationId`.
  8. Throw `DomainError("Unknown action.")` for an unknown type.
- Produces: `internal fun later(previous: String?, at: String): String` and `internal fun sameRecord(record: Any?, expected: String): Boolean`.
- Produces: `CommandContext(state: MutableState, payload: JsonObject, at: String, nextId: () -> String, operationId: String)`, which the area files use.
- This task implements: recipe.favorite, recipe.rate, recipe.update (with the zod `recipeChangesSchema` rules ported as explicit checks, the same first-issue error text `"Invalid recipe changes: …"` included), recipe.save, recipe.delete, recipes.import, draft.save, draft.delete, menu.save, menu.delete, menu.plan.

- [ ] **Step 1: Write `CommandVectorTest`.** It runs every step of every vector whose step types are all implemented so far, chaining state from `initial`:
```kotlin
@Test fun commandsMatchTypeScript() = forEachVectorStep(implemented = IMPLEMENTED) { previous, step ->
    val result = runCatching { applyCommand(previous, step.type, step.payload, step.operationId, step.clock) }
    if (step.error != null) {
        val e = assertIs<DomainError>(result.exceptionOrNull()); assertEquals(step.error.message, e.message); assertEquals(step.error.status, e.status); previous
    } else { val after = result.getOrThrow(); assertTrue(after.declaredJson().sameAs(step.after!!.declaredOnly()), step.name); after }
}
```
`IMPLEMENTED` is a set of command types that grows in Task 7. A scenario is skipped while any of its step types is missing.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the dispatcher and the commands listed above, reading `commands.ts` case by case. Use `Js.kt` for every coercion the TypeScript performs implicitly.
- [ ] **Step 4:** Run. Expected: PASS for `recipes-basic`, `recipes-import`, `drafts`, `menus` and `same-millisecond`.
- [ ] **Step 5:** Commit: `git commit -m "native: port recipe, draft, menu and import commands"`.

### Task 7: Commands, part 2: pantry, shopping, planning, cooking, settings

**Files:**
- Create: `commands/KitchenCommands.kt`, `commands/PlanCommands.kt`
- Modify: `commonTest/.../commands/CommandVectorTest.kt` (`IMPLEMENTED` = all ported types)

**Interfaces:**
- Consumes: `CommandContext` (Task 6), planning helpers (Task 5), ingredient helpers (Task 4).
- Implements: pantry.save, pantry.delete, ingredient.save, shopping.generate, shopping.save (including aisle memory), shopping.toggle, shopping.delete, shopping.purchase, plan.save, plan.move, plan.delete, cook, leftover.eat, batch.update, settings.save. `reminders.sync` and `reminders.ack` throw `DomainError("Unknown action.")`, because they run on the server only.

- [ ] **Step 1:** Set `IMPLEMENTED` to every command type except `reminders.*`, and add `@Test fun everyScenarioRuns()`, which asserts that no scenario is skipped.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the commands listed above.
- [ ] **Step 4:** Run all JVM tests. Expected: PASS for every scenario, including `coercion`.
- [ ] **Step 5:** Run `./gradlew :shared:iosSimulatorArm64Test`. Expected: PASS. This proves the same logic on Kotlin/Native.
- [ ] **Step 6:** Commit: `git commit -m "native: port kitchen, planning and settings commands"`.

### Task 8: Local storage

**Files:**
- Create: `shared/src/commonMain/sqldelight/app/cookbook/core/store/Cookbook.sq`, `store/LocalStore.kt`, `store/DriverFactory.kt` (expect), with actuals in `androidMain` (`AndroidSqliteDriver`), `iosMain` (`NativeSqliteDriver`) and `jvmMain` (`JdbcSqliteDriver`, used for tests)
- Test: `commonTest/.../store/OutboxQueriesTest.kt`

**Interfaces:**
- Produces, in `Cookbook.sq`, these tables (columns as named):
  - `snapshot(account TEXT PRIMARY KEY, household TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL)`
  - `outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, id TEXT NOT NULL UNIQUE, type TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL)`
  - `problem(id TEXT PRIMARY KEY, account TEXT NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL, at INTEGER NOT NULL, message TEXT NOT NULL, status INTEGER NOT NULL)`
  - `pending_upload(id TEXT PRIMARY KEY, account TEXT NOT NULL, photo_path TEXT NOT NULL, thumb_path TEXT)`
- Produces:
```kotlin
interface LocalStore {
    fun readSnapshot(account: String): Snapshot?
    fun writeSnapshot(account: String, snapshot: Snapshot)
    fun outbox(account: String): List<OutboxItem>          // oldest first
    fun replaceOutbox(account: String, items: List<OutboxItem>)   // one transaction
    fun problems(account: String): List<Problem>
    fun replaceProblems(account: String, items: List<Problem>)
    fun pendingUploads(account: String): List<PendingUpload>
    fun addPendingUpload(account: String, upload: PendingUpload); fun removePendingUpload(id: String)
    fun clearAccount(account: String)                     // sign-out
}
data class Snapshot(val householdId: String, val revision: Long, val state: State)
data class OutboxItem(val id: String, val type: String, val payload: JsonElement, val at: Long)
data class Problem(val item: OutboxItem, val message: String, val status: Int)
data class PendingUpload(val id: String, val photoPath: String, val thumbPath: String?)
class SqlLocalStore(driver: SqlDriver) : LocalStore
```

- [ ] **Step 1: Write `OutboxQueriesTest`** (JVM in-memory driver):
  - `replaceOutbox` and then `outbox` return the items in order
  - a second account's items are invisible
  - `clearAccount` removes snapshot, outbox, problems and uploads for that account only
  - a snapshot containing a recipe with an unknown field reads back with that field (`extra` survives storage)
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. States are stored as `CookbookJson.encodeToString(State)`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "native: SQLDelight store for snapshot, outbox, problems and uploads"`.

### Task 9: Sync engine

**Files:**
- Create: `sync/SyncEngine.kt`, `sync/Problems.kt`
- Test: `commonTest/.../sync/SyncEngineTest.kt`, `commonTest/.../sync/FakeServer.kt`

**Interfaces:**
- Consumes: `LocalStore` (Task 8), `applyCommand` (Tasks 6–7), `statePatch` (Task 5).
- Produces:
```kotlin
fun interface CommandSender { suspend fun send(type: String, payload: JsonElement, id: String, revision: Long): Snapshot }
fun interface SnapshotReader { suspend fun read(): Snapshot }
class SyncFailure(message: String, val status: Int) : Exception(message)   // 0 = network
data class SyncStatus(val pending: Int, val problems: List<Problem>, val offline: Boolean, val syncing: Boolean)
class SyncEngine(initial: Snapshot, account: String, store: LocalStore, sender: CommandSender, reader: SnapshotReader,
                 online: () -> Boolean, scope: CoroutineScope, retryDelayMs: (Int) -> Long = { min(60_000L, 2000L shl min(it, 5)) },
                 now: () -> Long, beforeSend: suspend () -> Unit = {}) {
    val view: StateFlow<Snapshot>; val status: StateFlow<SyncStatus>
    fun enqueue(type: String, payload: JsonElement, id: String = Ids.uuid()): String   // throws DomainError if invalid locally
    fun accept(snapshot: Snapshot); suspend fun refresh(); suspend fun drain(); suspend fun flush(): Boolean
    fun dismiss(problemId: String); fun retry(problemId: String, payload: JsonElement): String?; fun pause()
}
fun keepMine(problem: Problem, state: State): JsonElement
fun copyOfMine(problem: Problem, state: State, newId: String): JsonObject?
fun describeProblem(problem: Problem): String
```
- Behaviour is a port of `src/lib/sync-engine.ts`:
  - view = confirmed plus a replay with each item's own clock
  - incremental view on enqueue, except for coalesced types (`shopping.toggle`, `recipe.favorite`)
  - rejection = 4xx except 401/408/429 → becomes a problem and draining continues
  - a 0 or 5xx failure keeps the queue and retries with backoff; 401 keeps the queue with no timer
  - `acknowledge` rewrites `expectedUpdatedAt`, `__expected` and `usage[].expected` in later items using a local→server version map
  - `beforeSend` (photo uploads) runs before each send
  - every queue and problem change is persisted through `LocalStore` immediately

- [ ] **Step 1: Write `FakeServer`**, an in-memory server implementing `CommandSender` and `SnapshotReader` with Kotlin `applyCommand`. It has `online` and `failNext(status)` switches, and `edit(type, payload)` for "another device".
- [ ] **Step 2: Write `SyncEngineTest`** with ports of every case in `tests/sync-engine.test.mjs`, under the same names in camelCase. Add:
```kotlin
@Test fun outboxSurvivesRestart()          // enqueue offline, discard engine, new engine from same store replays view, then syncs once online
@Test fun unknownFieldsSurviveOfflineEdits() // server recipe has extra "futureField"; two offline recipe.update edits; after sync server still has futureField
@Test fun unauthorisedKeepsQueue()         // sender throws SyncFailure("Sign in", 401): pending stays 1, problems empty, no retry scheduled
@Test fun photoUploadsRunBeforeCommands()  // beforeSend records call order: upload before first send
```
- [ ] **Step 3:** Run `./gradlew :shared:jvmTest --tests '*SyncEngineTest*'` (use `runTest` with a test dispatcher). Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit: `git commit -m "native: offline sync engine with persisted outbox"`.

### Task 10: API client and session

**Files:**
- Create: `api/CookbookApi.kt`, `api/KtorCookbookApi.kt`, `api/Session.kt`, `api/Config.kt`
- Test: `commonTest/.../api/KtorCookbookApiTest.kt` (Ktor `MockEngine`)

**Interfaces:**
- Produces:
```kotlin
data class BackendConfig(val supabaseUrl: String, val publishableKey: String, val publicAppUrl: String)
interface Session { suspend fun accessToken(): String?; val userId: StateFlow<String?>; suspend fun signIn(email: String, password: String); suspend fun signOut(); suspend fun sendPasswordReset(email: String) }
class SupabaseSession(config: BackendConfig, storage: SessionStorage) : Session   // supabase-kt Auth; token refresh handled by the library
sealed interface ReadResult { data class Full(val snapshot: Snapshot) : ReadResult; data class Changes(val baseRevision: Long, val revision: Long, val householdId: String, val patch: StatePatch) : ReadResult; data class Unchanged(val revision: Long, val householdId: String) : ReadResult }
interface CookbookApi {
    suspend fun read(knownRevision: Long?): ReadResult                 // read_cookbook_changes(since) when known, else read_cookbook; falls back to read_cookbook on 404/PGRST202
    suspend fun command(type: String, payload: JsonElement, id: String, revision: Long, household: String): ReadResult   // Changes or Full
    suspend fun setFlag(type: String, recordId: String, checked: Boolean, operationId: String, revision: Long): ReadResult
    suspend fun importLink(url: String, id: String, household: String): Pair<Snapshot, String>   // snapshot, draftId
    suspend fun photoUrls(references: List<String>, variant: String): Map<String, Pair<String, String?>>   // reference -> (url, fallback)
    suspend fun uploadPhoto(id: String, photo: ByteArray, photoType: String, thumbnail: ByteArray?): String   // returns photo: reference
    suspend fun export(): JsonObject; suspend fun restore(backup: JsonObject): Snapshot
    suspend fun remindersBegin(list: String, returnUrl: String): JsonObject; suspend fun remindersStatus(syncId: String): JsonObject
}
class KtorCookbookApi(config: BackendConfig, session: Session, client: HttpClient) : CookbookApi
```
- HTTP details, from `src/lib/api.ts`:
  - RPCs: `POST {url}/rest/v1/rpc/<name>` with headers `apikey` and `Authorization: Bearer <token>`.
  - Edge Function: `{url}/functions/v1/cookbook/<path>` with `Authorization`, `apikey` and `x-household-id`.
  - Error mapping: a non-2xx response throws `SyncFailure(body.error ?: body.message, status)`. PostgREST codes map as `40001` → 409, `P0002` → 404, `42501` → 403. A network exception throws `SyncFailure(msg, 0)`.
  - Command bodies are `{type, payload, id, revision, response: "delta"}`.
  - Uploads are multipart, with fields `photo` and `thumbnail`, to `photos?id=<id>`.

- [ ] **Step 1: Write `KtorCookbookApiTest`**, asserting for each method the request path, method, headers and body, using `MockEngine`. Add the error cases: 409 with body `{"error":"This recipe changed."}` → `SyncFailure` status 409 with that message; RPC `{"code":"40001","message":"x"}` → 409; `IOException` → status 0; `read(5)` with a 404 `PGRST202` → retries `read_cookbook` and returns `Full`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. `SupabaseSession` uses the supabase-kt Auth module with a `SessionStorage` expect/actual: Android EncryptedSharedPreferences or DataStore, and iOS Keychain.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "native: Supabase API client and session"`.

### Task 11: Cookbook facade and contract test against the synthetic backend

**Files:**
- Create: `Cookbook.kt`
- Modify: `tests/fixtures/preview-backend.mjs`. Accept requests with no `Origin` header (native clients); keep the 403 for a wrong `Origin`.
- Test: `jvmTest/.../ContractTest.kt` (runs only when the environment variable `COOKBOOK_CONTRACT_URL` is set)

**Interfaces:**
- Consumes: everything above.
- Produces, the single object the screens use in Plan 2:
```kotlin
class Cookbook(config: BackendConfig, session: Session, store: LocalStore, api: CookbookApi, scope: CoroutineScope, online: () -> Boolean) {
    val account: StateFlow<String?>; val view: StateFlow<Snapshot?>; val status: StateFlow<SyncStatus>
    suspend fun open()                       // load saved snapshot for the signed-in or last account, then refresh; works offline
    fun save(type: String, payload: JsonElement): Result<Unit>   // enqueue; DomainError → Result.failure
    suspend fun refresh(); suspend fun importLink(url: String): String   // returns draft id; offline → draft with sourceUrl only
    suspend fun signOut(force: Boolean = false): Boolean   // false when unsynced changes exist and !force
}
```

- [ ] **Step 1:** Modify `preview-backend.mjs` so a request with no `Origin` is allowed, and add a test in `tests/` asserting that a no-Origin `GET /functions/v1/cookbook/state` returns 401 without a token, not 403.
- [ ] **Step 2: Write `ContractTest`.** With `COOKBOOK_CONTRACT_URL=http://127.0.0.1:54321` and the publishable key `local-preview`:
  - sign in as `qa@example.test` / `local-qa-password` (synthetic fixture account)
  - `open()` loads 54 recipes
  - `save("recipe.rate", {id: "lemon-rice", rating: 4})` then `flush()` gives a server revision of +1
  - going offline (`online = { false }`), `save("shopping.toggle", …)` keeps the change pending; back online, `flush()` is true
  - a conflicting edit made through a second `KtorCookbookApi` produces a problem with status 409
- [ ] **Step 3:** Run `node tests/fixtures/preview-backend.mjs &` then `COOKBOOK_CONTRACT_URL=http://127.0.0.1:54321 ./gradlew :shared:jvmTest --tests '*ContractTest*'`. Expected: FAIL first, then PASS after Step 4.
- [ ] **Step 4:** Implement `Cookbook`.
- [ ] **Step 5:** Run `npm test`, `./gradlew :shared:allTests` and the contract test. Expected: all PASS.
- [ ] **Step 6:** Commit: `git commit -m "native: Cookbook facade and contract test against the synthetic backend"`.
