import { evaluateCondition } from "./conditions";
import { nextRandom } from "./rng";
import type { GameState, StoryDefinition, StoryEvent } from "./types";

function eventMap(story: StoryDefinition): Map<string, StoryEvent> {
  return new Map(story.events.map((event) => [event.id, event]));
}

function takeDueConsequence(state: GameState, story: StoryDefinition): StoryEvent | null {
  const events = eventMap(story);
  const due = state.pending
    .filter((item) => item.dueAtTurn <= state.turn)
    .sort((left, right) => left.dueAtTurn - right.dueAtTurn);

  for (const pending of due) {
    state.pending = state.pending.filter((item) => item !== pending);
    const event = events.get(pending.eventId);
    if (!event || state.completedEvents.includes(event.id)) continue;
    if (evaluateCondition(event.when, state)) return event;
  }
  return null;
}

export function advanceToNextEvent(state: GameState, story: StoryDefinition): GameState {
  const nextState = structuredClone(state);
  if (nextState.currentEventId) return nextState;

  const dueEvent = takeDueConsequence(nextState, story);
  if (dueEvent) {
    nextState.currentEventId = dueEvent.id;
    return nextState;
  }

  if (nextState.offerRandom) {
    nextState.offerRandom = false;
    const candidates = story.events.filter((event) =>
      event.kind === "random" &&
      !nextState.completedEvents.includes(event.id) &&
      evaluateCondition(event.when, nextState)
    );
    const chance = Math.max(0, Math.min(1, story.randomChance));
    const chanceRoll = nextRandom(nextState.rngState);
    nextState.rngState = chanceRoll.state;

    if (candidates.length > 0 && chanceRoll.value < chance) {
      const totalWeight = candidates.reduce((sum, event) => sum + Math.max(0, event.weight ?? 1), 0);
      if (totalWeight > 0) {
        const pickRoll = nextRandom(nextState.rngState);
        nextState.rngState = pickRoll.state;
        let cursor = pickRoll.value * totalWeight;
        for (const event of candidates) {
          cursor -= Math.max(0, event.weight ?? 1);
          if (cursor < 0) {
            nextState.currentEventId = event.id;
            return nextState;
          }
        }
        nextState.currentEventId = candidates[candidates.length - 1]?.id ?? null;
        if (nextState.currentEventId) return nextState;
      }
    }
  }

  const mainEvent = story.events
    .filter((event) =>
      event.kind === "main" &&
      !nextState.completedEvents.includes(event.id) &&
      evaluateCondition(event.when, nextState)
    )
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))[0];

  if (mainEvent) {
    nextState.currentEventId = mainEvent.id;
    return nextState;
  }

  const ending = story.events
    .filter((event) => event.kind === "ending" && evaluateCondition(event.when, nextState))
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0]
    ?? story.events.find((event) => event.id === story.fallbackEndingId);

  if (!ending) throw new Error("No eligible ending and no fallback ending is defined");
  nextState.currentEventId = ending.id;
  nextState.ended = true;
  return nextState;
}
