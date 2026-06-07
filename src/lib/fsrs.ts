// src/lib/fsrs.ts

import { Library } from "lucide-react";
import {
  Card as FsrsCard,
  Rating,
  State,
  createEmptyCard,
  fsrs,
} from "ts-fsrs";

export type FsrsStateJson = {
  due: string;
  reps: number;
  state: State;
  lapses: number;
  stability: number;
  difficulty: number;
  last_review?: string;
  elapsed_days?: number;
  learning_steps?: number;
  scheduled_days?: number;
};

export type CardProgressRow = {
  id: number;
  card_id: number;
  user_id: string;
  due_date: string | null;
  last_reviewed: string | null;
  fsrs_state: FsrsStateJson | null;
  ease_factor?: number;
  interval?: number;
  repetitions?: number;
  created_at?: string | null;
  updated_at?: string | null;
  fsrs_params?: unknown | null;
};

const scheduler = fsrs();

export function getScheduler() {
  return scheduler;
}

export function progressToFsrsCard(
  progress: CardProgressRow | null | undefined,
  now = new Date(),
): FsrsCard {
  const state = progress?.fsrs_state;
  if (!state) {
    return createEmptyCard(now);
  }

  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsed_days: state.elapsed_days ?? 0,
    scheduled_days: state.scheduled_days ?? 0,
    learning_steps: state.learning_steps ?? 0,
    reps: state.reps ?? 0,
    lapses: state.lapses ?? 0,
    state: state.state,
    last_review: state.last_review ? new Date(state.last_review) : undefined,
  };
}

export function fsrsCardToState(card: FsrsCard): FsrsStateJson {
  return {
    due: card.due.toISOString(),
    reps: card.reps,
    state: card.state,
    lapses: card.lapses,
    stability: card.stability,
    difficulty: card.difficulty,
    last_review: card.last_review?.toISOString(),
    elapsed_days: card.elapsed_days,
    learning_steps: card.learning_steps,
    scheduled_days: card.scheduled_days,
  };
}

export function previewIntervals(card: FsrsCard, now = new Date()) {
  const preview = scheduler.repeat(card, now);
  return {
    again: formatIntervalUntil(preview[Rating.Again].card.due, now),
    good: formatIntervalUntil(preview[Rating.Good].card.due, now),
  };
}

export function reviewCard(
  card: FsrsCard,
  rating: Rating.Again | Rating.Good,
  now = new Date(),
) {
  return scheduler.next(card, now, rating);
}

export function formatIntervalUntil(due: Date, now: Date): string {
  const ms = Math.max(0, due.getTime() - now.getTime());
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.max(1, Math.round(minutes / (60 * 24)));
  return `${days}d`;
}

export function isCardDue(
  progress: CardProgressRow | null | undefined,
  now = new Date(),
): boolean {
  // If no progress record exists, card is not yet due (it's new)
  if (!progress) return false;
  // Check FSRS-based due date first (primary scheduling system)
  if (progress.fsrs_state?.due) {
    return new Date(progress.fsrs_state.due) <= now;
  }
  // Fall back to legacy due_date if no FSRS state
  if (progress.due_date) {
    return new Date(progress.due_date) <= now;
  }
  // If progress exists but neither due system is set, not due
  return false;
}

export { Rating, State };
