import path from "node:path";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";

import type {
  DetectInput,
  DetectResult
} from "../../../domain/src/index.js";
import { evaluateDetectionRules } from "../../../detection-engine/src/index.js";
import { openClawAdapterMetadata, openClawDetectionRules } from "./definitions.js";
import { resolveOpenClawInput } from "./resolve.js";
import { readJsonFile, resolveOpenClawStateProbe } from "./state.js";

const exec = promisify(execCallback);

interface OpenClawPackageJson {
  name?: string;
  version?: string;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

async function getOpenclawGlobalPath(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("which openclaw");
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function getOpenclawGlobalVersion(): Promise<string | undefined> {
  try {
    const { stdout } = await exec("openclaw --version");
    const match = stdout.match(/OpenClaw\s+([0-9]+\.[0-9]+\.[0-9]+)/i);
    if (match && match[1]) {
      return match[1];
    }
  } catch {
    return undefined;
  }
}

async function resolveDetectedVersion(sourcePath: string) {
  const packageJson = await readJsonFile<{ name?: string; version?: string; dependencies?: Record<string, string> }>(path.join(sourcePath, "package.json"));
  if (packageJson?.name === "openclaw" && packageJson.version) {
    return packageJson.version;
  }

  if (packageJson?.dependencies?.["openclaw"]) {
    return packageJson.dependencies["openclaw"].replace(/^[^\d]/, "");
  }

  const nmPackageJson = await readJsonFile<{ version?: string }>(path.join(sourcePath, "node_modules", "openclaw", "package.json"));
  if (nmPackageJson?.version) {
    return nmPackageJson.version;
  }

  const buildInfo = await readJsonFile<{ version?: string }>(path.join(sourcePath, "build-info.json"));
  return buildInfo?.version;
}

export async function detectOpenClaw(input: DetectInput): Promise<DetectResult> {
  const { result } = await evaluateDetectionRules(input, openClawAdapterMetadata, openClawDetectionRules);
  
  let detectedVersion = await getOpenclawGlobalVersion();
  if (!detectedVersion) {
    detectedVersion = await resolveDetectedVersion(input.sourcePath);
  }

  const resolvedInput = await resolveOpenClawInput(input.sourcePath);

  if (!detectedVersion && resolvedInput.lastTouchedVersion) {
    detectedVersion = resolvedInput.lastTouchedVersion;
  }

  const frameworkPath = await getOpenclawGlobalPath();

  const inputEvidence =
    resolvedInput.inputKind === "unknown"
      ? []
      : [
          {
            kind: "directory" as const,
            path: resolvedInput.detectedRootKind === "workspace"
              ? resolvedInput.workspaceDirs[0]
              : resolvedInput.detectedRootKind === "state"
                ? resolvedInput.stateDir
                : resolvedInput.codeFolder,
            message:
              resolvedInput.inputKind === "nested"
                ? `Nested path resolved to OpenClaw ${resolvedInput.detectedRootKind} root`
                : `Input path resolved as an OpenClaw ${resolvedInput.inputKind} root`,
            weight:
              resolvedInput.inputKind === "nested"
                ? 0.88
                : 0.92
          }
        ];

  if (result.confidence < 0.58 && inputEvidence.length === 0) {
    return {
      ...result,
      detectedVersion
    };
  }

  const stateProbe = resolvedInput.stateDir
    ? {
        stateDir: resolvedInput.stateDir,
        configPath: resolvedInput.configPath,
        configFound: Boolean(resolvedInput.configPath),
        customConfig: resolvedInput.customConfig,
        agentCount: resolvedInput.agentIds.length || undefined,
        defaultImplicitAgent: resolvedInput.analysis?.defaultImplicitAgent,
        warnings: resolvedInput.warnings,
        evidence: [] as DetectResult["evidence"]
      }
    : await resolveOpenClawStateProbe();

  const warnings = unique([...result.warnings, ...stateProbe.warnings, ...resolvedInput.warnings]);
  const evidence = [...result.evidence, ...stateProbe.evidence, ...inputEvidence];
  const confidence = Math.min(
    1,
    Number(evidence.reduce((total, item) => total + item.weight, 0).toFixed(2))
  );

  return {
    ...result,
    matched: confidence >= openClawAdapterMetadata.detectionThreshold,
    confidence,
    evidence,
    warnings,
    detectedVersion,
    details: {
      inputKind: resolvedInput.inputKind,
      detectedRootKind: resolvedInput.detectedRootKind,
      codeFolder: resolvedInput.codeFolder,
      codeFolderVersion: resolvedInput.codeFolder ? await resolveDetectedVersion(resolvedInput.codeFolder) : undefined,
      stateDir: resolvedInput.stateDir ?? stateProbe.stateDir,
      configPath: resolvedInput.configPath ?? stateProbe.configPath,
      configFound: Boolean(resolvedInput.configPath ?? stateProbe.configPath),
      customConfig: resolvedInput.customConfig ?? stateProbe.customConfig,
      agentCount: resolvedInput.agentIds.length || stateProbe.agentCount,
      agentIds: resolvedInput.agentIds.length ? resolvedInput.agentIds : (stateProbe.agentCount === 1 ? ["main"] : undefined),
      defaultImplicitAgent: resolvedInput.analysis?.defaultImplicitAgent ?? stateProbe.defaultImplicitAgent,
      workspaceDirs: resolvedInput.workspaceDirs,
      frameworkPath
    }
  };
}
