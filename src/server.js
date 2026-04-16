import { createRemoteVibesApp } from "./create-app.js";
import { buildStartupOutput } from "./startup-output.js";

const configuredHost = process.env.REMOTE_VIBES_HOST || "0.0.0.0";
const configuredPort = Number(process.env.REMOTE_VIBES_PORT || 4123);

let remoteVibes;

try {
  remoteVibes = await createRemoteVibesApp({
    host: configuredHost,
    port: configuredPort,
    onTerminate: async () => {
      process.exit(0);
    },
  });
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    console.error(
      `Remote Vibes could not bind ${configuredHost}:${configuredPort}. Stop the other server or relaunch with REMOTE_VIBES_PORT=<free-port>.`,
    );
    process.exit(1);
  }

  throw error;
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await remoteVibes.terminate();
  });
}

process.on("SIGHUP", () => {
  console.log("[remote-vibes] Ignoring SIGHUP; use terminate, SIGINT, or SIGTERM to stop.");
});

console.log(buildStartupOutput(remoteVibes.config));
