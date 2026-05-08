/**
 * Libra Backend API
 * 病棟ベッドサイド向けコミュニケーション補助アプリのバックエンド
 *
 * Hono on Cloudflare Workers
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("*", async (c, next) => {
  const originsStr = c.env.CORS_ORIGINS || "http://localhost:5173";
  const origins = originsStr.split(",").map((o: string) => o.trim());

  const corsMiddleware = cors({
    origin: origins,
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  return corsMiddleware(c, next);
});

app.get("/", (c) => {
  return c.json({
    service: "Libra API",
    version: "0.1.0",
    status: "running",
  });
});

app.get("/health", (c) => {
  return c.json({ status: "healthy" });
});

app.get("/api/presets", (c) => {
  return c.json({
    urgent: ["来てください", "苦しいです", "痛いです", "水がほしいです", "体の向きを変えたいです", "はい", "いいえ"],
    slow: {
      pain: ["頭", "胸", "お腹", "背中", "足", "少し", "かなり", "とても"],
      discomfort: ["暑い", "寒い", "眠れない", "痰", "トイレ", "向きを変えたい"],
      mood: ["不安", "さみしい", "落ち着かない", "大丈夫", "疲れた", "ありがとう"],
    },
    voiceModes: ["off", "tone", "short", "full"],
  });
});

app.post("/api/log", async (c) => {
  try {
    const body = await c.req.json();
    const message = typeof body.message === "string" ? body.message.slice(0, 1000) : "";
    const page = typeof body.page === "string" ? body.page.slice(0, 100) : "";
    const userAgent = typeof body.user_agent === "string" ? body.user_agent.slice(0, 500) : "";
    console.log(`Frontend Event: ${message} | Page: ${page} | UA: ${userAgent}`);
    return c.json({ status: "logged" });
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }
});

export default app;
