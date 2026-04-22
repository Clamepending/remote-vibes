export const BUILDING_MANIFEST_VERSION = 1;

export function normalizeBuildingId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeOnboarding(onboarding) {
  if (!onboarding || typeof onboarding !== "object" || Array.isArray(onboarding)) {
    return null;
  }

  return {
    ...onboarding,
    steps: Array.isArray(onboarding.steps) ? onboarding.steps.filter(Boolean) : [],
    variables: Array.isArray(onboarding.variables) ? onboarding.variables.filter(Boolean) : [],
  };
}

function normalizeInstallContract(install) {
  if (!install || typeof install !== "object" || Array.isArray(install)) {
    return {};
  }

  return {
    ...install,
    enabledSetting: String(install.enabledSetting || "").trim(),
    system: Boolean(install.system),
    storedFallback: install.storedFallback === undefined ? true : Boolean(install.storedFallback),
  };
}

function normalizeVisualContract(visual) {
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) {
    return { shape: "plugin" };
  }

  return {
    ...visual,
    shape: normalizeBuildingId(visual.shape || "plugin") || "plugin",
    specialTownPlace: Boolean(visual.specialTownPlace),
  };
}

function normalizeUiContract(ui) {
  if (!ui || typeof ui !== "object" || Array.isArray(ui)) {
    return { mode: "panel", entryView: "", workspaceView: "" };
  }

  const requestedMode = normalizeBuildingId(ui.mode || "panel");
  const mode = ["panel", "wide", "workspace"].includes(requestedMode) ? requestedMode : "panel";

  return {
    ...ui,
    entryView: String(ui.entryView || "").trim(),
    mode,
    workspaceView: normalizeBuildingId(ui.workspaceView || ""),
  };
}

export function defineBuilding(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new TypeError("Building manifest must be an object.");
  }

  const id = normalizeBuildingId(manifest.id || manifest.name);
  if (!id) {
    throw new TypeError("Building manifest requires an id or name.");
  }

  const name = String(manifest.name || id).trim();
  const building = {
    manifestVersion: BUILDING_MANIFEST_VERSION,
    ...manifest,
    id,
    name,
    category: String(manifest.category || "Building").trim() || "Building",
    description: String(manifest.description || "").trim(),
    install: normalizeInstallContract(manifest.install),
    onboarding: normalizeOnboarding(manifest.onboarding),
    source: String(manifest.source || "custom").trim() || "custom",
    status: String(manifest.status || "available").trim() || "available",
    ui: normalizeUiContract(manifest.ui),
    visual: normalizeVisualContract(manifest.visual),
  };

  return Object.freeze(building);
}

export function createBuildingRegistry(initialBuildings = []) {
  const buildings = new Map();

  function register(manifest) {
    const building = defineBuilding(manifest);
    buildings.set(building.id, building);
    return building;
  }

  for (const manifest of initialBuildings) {
    register(manifest);
  }

  return {
    get(id) {
      return buildings.get(normalizeBuildingId(id)) || null;
    },
    ids() {
      return [...buildings.keys()];
    },
    list() {
      return [...buildings.values()];
    },
    register,
    specialTownIds() {
      return new Set(
        [...buildings.values()]
          .filter((building) => building.visual?.specialTownPlace)
          .map((building) => building.id),
      );
    },
  };
}
