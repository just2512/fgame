import { evaluateCondition } from "./conditions";
import type { ChoiceDefinition, Effect, GameState, ResolutionRule, StoryDefinition } from "./types";

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function applyEffect(state: GameState, effect: Effect, sourceEventId: string): void {
  switch (effect.type) {
    case "force.delta": {
      const force = state.forces[effect.force];
      if (!force) throw new Error("Unknown force: " + effect.force);
      const previous = force.value;
      force.value = clamp(previous + effect.delta);
      force.trend = force.value > previous ? "rising" : force.value < previous ? "falling" : "stable";
      return;
    }
    case "force.phase": {
      const force = state.forces[effect.force];
      if (!force) throw new Error("Unknown force: " + effect.force);
      force.phase = effect.phase;
      return;
    }
    case "skill.delta": {
      const current = state.player.skills[effect.skill];
      if (current === undefined) throw new Error("Unknown skill: " + effect.skill);
      state.player.skills[effect.skill] = clamp(current + effect.delta, 0, 5);
      return;
    }
    case "standing.set":
      state.player.standing[effect.key] = effect.value;
      return;
    case "npc.delta": {
      const npc = state.npcs[effect.npcId];
      if (!npc) throw new Error("Unknown NPC: " + effect.npcId);
      npc[effect.metric] = clamp(npc[effect.metric] + effect.delta);
      return;
    }
    case "flag.set":
      state.flags[effect.name] = effect.value;
      return;
    case "pressure.delta":
      state.pressures[effect.name] = clamp((state.pressures[effect.name] ?? 0) + effect.delta);
      return;
    case "trajectory.add":
      if (!state.trajectory.includes(effect.tag)) state.trajectory.push(effect.tag);
      return;
    case "disposition.delta":
      state.player.disposition[effect.trait] = (state.player.disposition[effect.trait] ?? 0) + effect.delta;
      return;
    case "schedule":
      if (!state.pending.some((item) => item.eventId === effect.eventId && item.scheduledFrom === sourceEventId)) {
        state.pending.push({
          eventId: effect.eventId,
          dueAtTurn: state.turn + effect.afterTurns,
          scheduledFrom: sourceEventId,
          reason: effect.reason
        });
      }
      return;
  }
}

export function findResolution(choice: ChoiceDefinition, state: GameState): ResolutionRule {
  const rule = choice.resolve.find((candidate) => evaluateCondition(candidate.when, state));
  if (!rule) throw new Error("No matching resolution for choice: " + choice.id);
  return rule;
}

export function applyResolution(state: GameState, rule: ResolutionRule, sourceEventId: string): void {
  for (const effect of rule.effects) applyEffect(state, effect, sourceEventId);
}

export function choiceIsAvailable(choice: ChoiceDefinition, state: GameState): boolean {
  return evaluateCondition(choice.requires, state);
}

export function cloneState(state: GameState): GameState {
  return structuredClone(state);
}

export function assertChoiceBelongsToEvent(choice: ChoiceDefinition, eventId: string, story: StoryDefinition): void {
  const event = story.events.find((candidate) => candidate.id === eventId);
  if (!event?.choices?.some((candidate) => candidate.id === choice.id)) {
    throw new Error("Choice " + choice.id + " does not belong to event " + eventId);
  }
}
