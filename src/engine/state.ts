import { hashSeed } from "./rng";
import type { GameState, StoryDefinition } from "./types";

export function createInitialState(story: StoryDefinition, seed: string): GameState {
  return {
    saveVersion: 1,
    storyId: story.id,
    storyVersion: story.version,
    seed,
    rngState: hashSeed(seed),
    turn: 0,
    time: structuredClone(story.initial.time),
    player: structuredClone(story.initial.player),
    forces: structuredClone(story.initial.forces),
    npcs: structuredClone(story.initial.npcs),
    flags: structuredClone(story.initial.flags),
    pressures: structuredClone(story.initial.pressures),
    trajectory: [],
    pending: [],
    completedEvents: [],
    history: [],
    currentEventId: story.startEventId,
    offerRandom: false,
    ended: false,
    lastResult: null
  };
}
