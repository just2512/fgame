import { describe, expect, it } from "vitest";
import storyJson from "../src/content/sudden-billionaire.json";
import { chooseOption, getAvailableChoices, getCurrentEvent, startGame } from "../src/engine/engine";
import { replayChoices } from "../src/engine/replay";
import { evaluateCondition } from "../src/engine/conditions";
import { validateStory } from "../src/engine/validation";
import { hashSeed, nextRandom } from "../src/engine/rng";
import { loadSave, removeSave, saveGame } from "../src/engine/storage";
import "fake-indexeddb/auto";
import type { StoryDefinition } from "../src/engine/types";

const story = storyJson as StoryDefinition;
const noRandomStory: StoryDefinition = { ...story, randomChance: 0 };

describe("story definition", () => {
  it("has unique event ids, valid delayed references and fallback ending", () => {
    expect(validateStory(story)).toEqual([]);
  });

  it("does not expose 易经 terminology in player-facing story content", () => {
    const visibleText = story.events.map((event) => [
      event.title,
      event.scene,
      event.reflection ?? "",
      ...(event.choices ?? []).flatMap((choice) => [
        choice.text,
        ...choice.resolve.map((rule) => rule.narrative)
      ])
    ].join(" ")).join(" ");
    expect(visibleText).not.toMatch(/卦|爻|阴阳|吉凶|起卦|变卦|物极必反|盛极而衰|否极泰来|天命|命中注定|报应/);
  });
});

describe("deterministic narrative engine", () => {
  it("starts at the authored first scene", () => {
    const state = startGame(story, "prototype-seed");
    expect(state.currentEventId).toBe("inheritance_meeting");
    expect(getCurrentEvent(state, story).kind).toBe("main");
  });

  it("replays the same seed and choices to an identical state", () => {
    const steps = [
      { eventId: "inheritance_meeting", choiceId: "hire_auditors" },
      { eventId: "audit_findings", choiceId: "preserve_evidence" },
      { eventId: "cashflow_report", choiceId: "private_cashflow_review" },
      { eventId: "ajie_call", choiceId: "review_project" }
    ];

    const first = replayChoices(noRandomStory, "same-seed", steps);
    const second = replayChoices(noRandomStory, "same-seed", steps);
    expect(first).toEqual(second);
  });

  it("changes the takeover result when the player's position and ability differ", () => {
    const novice = startGame(story, "takeover-test");
    const noviceResult = chooseOption(novice, story, "take_over");
    expect(noviceResult.flags.rash_takeover).toBe(true);
    expect(noviceResult.forces.company_health?.value).toBe(37);
    expect(noviceResult.forces.control?.value).toBe(22);
    expect(noviceResult.npcs.uncle?.rivalry).toBe(24);
    expect(noviceResult.npcs.chen?.trust).toBe(52);
    expect(noviceResult.pending.map(item => item.eventId)).toContain("uncle_reassessment");

    const experienced = startGame(story, "takeover-test");
    experienced.player.skills.management = 4;
    const experiencedResult = chooseOption(experienced, story, "take_over");
    expect(experiencedResult.flags.rash_takeover).toBe(false);
    expect(experiencedResult.forces.company_health?.value).toBe(49);
    expect(experiencedResult.forces.control?.value).toBe(32);
    expect(experiencedResult.npcs.uncle?.rivalry).toBe(20);
    expect(experiencedResult.npcs.chen?.trust).toBe(64);
    expect(experiencedResult.pending.map(item => item.eventId)).toContain("uncle_reassessment");
    expect(experiencedResult).not.toEqual(noviceResult);
  });

  it("fires a scheduled consequence before the next main scene", () => {
    const state = chooseOption(startGame(story, "delay-test"), story, "hire_auditors");
    expect(state.currentEventId).toBe("audit_findings");
    expect(state.pending).toHaveLength(0);
  });

  it("hides options whose contextual requirements are not met", () => {
    const state = startGame(noRandomStory, "visibility-test");
    const firstEvent = getCurrentEvent(state, noRandomStory);
    expect(getAvailableChoices(firstEvent, state).map((choice) => choice.id)).toContain("hire_auditors");

    const afterTakeover = chooseOption(state, noRandomStory, "take_over");
    expect(afterTakeover.currentEventId).toBe("uncle_reassessment");
    const afterDelayed = chooseOption(afterTakeover, noRandomStory, "set_clear_boundaries");
    const cashflow = getCurrentEvent(afterDelayed, noRandomStory);
    expect(getAvailableChoices(cashflow, afterDelayed).map((choice) => choice.id)).not.toContain("private_cashflow_review");
  });

  it("offers a contextual random event only when its conditions are satisfied", () => {
    const alwaysRandom: StoryDefinition = { ...story, randomChance: 1 };
    const state = chooseOption(startGame(alwaysRandom, "random-event-test"), alwaysRandom, "enjoy_new_life");
    expect(state.currentEventId).toBe("board_pressure");

    const afterDelayed = chooseOption(state, alwaysRandom, "attend_board");
    const event = getCurrentEvent(afterDelayed, alwaysRandom);
    expect(event.kind).toBe("random");
    expect(["media_sighting", "old_classmate_party"]).toContain(event.id);
  });

  it("turns an accumulated pressure threshold into one delayed reversal event", () => {
    let state = startGame(noRandomStory, "pressure-test");
    state = chooseOption(state, noRandomStory, "enjoy_new_life");
    state = chooseOption(state, noRandomStory, "delegate_for_now");
    expect(state.currentEventId).toBe("cashflow_report");
    expect(state.triggeredPressures).toContain("complacency");

    state = chooseOption(state, noRandomStory, "wait_one_week");
    expect(state.currentEventId).toBe("reversal_complacency");

    state = chooseOption(state, noRandomStory, "keep_distance_from_business");
    expect(state.triggeredPressures.filter((name) => name === "complacency")).toHaveLength(1);
    expect(state.pending.some((item) => item.eventId === "reversal_complacency")).toBe(false);
  });

  it("matches an ending and always has a fallback", () => {
    let state = startGame(noRandomStory, "ending-test");
    state = chooseOption(state, noRandomStory, "enjoy_new_life");
    state = chooseOption(state, noRandomStory, "attend_board");
    state = chooseOption(state, noRandomStory, "wait_one_week");
    expect(state.currentEventId).toBe("reversal_complacency");
    state = chooseOption(state, noRandomStory, "face_accumulated_issues");
    expect(state.currentEventId).toBe("ajie_call");
    state = chooseOption(state, noRandomStory, "decline_for_now");
    expect(state.currentEventId).toBe("reversal_austerity");
    state = chooseOption(state, noRandomStory, "try_small_pilot");
    const ending = getCurrentEvent(state, noRandomStory);
    expect(ending.kind).toBe("ending");
    expect(ending.id).toBe("ending_independent");
  });

  it("has an authored reachable route to every stage ending", () => {
    const runPath = (steps: Array<{ eventId: string; choiceId: string }>) => {
      let state = startGame(noRandomStory, "ending-reachability");
      for (const step of steps) {
        expect(state.currentEventId).toBe(step.eventId);
        state = chooseOption(state, noRandomStory, step.choiceId);
      }
      return getCurrentEvent(state, noRandomStory).id;
    };

    expect(runPath([
      {eventId:"inheritance_meeting",choiceId:"take_over"},
      {eventId:"uncle_reassessment",choiceId:"set_clear_boundaries"},
      {eventId:"cashflow_report",choiceId:"open_board_meeting"},
      {eventId:"ajie_call",choiceId:"review_project"}
    ])).toBe("ending_controlled");

    expect(runPath([
      {eventId:"inheritance_meeting",choiceId:"hire_auditors"},
      {eventId:"audit_findings",choiceId:"preserve_evidence"},
      {eventId:"cashflow_report",choiceId:"private_cashflow_review"},
      {eventId:"ajie_call",choiceId:"help_with_connections"}
    ])).toBe("ending_friendship");

    expect(runPath([
      {eventId:"inheritance_meeting",choiceId:"enjoy_new_life"},
      {eventId:"board_pressure",choiceId:"attend_board"},
      {eventId:"cashflow_report",choiceId:"wait_one_week"},
      {eventId:"reversal_complacency",choiceId:"face_accumulated_issues"},
      {eventId:"ajie_call",choiceId:"decline_for_now"},
      {eventId:"reversal_austerity",choiceId:"try_small_pilot"}
    ])).toBe("ending_independent");

    expect(runPath([
      {eventId:"inheritance_meeting",choiceId:"trust_uncle"},
      {eventId:"uncle_reassessment",choiceId:"set_clear_boundaries"},
      {eventId:"cashflow_report",choiceId:"delegate_uncle"},
      {eventId:"reversal_favor_debt",choiceId:"draw_a_clear_boundary"},
      {eventId:"ajie_call",choiceId:"decline_for_now"}
    ])).toBe("ending_held_back");

    expect(runPath([
      {eventId:"inheritance_meeting",choiceId:"hire_auditors"},
      {eventId:"audit_findings",choiceId:"preserve_evidence"},
      {eventId:"cashflow_report",choiceId:"wait_one_week"},
      {eventId:"ajie_call",choiceId:"decline_for_now"},
      {eventId:"reversal_austerity",choiceId:"try_small_pilot"}
    ])).toBe("ending_open");
  });


  it("makes excessive retreat trigger a one-shot opportunity-cost reversal", () => {
    let state = startGame(noRandomStory, "austerity-test");
    state = chooseOption(state, noRandomStory, "enjoy_new_life");
    state = chooseOption(state, noRandomStory, "attend_board");
    state = chooseOption(state, noRandomStory, "wait_one_week");
    expect(state.currentEventId).toBe("reversal_complacency");
    state = chooseOption(state, noRandomStory, "face_accumulated_issues");
    expect(state.currentEventId).toBe("ajie_call");

    state = chooseOption(state, noRandomStory, "decline_for_now");
    expect(state.triggeredPressures).toContain("austerity");
    expect(state.currentEventId).toBe("reversal_austerity");

    const retained = chooseOption(state, noRandomStory, "keep_everything_in_reserve");
    expect(retained.currentEventId).toBe("ending_independent");
    expect(retained.forces.market_cycle?.value).toBeLessThan(state.forces.market_cycle?.value ?? 100);
    expect(retained.triggeredPressures.filter(name => name === "austerity")).toHaveLength(1);
  });

  it("replays an IndexedDB save/load interruption identically through the remaining story", async () => {
    await removeSave();
    const checkpoint = chooseOption(startGame(story, "indexeddb-replay-seed"), story, "enjoy_new_life");
    expect(checkpoint.currentEventId).toBe("board_pressure");
    expect(checkpoint.offerRandom).toBe(true);

    await saveGame(checkpoint);
    const restored = await loadSave();
    expect(restored).toEqual(checkpoint);
    if (!restored) throw new Error("Expected a saved game to be restored");

    let uninterrupted = chooseOption(checkpoint, story, "attend_board");
    let resumed = chooseOption(restored, story, "attend_board");
    expect(resumed).toEqual(uninterrupted);

    for (let step = 0; step < 32 && !uninterrupted.ended; step += 1) {
      const event = getCurrentEvent(uninterrupted, story);
      if (event.kind === "ending") break;
      const available = getAvailableChoices(event, uninterrupted);
      expect(available.length).toBeGreaterThan(0);
      const choiceId = available[0]?.id;
      if (!choiceId) throw new Error("Expected a choice in a non-ending event");
      uninterrupted = chooseOption(uninterrupted, story, choiceId);
      resumed = chooseOption(resumed, story, choiceId);
      expect(resumed).toEqual(uninterrupted);
    }

    expect(uninterrupted.ended).toBe(true);
    expect(resumed.history.map(item => item.narrative)).toEqual(uninterrupted.history.map(item => item.narrative));
    await saveGame(resumed);
    expect(await loadSave()).toEqual(uninterrupted);
    await removeSave();
  });

  it("simulates 5,000 seeded random-policy playthroughs and flags skewed ending distribution", () => {
    const randomOnlyStory: StoryDefinition = { ...story, randomChance: 0 };
    const endingIds = story.events.filter(event => event.kind === "ending").map(event => event.id);
    const counts: Record<string, number> = Object.fromEntries(endingIds.map(id => [id, 0]));
    const runCount = 5000;

    for (let run = 0; run < runCount; run += 1) {
      let state = startGame(randomOnlyStory, "random-policy-" + run);
      let policyState = hashSeed("policy-" + run);
      let steps = 0;

      while (!state.ended && steps < 32) {
        const event = getCurrentEvent(state, randomOnlyStory);
        if (event.kind === "ending") break;
        const choices = getAvailableChoices(event, state);
        expect(choices.length).toBeGreaterThan(0);
        const draw = nextRandom(policyState);
        policyState = draw.state;
        const selected = choices[Math.min(choices.length - 1, Math.floor(draw.value * choices.length))];
        if (!selected) throw new Error("Random policy could not select a choice");
        state = chooseOption(state, randomOnlyStory, selected.id);
        steps += 1;
      }

      expect(state.ended).toBe(true);
      const endingId = getCurrentEvent(state, randomOnlyStory).id;
      expect(counts[endingId]).toBeDefined();
      counts[endingId] = (counts[endingId] ?? 0) + 1;
    }

    const distribution = Object.fromEntries(endingIds.map(id => [id, {
      count: counts[id],
      share: Number(((counts[id] ?? 0) / runCount).toFixed(4))
    }]));
    console.log("5,000 seeded random-policy ending distribution:", JSON.stringify(distribution));

    for (const endingId of endingIds) {
      const share = (counts[endingId] ?? 0) / runCount;
      expect(share, endingId + " should not be practically unreachable in the random-policy sample").toBeGreaterThanOrEqual(0.01);
      expect(share, endingId + " should not dominate the random-policy sample").toBeLessThanOrEqual(0.6);
    }
  });

  it("evaluates nested all/any/not conditions without eval", () => {
    const state = startGame(story, "conditions-test");
    expect(evaluateCondition({
      all: [
        { path: "time.chapter", op: "eq", value: 1 },
        { any: [
          { path: "forces.control.value", op: "lt", value: 20 },
          { not: { path: "flags.audit_started", op: "eq", value: true } }
        ]}
      ]
    }, state)).toBe(true);
  });
});
