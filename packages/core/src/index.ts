import type { AgentAdapter, DetectInput, DetectionEngineResult } from "../../domain/src/index.js";
import {
  findIgnoredDirectories,
  selectDetectionResult
} from "../../detection-engine/src/index.js";

export async function detectAgent(
  input: DetectInput,
  adapters: AgentAdapter[]
): Promise<DetectionEngineResult> {
  const candidateResults = await Promise.all(adapters.map((adapter) => adapter.detect(input)));
  const ignoredDirectories = await findIgnoredDirectories(input.sourcePath);
  return selectDetectionResult(candidateResults, ignoredDirectories);
}
