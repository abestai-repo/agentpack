import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { main as runCli } from "../apps/cli/src/index.js";
import { registeredAdapters } from "../packages/adapters/src/index.js";
import { detectAgent } from "../packages/core/src/index.js";
import {
  createMinimalAeggManifest,
  createMinimalAeggMetadata,
  createMinimalCam,
  createMinimalCompatibilityReport
} from "../packages/domain/src/index.js";
import {
  validateAeggCompatibilityDocument,
  validateAeggManifest,
  validateAeggMetadata,
  validateCamDocument
} from "../packages/schemas/src/index.js";

const rootDir = process.cwd();

async function readFixture(name: string) {
  const filePath = path.join(rootDir, "packages", "test-fixtures", "fixtures", name);
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function runCase(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    process.stdout.write(`ok - ${name}\n`);
  } catch (error) {
    process.stderr.write(`not ok - ${name}\n`);
    throw error;
  }
}

await runCase("domain factories create valid Phase 1 documents", () => {
  assert.equal(validateCamDocument(createMinimalCam()).valid, true);
  assert.equal(validateAeggManifest(createMinimalAeggManifest()).valid, true);
  assert.equal(validateAeggMetadata(createMinimalAeggMetadata()).valid, true);
  assert.equal(validateAeggCompatibilityDocument(createMinimalCompatibilityReport()).valid, true);
});

await runCase("fixtures validate successfully", async () => {
  assert.equal(validateCamDocument(await readFixture("minimal-cam.json")).valid, true);
  assert.equal(validateAeggManifest(await readFixture("minimal-manifest.json")).valid, true);
  assert.equal(validateAeggMetadata(await readFixture("minimal-metadata.json")).valid, true);
  assert.equal(
    validateAeggCompatibilityDocument(await readFixture("minimal-compatibility.json")).valid,
    true
  );
});

await runCase("CAM validation rejects embedded secret values", () => {
  const cam = createMinimalCam({
    environment: {
      variables: [
        {
          name: "OPENAI_API_KEY",
          required: true,
          secret: true,
          value: "sk-live-not-allowed"
        }
      ],
      platform: {
        os: [],
        arch: []
      }
    }
  });

  const result = validateCamDocument(cam);
  assert.equal(result.valid, false);
  assert.match(result.errors[0]?.message ?? "", /must not embed raw values/i);
});

await runCase("CLI schemas command reports schema versions", async () => {
  assert.equal(await runCli(["node", "agentpack", "schemas", "--json"]), 0);
});

await runCase("CLI validate command succeeds for a valid CAM fixture", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "minimal-cam.json");
  assert.equal(
    await runCli(["node", "agentpack", "validate", target, "--kind", "cam", "--json"]),
    0
  );
});

await runCase("detection engine identifies the repo-shaped OpenClaw fixture", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-repo");
  const result = await detectAgent({ sourcePath: target, mode: "fast" }, registeredAdapters);
  assert.equal(result.selected.framework, "openclaw");
  assert.equal(result.selected.matched, true);
  assert.ok(result.selected.confidence >= 0.85);
  assert.equal(result.selected.matchCategory, "strong");
  assert.equal(result.selected.detectedVersion, "2026.3.13");
});

await runCase("detection engine returns unknown for unsupported fixture", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "unknown-project");
  const result = await detectAgent({ sourcePath: target, mode: "fast" }, registeredAdapters);
  assert.equal(result.selected.framework, "unknown");
  assert.equal(result.selected.matched, false);
});

await runCase("OpenClaw detection finds state config and agent count when state dir is available", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-repo");
  const stateDir = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-state");
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;

  process.env.OPENCLAW_STATE_DIR = stateDir;

  try {
    const result = await detectAgent({ sourcePath: target, mode: "deep" }, registeredAdapters);
    assert.equal(result.selected.framework, "openclaw");
    assert.equal(result.selected.details?.configFound, true);
    assert.equal(result.selected.details?.customConfig, true);
    assert.equal(result.selected.details?.agentCount, 1);
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  }
});

await runCase("CLI detect command succeeds for the repo-shaped OpenClaw fixture", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-repo");
  assert.equal(await runCli(["node", "agentpack", "detect", target, "--json"]), 0);
});

await runCase("OpenClaw inspect summarizes the repo-shaped fixture", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-repo");
  const openClawAdapter = registeredAdapters.find((adapter) => adapter.metadata.id === "openclaw");

  assert.ok(openClawAdapter?.inspect);

  const result = await openClawAdapter.inspect(target);
  assert.equal(result.framework, "openclaw");
  assert.equal(result.package.name, "openclaw");
  assert.equal(result.displayName, "OpenClaw");
  assert.equal(result.targetKind, "live-agent");
  assert.equal(result.workspace?.skillsPresent, true);
  assert.equal(result.workspace?.extensionsPresent, true);
  assert.ok(result.runtime.notableScripts.includes("build"));
  assert.ok(result.featureHints.length > 0);
});

await runCase("OpenClaw inspect resolves active state and workspace backup surfaces", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-repo");
  const fixtureStateDir = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-state");
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentpack-openclaw-inspect-"));
  const stateDir = path.join(tempRoot, ".openclaw");
  const workspaceDir = path.join(stateDir, "workspace");
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  const openClawAdapter = registeredAdapters.find((adapter) => adapter.metadata.id === "openclaw");

  assert.ok(openClawAdapter?.inspect);

  await fs.mkdir(path.join(stateDir, "agents", "main"), { recursive: true });
  await fs.mkdir(path.join(stateDir, "credentials"), { recursive: true });
  await fs.mkdir(path.join(stateDir, "skills"), { recursive: true });
  await fs.mkdir(path.join(stateDir, "extensions"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "skills"), { recursive: true });
  await fs.mkdir(path.join(workspaceDir, "canvas"), { recursive: true });
  await fs.copyFile(
    path.join(fixtureStateDir, "openclaw.json"),
    path.join(stateDir, "openclaw.json")
  );
  await fs.writeFile(path.join(workspaceDir, "AGENTS.md"), "# Main Agent\n");
  await fs.writeFile(path.join(workspaceDir, "TOOLS.md"), "# Tools\n");
  await fs.writeFile(path.join(workspaceDir, "BOOTSTRAP.md"), "# Bootstrap\n");
  await fs.writeFile(path.join(workspaceDir, "MEMORY.md"), "# Memory\n");

  process.env.OPENCLAW_STATE_DIR = stateDir;

  try {
    const result = await openClawAdapter.inspect(target);
    assert.ok(
      result.configPaths.some((entry) => entry.endsWith(".openclaw/openclaw.json")),
      "expected active state config path in inspect output"
    );
    assert.ok(
      result.memory.references.some((entry) => entry.endsWith(".openclaw/workspace/MEMORY.md")),
      "expected workspace memory path in inspect output"
    );
    assert.ok(
      result.tools.references.some((entry) => entry.endsWith(".openclaw/skills")),
      "expected managed skills path in inspect output"
    );
    assert.ok(
      result.featureHints.some((entry) => /minimal mode should exclude memory/i.test(entry))
    );
    assert.ok(
      result.featureHints.some((entry) => /full mode should reuse OpenClaw's native backup engine/i.test(entry))
    );
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

await runCase("CLI inspect command succeeds for the repo-shaped OpenClaw fixture", async () => {
  const target = path.join(rootDir, "packages", "test-fixtures", "fixtures", "openclaw-repo");
  assert.equal(await runCli(["node", "agentpack", "inspect", target, "--json"]), 0);
});

await runCase("CLI adapters list command succeeds", async () => {
  assert.equal(await runCli(["node", "agentpack", "adapters", "list", "--json"]), 0);
});

process.stdout.write("Phase 1 foundation checks passed.\n");
