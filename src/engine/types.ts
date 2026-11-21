export type EventKind = "main" | "random" | "delayed" | "ending";
export type Trend = "rising" | "stable" | "falling";
export type Scalar = string | number | boolean | null;

export type Condition =
  | { path: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "contains"; value: unknown }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

export type NpcMetric = "trust" | "debt" | "rivalry" | "reliability";

export type Effect =
  | { type: "force.delta"; force: string; delta: number }
  | { type: "force.phase"; force: string; phase: string }
  | { type: "skill.delta"; skill: string; delta: number }
  | { type: "standing.set"; key: string; value: Scalar }
  | { type: "npc.delta"; npcId: string; metric: NpcMetric; delta: number }
  | { type: "flag.set"; name: string; value: Scalar }
  | { type: "pressure.delta"; name: string; delta: number }
  | { type: "trajectory.add"; tag: string }
  | { type: "disposition.delta"; trait: string; delta: number }
  | { type: "schedule"; eventId: string; afterTurns: number; reason: string };

export interface ForceState {
  value: number;
  trend: Trend;
  phase?: string;
}

export interface NpcState {
  trust: number;
  debt: number;
  rivalry: number;
  reliability: number;
}

export interface StoryEvent {
  id: string;
  kind: EventKind;
  chapter: number;
  order?: number;
  priority?: number;
  title: string;
  scene: string;
  when?: Condition;
  weight?: number;
  choices?: ChoiceDefinition[];
  reflection?: string;
  key?: boolean;
}

export interface ChoiceDefinition {
  id: string;
  text: string;
  requires?: Condition;
  resolve: ResolutionRule[];
}

export interface ResolutionRule {
  id: string;
  when?: Condition;
  outcome: string;
  narrative: string;
  effects: Effect[];
}

export interface StoryDefinition {
  id: string;
  version: string;
  title: string;
  chapterTitle: string;
  startEventId: string;
  fallbackEndingId: string;
  randomPerMainEvent: boolean;
  randomChance: number;
  initial: {
    player: {
      identity: string;
      standing: Record<string, Scalar>;
      skills: Record<string, number>;
      disposition: Record<string, number>;
    };
    forces: Record<string, ForceState>;
    npcs: Record<string, NpcState>;
    flags: Record<string, Scalar>;
    pressures: Record<string, number>;
    time: { chapter: number; month: number };
  };
  events: StoryEvent[];
}

export interface PendingConsequence {
  eventId: string;
  dueAtTurn: number;
  scheduledFrom: string;
  reason: string;
}

export interface ChoiceRecord {
  turn: number;
  eventId: string;
  eventTitle: string;
  choiceId: string;
  choiceText: string;
  ruleId: string;
  outcome: string;
  narrative: string;
}

export interface LastResult {
  eventTitle: string;
  choiceText: string;
  narrative: string;
  outcome: string;
}

export interface GameState {
  saveVersion: 1;
  storyId: string;
  storyVersion: string;
  seed: string;
  rngState: number;
  turn: number;
  time: { chapter: number; month: number };
  player: {
    identity: string;
    standing: Record<string, Scalar>;
    skills: Record<string, number>;
    disposition: Record<string, number>;
  };
  forces: Record<string, ForceState>;
  npcs: Record<string, NpcState>;
  flags: Record<string, Scalar>;
  pressures: Record<string, number>;
  trajectory: string[];
  pending: PendingConsequence[];
  completedEvents: string[];
  history: ChoiceRecord[];
  currentEventId: string | null;
  offerRandom: boolean;
  ended: boolean;
  lastResult: LastResult | null;
}
