import { buildApp } from "./app.js";
import { db } from "./db.js";

const app = buildApp();

async function shutdown() {
  try {
    await app.close();
    await db.end();
  } catch {
    app.log.error("Falha ao encerrar a aplicação");
    process.exitCode = 1;
  }
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function start() {
  try {
    await app.listen({
      port: 3000,
      host: "127.0.0.1",
    });
  } catch (error) {
    app.log.error(error);
    await db.end();
    process.exitCode = 1;
  }
}

start();