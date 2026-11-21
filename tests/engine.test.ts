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
    expect(noviceResult.forces.company_health.value).toBe(37);

    const experienced = startGame(story, "takeover-test");
    experienced.player.skills.management = 4;
    const experiencedResult = chooseOption(experienced, story, "take_over");
    expect(experiencedResult.flags.rash_takeover).toBe(false);
    expect(experiencedResult.forces.company_health.value).toBe(49);
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

  it("matches an ending and always has a fallback", () => {
    let state = startGame(noRandomStory, "ending-test");
    state = chooseOption(state, noRandomStory, "enjoy_new_life");
    state = chooseOption(state, noRandomStory, "attend_board");
    state = chooseOption(state, noRandomStory, "wait_one_week");
    state = chooseOption(state, noRandomStory, "decline_for_now");
    const ending = getCurrentEvent(state, noRandomStory);
    expect(ending.kind).toBe("ending");
    expect(ending.id).toBe("ending_independent");
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
