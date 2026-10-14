/**
 * Chat-style onboarding — same API and answer formats as the website (`E:\aylo\orza\src\lib\onboarding.ts`,
 * `src/components/auth/onboarding/*`): GET /api/onboarding, POST /api/onboarding/step, POST /api/onboarding/restart.
 */
import { api } from './api';
import { deviceTimeZone } from './device';
import type { PublicUser, Targets } from './types';

export type InputKind = 'text' | 'number' | 'choice' | 'multi' | 'none';
/** goal · sex · age · height · weight · target_weight · activity · diet · allergies · region · language · household · lifestyle · summary · complete */
export type StepId = string;

export interface StepOption {
  value: string;
  label: string;
  hint?: string;
}

export interface PlanSummary {
  targets: Pick<Targets, 'calories' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'water_glasses' | 'steps'>;
  bmr: number | null;
  tdee: number | null;
  goal: string;
  goal_line: string;
  facts: { label: string; value: string }[];
}

export interface StepPrompt {
  step: StepId;
  /** ÖRZA's message (ack + question); paragraphs split by blank lines. */
  message: string;
  ack?: string;
  input: InputKind;
  options?: StepOption[];
  /** Long lists (region): values shown before searching. */
  featured?: string[];
  placeholder?: string;
  /** Number steps: unit choices, first = default. */
  units?: string[];
  unit_hint?: string;
  min?: number;
  max?: number;
  optional?: boolean;
  /** Multi: values that clear every other selection ("none"). */
  exclusive?: string[];
  allow_custom?: boolean;
  summary?: PlanSummary;
}

export interface ChatLine {
  role: 'assistant' | 'user';
  content: string;
}

export interface OnboardingProgress {
  index: number;
  total: number;
  value: number;
}

export interface OnboardingStatePayload {
  step: StepId;
  answers: Record<string, unknown>;
  done: boolean;
  prompt: StepPrompt | null;
  history: ChatLine[];
  progress: OnboardingProgress;
}

export interface OnboardingStepResult {
  reply: string;
  step: StepId;
  input: InputKind;
  options?: StepOption[];
  done: boolean;
  prompt?: StepPrompt;
  progress?: OnboardingProgress;
  answers?: Record<string, unknown>;
  valid?: boolean;
  error?: string;
  history?: ChatLine[];
  resync?: boolean;
  restarted?: boolean;
  user?: PublicUser;
}

export type Answer = string | number | string[];

export const onboardingApi = {
  state: () => api.get<OnboardingStatePayload>('/onboarding'),
  answer: (step: StepId, answer: Answer) =>
    api.post<OnboardingStepResult>('/onboarding/step', { step, answer, timezone: deviceTimeZone() }, { timeoutMs: 25_000 }),
  restart: () => api.post<OnboardingStatePayload & { reply?: string }>('/onboarding/restart'),
};
