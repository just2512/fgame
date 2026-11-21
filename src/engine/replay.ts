import { chooseOption } from "./engine";
import { startGame } from "./engine";
import type { GameState, StoryDefinition } from "./types";

export interface ReplayStep {
  eventId: string;
  choiceId: string;
}

export function replayChoices(story: StoryDefinition, seed: string, steps: ReplayStep[]): GameState {
  let state = startGame(story, seed);

  for (const step of steps) {
    if (state.currentEventId !== step.eventId) {
      throw new Error("Replay diverged: expected " + step.eventId + " but current event is " + state.currentEventId);
    }
    state = chooseOption(state, story, step.choiceId);
  }

  return state;
}
