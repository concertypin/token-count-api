/**
 * @fileoverview
 * Node.js entry point (Heroku deployment).
 * Runs the Hono app via @hono/node-server.
 * Port comes from $PORT (Heroku sets it) or defaults to 8080.
 */

import { serve } from "@hono/node-server";
import app from "@/index";

const port = Number(process.env.PORT ?? 8080);

serve({ fetch: app.fetch, port }, (info) => {
    console.log(`token-count-api listening on :${info.port}`);
});
