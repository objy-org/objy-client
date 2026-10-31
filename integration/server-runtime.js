import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
export const serverRoot = resolve(process.env.OBJY_SERVER_ROOT || resolve(projectRoot, "../spread-db"));
const serverModule = (path) => pathToFileURL(resolve(serverRoot, path)).href;

export const { startServer } = await import(serverModule("src/server.js"));
export const { createFileService } = await import(serverModule("src/files.js"));
export const { clientPath } = await import(serverModule("src/interfaces/client.js"));
export const { sign } = createRequire(import.meta.url)(resolve(serverRoot, "src/lib/jwt.cjs"));
