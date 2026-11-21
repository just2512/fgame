import type { Effect, StoryDefinition } from "./types";

function validateEffect(effect: Effect, eventIds: Set<string>, forceIds: Set<string>, npcIds: Set<string>): string[] {
  const errors: string[] = [];
  if (effect.type === "force.delta" || effect.type === "force.phase") {
    if (!forceIds.has(effect.force)) errors.push("Unknown force " + effect.force);
  }
  if (effect.type === "npc.delta" && !npcIds.has(effect.npcId)) {
    errors.push("Unknown NPC " + effect.npcId);
  }
  if (effect.type === "schedule") {
    if (!eventIds.has(effect.eventId)) errors.push("Scheduled event does not exist: " + effect.eventId);
    if (!Number.isInteger(effect.afterTurns) || effect.afterTurns < 1) errors.push("schedule.afterTurns must be an integer >= 1");
  }
  return errors;
}

export function validateStory(story: StoryDefinition): string[] {
  const errors: string[] = [];
  const eventIds = new Set<string>();
  const forceIds = new Set(Object.keys(story.initial.forces));
  const npcIds = new Set(Object.keys(story.initial.npcs));

  for (const event of story.events) {
    if (eventIds.has(event.id)) errors.push("Duplicate event id: " + event.id);
    eventIds.add(event.id);
  }

  if (!eventIds.has(story.startEventId)) errors.push("Start event does not exist: " + story.startEventId);
  if (!eventIds.has(story.fallbackEndingId)) errors.push("Fallback ending does not exist: " + story.fallbackEndingId);
  if (story.randomChance < 0 || story.randomChance > 1) errors.push("randomChance must be between 0 and 1");

  for (const rule of story.pressureRules) {
    if (!Object.prototype.hasOwnProperty.call(story.initial.pressures, rule.name)) {
      errors.push("Unknown pressure accumulator: " + rule.name);
    }
    if (!Number.isFinite(rule.threshold) || rule.threshold <= 0) {
      errors.push("Pressure threshold must be > 0: " + rule.name);
    }
    const target = story.events.find((event) => event.id === rule.eventId);
    if (!target) errors.push("Pressure event does not exist: " + rule.eventId);
    else if (target.kind !== "delayed") errors.push("Pressure event must be delayed: " + rule.eventId);
  }

  for (const event of story.events) {
    if (event.kind === "ending") {
      if (event.choices && event.choices.length > 0) errors.push("Ending must not have choices: " + event.id);
      continue;
    }
    if (!event.choices || event.choices.length === 0) {
      errors.push("Non-ending event must have choices: " + event.id);
      continue;
    }

    for (const choice of event.choices) {
      if (!choice.resolve.length) {
        errors.push("Choice has no resolution rules: " + event.id + "/" + choice.id);
        continue;
      }
      const lastRule = choice.resolve[choice.resolve.length - 1];
      if (lastRule?.when) errors.push("Last resolution rule must be an unconditional fallback: " + event.id + "/" + choice.id);
      for (const rule of choice.resolve) {
        for (const effect of rule.effects) {
          errors.push(...validateEffect(effect, eventIds, forceIds, npcIds).map((message) => event.id + "/" + choice.id + ": " + message));
        }
      }
    }
  }

  const fallback = story.events.find((event) => event.id === story.fallbackEndingId);
  if (fallback?.kind !== "ending") errors.push("Fallback event must be an ending");
  return errors;
}

export function assertValidStory(story: StoryDefinition): void {
  const errors = validateStory(story);
  if (errors.length) throw new Error("Invalid story definition:\n- " + errors.join("\n- "));
}
