import type {
  AgentAdapter,
  DetectInput,
  InspectResult
} from "../../../domain/src/index.js";

import { detectOpenClaw } from "./detect.js";
import { openClawAdapterMetadata, openClawDetectionRules } from "./definitions.js";
import { extractOpenClaw } from "./extract.js";
import { inspectOpenClaw } from "./inspect.js";
import { restoreOpenClaw } from "./restore.js";

export const openClawAdapter: AgentAdapter = {
  metadata: openClawAdapterMetadata,
  detectionRules: openClawDetectionRules,
  async detect(input: DetectInput) {
    return detectOpenClaw(input);
  },
  inspect: (sourcePath: string): Promise<InspectResult> => inspectOpenClaw(sourcePath),
  extract: (input) => extractOpenClaw(input),
  restore: (input) => restoreOpenClaw(input)
};
