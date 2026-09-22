import "dotenv/config";
import { buildApp } from "./app";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve, extname } from "node:path";
const app = buildApp({
  apiKey: process.env.TYPESAFE_API_KEY,
  model: process.env.TYPESAFE_MODEL,
});
// Register exact build asset paths only; no user-controlled filesystem lookup.
if (existsSync(resolve("dist"))) {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  for (const file of readdirSync(resolve("dist"), {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!file.isFile()) continue;
    const absolute = resolve(file.parentPath, file.name);
    const route = "/" + absolute.slice(resolve("dist").length + 1);
    const content = readFileSync(absolute);
    const handler = async (_: unknown, reply: any) =>
      reply
        .type(types[extname(absolute)] || "application/octet-stream")
        .send(content);
    app.get(route, handler);
    if (route === "/index.html") app.get("/", handler);
  }
}
await app.listen({ host: "127.0.0.1", port: Number(process.env.PORT || 3001) });
console.log(
  `Arena server: http://127.0.0.1:${process.env.PORT || 3001} · Jev ${process.env.TYPESAFE_API_KEY ? "configured" : "not configured"}`,
);
