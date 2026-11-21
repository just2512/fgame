import { describe, expect, it } from "vitest";
import storyJson from "../src/content/sudden-billionaire.json";
import { chooseOption, getAvailableChoices, getCurrentEvent, startGame } from "../src/engine/engine";
import { replayChoices } from "../src/engine/replay";
import { evaluateCondition } from "../src/engine/conditions";
import { validateStory } from "../src/engine/validation";
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
      ...(event.choices ?? []).map((choice) => choice.text)
    ].join(" ")).join(" ");
    expect(visibleText).not.toMatch(/卦|爻|吉凶|起卦|变卦/);
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

    const experienced = startGame(story, "takeover-test");
    experienced.player.skills.management = 4;
    const experiencedResult = chooseOption(experienced, story, "take_over");
    expect(experiencedResult.flags.rash_takeover).toBe(false);
    expect(experiencedResult.forces.company_health?.value).toBe(49);
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
      {eventId:"ajie_call",choiceId:"decline_for_now"}
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
      {eventId:"ajie_call",choiceId:"decline_for_now"}
    ])).toBe("ending_open");
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
