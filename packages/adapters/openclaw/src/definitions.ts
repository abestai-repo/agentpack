import type { AdapterMetadata, DetectionRule } from "../../../domain/src/index.js";

export const openClawAdapterMetadata: AdapterMetadata = {
  id: "openclaw",
  displayName: "OpenClaw",
  framework: "openclaw",
  adapterVersion: "0.1.0",
  supportedSourceVersions: ["1.x"],
  supportedTargetVersions: ["1.x"],
  detectionThreshold: 0.85,
  capabilities: ["detect", "inspect", "extract", "restore", "compatibility-report"]
};

export const openClawDetectionRules: DetectionRule[] = [
  {
    kind: "file_contains",
    path: "package.json",
    pattern: "\"name\": \"openclaw\"",
    weight: 0.58,
    message: "package.json declares the OpenClaw package name"
  },
  {
    kind: "file_contains",
    path: "package.json",
    pattern: "\"version\":",
    weight: 0.12,
    message: "package.json declares an OpenClaw package version"
  },
  {
    kind: "file_contains",
    path: "package.json",
    pattern: "\"openclaw\": \"openclaw.mjs\"",
    weight: 0.08,
    message: "package.json exposes the OpenClaw CLI entrypoint"
  },
  {
    kind: "file_exists",
    path: "openclaw.mjs",
    weight: 0.15,
    message: "OpenClaw CLI bootstrap file present"
  },
  {
    kind: "file_exists",
    path: "src/version.ts",
    weight: 0.15,
    message: "OpenClaw version source file present"
  },
  {
    kind: "file_exists",
    path: "src/config/paths.ts",
    weight: 0.15,
    message: "OpenClaw config path module present"
  },
  {
    kind: "file_contains",
    path: "README.md",
    pattern: "OpenClaw",
    weight: 0.04,
    message: "README references OpenClaw"
  },
  {
    kind: "file_exists",
    path: "AGENTS.md",
    weight: 0.03,
    message: "AGENTS.md exists at the repo root"
  },
  {
    kind: "file_exists",
    path: "src/cli/program/register.setup.ts",
    weight: 0.03,
    message: "OpenClaw setup registration file present"
  },
  {
    kind: "file_exists",
    path: "src/commands/setup.ts",
    weight: 0.03,
    message: "OpenClaw setup command file present"
  }
];
