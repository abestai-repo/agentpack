import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { main as runCli } from "../apps/cli/src/index.js";
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

const rootDir = path.resolve(import.meta.dirname, "..", "..");

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

process.stdout.write("Phase 1 foundation checks passed.\n");
