import type { Game } from "./game";

// Everything the Worker gets from wrangler.jsonc and secrets.
export interface Env {
  GAME: DurableObjectNamespace<Game>;
  GAME_NAME: string;
  ADMIN_KEY: string;
}

// Game methods never throw to the caller; they return one of these instead.
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };
