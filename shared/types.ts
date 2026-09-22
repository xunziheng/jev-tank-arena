export type Point = { x: number; y: number };
export type Weapon = "normal" | "machine" | "laser" | "mine";
export type Mode = "jev" | "practice" | "direct";
export type Plan = {
  id: string;
  label: string;
  description: string;
  target: Point;
  path: Point[];
  fire: boolean;
  aim: number;
  risk: number;
  pickupId?: number;
  attack?: "direct" | "bank" | "auto" | "mine";
  followsEnemy?: boolean;
  hitIn?: number | null;
};
export type Candidate = {
  id: string;
  description: string;
  distance: number;
  risk: number;
  fire: boolean;
  kind?: string;
};
export type DecisionRequest = {
  role: "tank" | "director" | "controls";
  round: number;
  revision: number;
  state: Record<string, unknown>;
  candidates: Candidate[];
};
export type DecisionResponse = {
  choice: string;
  confidence: number;
  probabilities?: Record<string, number>;
  latencyMs: number;
  model: string;
  source: "jev";
  round: number;
  revision: number;
  usage: { input_tokens: number; output_tokens: number };
};
export const WEAPONS: Record<
  Weapon,
  { name: string; icon: string; color: string }
> = {
  normal: { name: "Ricochet Cannon", icon: "◎", color: "#d8dfda" },
  machine: { name: "Machine Gun", icon: "≋", color: "#eebd68" },
  laser: { name: "Laser Cannon", icon: "ϟ", color: "#b9a5ff" },
  mine: { name: "Mines", icon: "✳", color: "#ff8c78" },
};
