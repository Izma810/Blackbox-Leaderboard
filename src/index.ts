// The front door: turns HTTP requests into calls on the Game object and results back into JSON.
// It holds no game data itself; all rules live in game.ts.
import { Game } from "./game";
import type { Env, Result } from "./types";

type Body = Record<string, unknown>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function respond<T>(result: Result<T>): Response {
  if (result.ok) return json(result.data);
  return json({ error: result.error }, result.status);
}

// A broken or missing body is treated as empty, so the Game gives a friendly error instead.
async function readBody(request: Request): Promise<Body> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Body) : {};
  } catch {
    return {};
  }
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
}

// Hashing both sides first makes them equal length, so the comparison takes the same time
// whether the guess is close or not.
async function isAdmin(request: Request, env: Env): Promise<boolean> {
  const given = request.headers.get("x-admin-key") ?? "";
  const expected = env.ADMIN_KEY ?? "";
  if (given === "" || expected === "") return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

async function route(request: Request, env: Env, path: string): Promise<Response> {
  const game = env.GAME.get(env.GAME.idFromName(env.GAME_NAME || "game-1"));
  const method = request.method;

  // ----- Player routes -----
  if (method === "POST" && path === "/api/login") {
    const body = await readBody(request);
    return respond(await game.login(String(body.code ?? "")));
  }
  if (method === "GET" && path === "/api/state") {
    return respond(await game.state(bearerToken(request)));
  }
  if (method === "POST" && path === "/api/features") {
    const body = await readBody(request);
    return respond(await game.postFeature(bearerToken(request), String(body.formula ?? "")));
  }
  if (method === "POST" && path === "/api/votes") {
    const body = await readBody(request);
    return respond(await game.vote(bearerToken(request), Number(body.featureId), String(body.direction ?? "")));
  }
  const history = /^\/api\/features\/(\d+)\/history$/.exec(path);
  if (method === "GET" && history) {
    return respond(await game.priceHistory(Number(history[1])));
  }

  // ----- Admin routes -----
  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) return json({ error: "Wrong admin key." }, 401);

    if (method === "GET" && path === "/api/admin/settings") return respond(await game.adminSettings());
    if (method === "POST" && path === "/api/admin/settings") {
      return respond(await game.updateSettings(await readBody(request)));
    }
    if (method === "GET" && path === "/api/admin/players") return respond(await game.listPlayers());
    if (method === "POST" && path === "/api/admin/players") {
      const body = await readBody(request);
      const names = Array.isArray(body.names) ? body.names.map((n) => String(n)) : [];
      return respond(await game.addPlayers(names));
    }
    if (method === "GET" && path === "/api/admin/features") return respond(await game.adminFeatures());
    if (method === "POST" && path === "/api/admin/judge") {
      const body = await readBody(request);
      // Only the literal true counts, so "false" or 1 can't accidentally pay out.
      const correct = body.correct === true;
      return respond(await game.judge(Number(body.featureId), correct, Number(body.payoutY)));
    }
    if (method === "GET" && path === "/api/admin/audit") return respond(await game.audit());
    if (method === "GET" && path === "/api/admin/export") return respond(await game.exportAll());
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    // Real files in public/ are served before this code runs; anything else outside /api/ is missing.
    if (!path.startsWith("/api/")) return new Response("Not found", { status: 404 });
    try {
      return await route(request, env, path);
    } catch (err) {
      console.error("Unexpected error in front door:", err);
      return json({ error: "The server couldn't handle that request. Try again." }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

export { Game };
