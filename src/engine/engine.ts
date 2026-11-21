import { evaluateCondition } from "./conditions";
import { advanceToNextEvent } from "./scheduler";
import { createInitialState } from "./state";
import { assertValidStory } from "./validation";
import { applyResolution, assertChoiceBelongsToEvent, choiceIsAvailable, cloneState, findResolution } from "./resolver";
import type { ChoiceDefinition, GameState, StoryDefinition, StoryEvent } from "./types";

export function startGame(story: StoryDefinition, seed: string): GameState {
  assertValidStory(story);
  const state = createInitialState(story, seed);
  const first = story.events.find((event) => event.id === story.startEventId);
  if (!first || first.kind !== "main" || !evaluateCondition(first.when, state)) {
    throw new Error("Start event must exist, be a main event, and satisfy its conditions");
  }
  return state;
}

export function getCurrentEvent(state: GameState, story: StoryDefinition): StoryEvent {
  if (!state.currentEventId) throw new Error("Game state has no current event");
  const event = story.events.find((candidate) => candidate.id === state.currentEventId);
  if (!event) throw new Error("Current event does not exist: " + state.currentEventId);
  return event;
}

export function getAvailableChoices(event: StoryEvent, state: GameState): ChoiceDefinition[] {
  return (event.choices ?? []).filter((choice) => choiceIsAvailable(choice, state));
}

function schedulePressureReversals(state: GameState, story: StoryDefinition, sourceEventId: string): void {
  for (const rule of story.pressureRules) {
    const current = state.pressures[rule.name] ?? 0;
    if (current < rule.threshold || state.triggeredPressures.includes(rule.name)) continue;

    state.triggeredPressures.push(rule.name);
    if (!state.pending.some((item) => item.eventId === rule.eventId)) {
      state.pending.push({
        eventId: rule.eventId,
        dueAtTurn: state.turn + 1,
        scheduledFrom: sourceEventId,
        reason: rule.reason
      });
    }
  }
}

export function chooseOption(state: GameState, story: StoryDefinition, choiceId: string): GameState {
  if (state.ended) throw new Error("The story has already ended");
  const nextState = cloneState(state);
  const event = getCurrentEvent(nextState, story);
  if (event.kind === "ending") throw new Error("Ending events cannot receive choices");

  const choice = event.choices?.find((candidate) => candidate.id === choiceId);
  if (!choice) throw new Error("Unknown choice: " + choiceId);
  assertChoiceBelongsToEvent(choice, event.id, story);
  if (!choiceIsAvailable(choice, nextState)) throw new Error("Choice is not available: " + choiceId);

  const resolution = findResolution(choice, nextState);
  applyResolution(nextState, resolution, event.id);
  schedulePressureReversals(nextState, story, event.id);
  nextState.completedEvents.push(event.id);
  nextState.history.push({
    turn: nextState.turn,
    eventId: event.id,
    eventTitle: event.title,
    choiceId: choice.id,
    choiceText: choice.text,
    ruleId: resolution.id,
    outcome: resolution.outcome,
    narrative: resolution.narrative
  });
  nextState.lastResult = {
    eventTitle: event.title,
    choiceText: choice.text,
    narrative: resolution.narrative,
    outcome: resolution.outcome
  };

  if (event.kind === "main") {
    nextState.turn += 1;
    nextState.time.month += 1;
    nextState.offerRandom = story.randomPerMainEvent;
  }

  nextState.currentEventId = null;
  return advanceToNextEvent(nextState, story);
}

export function getEventChoice(state: GameState, story: StoryDefinition, choiceId: string): ChoiceDefinition | undefined {
  const event = getCurrentEvent(state, story);
  return event.choices?.find((choice) => choice.id === choiceId);
}
