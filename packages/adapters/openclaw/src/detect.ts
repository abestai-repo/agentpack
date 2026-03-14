import path from "node:path";

import type {
  DetectInput,
  DetectResult
} from "../../../domain/src/index.js";
import { evaluateDetectionRules } from "../../../detection-engine/src/index.js";
import { openClawAdapterMetadata, openClawDetectionRules } from "./definitions.js";
import { readJsonFile, resolveOpenClawStateProbe } from "./state.js";

interface OpenClawPackageJson {
  name?: string;
  version?: string;
}

async function resolveDetectedVersion(sourcePath: string) {
  const packageJson = await readJsonFile<OpenClawPackageJson>(path.join(sourcePath, "package.json"));
  if (packageJson?.name === "openclaw" && packageJson.version) {
    return packageJson.version;
  }

  const buildInfo = await readJsonFile<{ version?: string }>(path.join(sourcePath, "build-info.json"));
  return buildInfo?.version;
}

export async function detectOpenClaw(input: DetectInput): Promise<DetectResult> {
  const { result } = await evaluateDetectionRules(input, openClawAdapterMetadata, openClawDetectionRules);
  const detectedVersion = await resolveDetectedVersion(input.sourcePath);

  if (result.confidence < 0.58) {
    return {
      ...result,
      detectedVersion
    };
  }

  const stateProbe = await resolveOpenClawStateProbe();

  const warnings = [...result.warnings, ...stateProbe.warnings];
  const evidence = [...result.evidence, ...stateProbe.evidence];
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
      stateDir: stateProbe.stateDir,
      configPath: stateProbe.configPath,
      configFound: stateProbe.configFound,
      customConfig: stateProbe.customConfig,
      agentCount: stateProbe.agentCount,
      defaultImplicitAgent: stateProbe.defaultImplicitAgent
    }
  };
}
