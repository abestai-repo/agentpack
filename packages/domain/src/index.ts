export const CAM_SCHEMA_VERSION = "cam-1.0" as const;
export const AEGG_SCHEMA_VERSION = "aegg-1.0" as const;

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_USAGE: 2,
  DETECTION_FAILURE: 3,
  COMPATIBILITY_FAILURE: 4,
  RESTORE_FAILURE: 5,
  AUTH_FAILURE: 6,
  ACCESS_FAILURE: 7
} as const;

export const TOOL_KINDS = [
  "api",
  "filesystem",
  "browser",
  "database",
  "code_execution",
  "knowledge",
  "custom"
] as const;

export const MEMORY_KINDS = ["none", "vector", "graph", "kv", "custom"] as const;
export const WORKFLOW_KINDS = ["pipeline", "graph", "loop", "custom"] as const;
export const COMPATIBILITY_STATUSES = [
  "supported",
  "partial",
  "unsupported",
  "not_applicable"
] as const;
export const COMPATIBILITY_CATEGORIES = [
  "agent_identity",
  "models",
  "instructions",
  "tools",
  "memory",
  "workflows",
  "environment",
  "extensions"
] as const;

export const COMPATIBILITY_CATEGORY_WEIGHTS = {
  instructions: 0.22,
  tools: 0.2,
  workflows: 0.18,
  models: 0.14,
  memory: 0.12,
  environment: 0.07,
  agent_identity: 0.04,
  extensions: 0.03
} as const;

export const ACCESS_MODELS = ["buy", "rent", "subscribe"] as const;
export const ADAPTER_CAPABILITIES = [
  "detect",
  "inspect",
  "extract",
  "restore",
  "convert-target",
  "compatibility-report"
] as const;

export type ToolKind = (typeof TOOL_KINDS)[number];
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type WorkflowKind = (typeof WORKFLOW_KINDS)[number];
export type CompatibilityStatus = (typeof COMPATIBILITY_STATUSES)[number];
export type CompatibilityCategory = (typeof COMPATIBILITY_CATEGORIES)[number];
export type AccessModel = (typeof ACCESS_MODELS)[number];

export interface CamDocument {
  schema_version: typeof CAM_SCHEMA_VERSION;
  agent: {
    name: string;
    slug?: string;
    description?: string;
    authors?: string[];
    tags?: string[];
  };
  models: Record<string, unknown>;
  instructions: Record<string, unknown>;
  tools: Array<{
    id: string;
    kind: ToolKind;
    enabled: boolean;
    [key: string]: unknown;
  }>;
  memory: {
    enabled: boolean;
    kind: MemoryKind;
    [key: string]: unknown;
  };
  workflows: Array<{
    kind?: WorkflowKind;
    [key: string]: unknown;
  }>;
  environment: {
    variables: Array<Record<string, unknown>>;
    platform: {
      os: string[];
      arch: string[];
    };
  };
  extensions: Record<string, unknown>;
  source: {
    framework: string;
    detected_confidence?: number;
    [key: string]: unknown;
  };
  metadata: {
    created_by: string;
    [key: string]: unknown;
  };
}

export interface AeggManifest {
  schema_version: typeof AEGG_SCHEMA_VERSION;
  cam_schema_version: typeof CAM_SCHEMA_VERSION;
  package_id: string;
  name: string;
  version: string;
  created_at: string;
  entrypoints: {
    cam: string;
    metadata: string;
    compatibility: string;
    checksums: string;
  };
}

export interface AeggMetadata {
  display: {
    title: string;
    summary: string;
    tags: string[];
  };
  provenance: {
    created_by: string;
    created_by_version: string;
    source_framework: string;
    source_adapter_version: string;
  };
  distribution: {
    public: boolean;
    remote_refs: string[];
    listing_refs: string[];
  };
  commercial: {
    entitlement_required: boolean;
    supported_access_models: AccessModel[];
  };
}

export interface CompatibilityItem {
  category: CompatibilityCategory;
  path: string;
  label: string;
  status: CompatibilityStatus;
  score: number;
  weight: number;
  critical: boolean;
  message: string;
  manual_step?: string;
}

export interface CompatibilityReport {
  target_framework: string;
  target_adapter_version: string;
  mode: "safe" | "best-effort";
  score: number;
  status: Exclude<CompatibilityStatus, "not_applicable">;
  category_scores: Array<{
    category: CompatibilityCategory;
    score: number;
    status: CompatibilityStatus;
    weight: number;
  }>;
  items: CompatibilityItem[];
  manual_steps: string[];
}

export function createMinimalCam(overrides: Partial<CamDocument> = {}): CamDocument {
  return {
    schema_version: CAM_SCHEMA_VERSION,
    agent: {
      name: "Unnamed Agent",
      ...overrides.agent
    },
    models: overrides.models ?? {},
    instructions: overrides.instructions ?? {},
    tools: overrides.tools ?? [],
    memory: {
      enabled: false,
      kind: "none",
      ...overrides.memory
    },
    workflows: overrides.workflows ?? [],
    environment: {
      variables: [],
      platform: {
        os: [],
        arch: []
      },
      ...overrides.environment
    },
    extensions: overrides.extensions ?? {},
    source: {
      framework: "unknown",
      ...overrides.source
    },
    metadata: {
      created_by: "agentpack",
      ...overrides.metadata
    }
  };
}

export function createMinimalAeggManifest(
  overrides: Partial<AeggManifest> = {}
): AeggManifest {
  return {
    schema_version: AEGG_SCHEMA_VERSION,
    cam_schema_version: CAM_SCHEMA_VERSION,
    package_id: "pkg_example",
    name: "unnamed-agent",
    version: "0.1.0",
    created_at: "2026-03-14T00:00:00Z",
    entrypoints: {
      cam: "cam.json",
      metadata: "metadata.json",
      compatibility: "compatibility.json",
      checksums: "checksums.json"
    },
    ...overrides
  };
}

export function createMinimalAeggMetadata(
  overrides: Partial<AeggMetadata> = {}
): AeggMetadata {
  return {
    display: {
      title: "Unnamed Agent",
      summary: "No summary provided.",
      tags: [],
      ...overrides.display
    },
    provenance: {
      created_by: "agentpack",
      created_by_version: "0.1.0",
      source_framework: "unknown",
      source_adapter_version: "0.1.0",
      ...overrides.provenance
    },
    distribution: {
      public: false,
      remote_refs: [],
      listing_refs: [],
      ...overrides.distribution
    },
    commercial: {
      entitlement_required: false,
      supported_access_models: [],
      ...overrides.commercial
    }
  };
}

export function createMinimalCompatibilityReport(
  overrides: Partial<CompatibilityReport> = {}
): CompatibilityReport {
  return {
    target_framework: "unknown",
    target_adapter_version: "0.1.0",
    mode: "safe",
    score: 1,
    status: "supported",
    category_scores: [],
    items: [],
    manual_steps: [],
    ...overrides
  };
}
