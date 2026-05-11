// Mirrors SWARMLAB_X <-> VIBE_RESEARCH_X env vars so the codebase can keep
// reading process.env.VIBE_RESEARCH_X while users (or new scripts) set the
// Swarmlab-prefixed name. Runs once at startup; import this at the very top
// of any entry point (src/server.js, scripts that read env at import time,
// etc.) before any other module that reads these env vars.
//
// Background: the project was renamed from "Vibe Research" to "Swarmlab" as
// a project within the Vibe Research lab. Existing users have VIBE_RESEARCH_*
// in their shell rc; new users get docs that say SWARMLAB_*. This shim makes
// both work without touching every read site.

const ALIAS_PAIRS = [
  ["SWARMLAB_", "VIBE_RESEARCH_"],
  ["VIBE_RESEARCH_", "SWARMLAB_"],
];

function mirrorEnvAliases() {
  for (const [sourcePrefix, targetPrefix] of ALIAS_PAIRS) {
    for (const envVarName of Object.keys(process.env)) {
      if (!envVarName.startsWith(sourcePrefix)) continue;
      const aliasName = targetPrefix + envVarName.slice(sourcePrefix.length);
      if (process.env[aliasName] === undefined && process.env[envVarName] !== undefined) {
        process.env[aliasName] = process.env[envVarName];
      }
    }
  }
}

mirrorEnvAliases();

export { mirrorEnvAliases };
