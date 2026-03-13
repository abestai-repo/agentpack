import { z } from "zod";

import {
  ACCESS_MODELS,
  AEGG_SCHEMA_VERSION,
  CAM_SCHEMA_VERSION,
  COMPATIBILITY_CATEGORIES,
  COMPATIBILITY_STATUSES,
  MEMORY_KINDS,
  TOOL_KINDS,
  WORKFLOW_KINDS,
  type AeggManifest,
  type AeggMetadata,
  type CamDocument,
  type CompatibilityReport
} from "../../domain/src/index.js";

const nonEmptyString = z.string().trim().min(1);

const toolSchema = z.object({
  id: nonEmptyString,
  kind: z.enum(TOOL_KINDS),
  enabled: z.boolean()
}).catchall(z.unknown());

const workflowSchema = z.object({
  kind: z.enum(WORKFLOW_KINDS).optional()
}).catchall(z.unknown());

const envVariableSchema = z.object({
  name: nonEmptyString.optional(),
  required: z.boolean().optional(),
  secret: z.boolean().optional()
}).catchall(z.unknown()).superRefine((value, ctx) => {
  if (value.secret === true && Object.hasOwn(value, "value")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Secret environment variables must not embed raw values.",
      path: ["value"]
    });
  }
});

export const camDocumentSchema = z.object({
  schema_version: z.literal(CAM_SCHEMA_VERSION),
  agent: z.object({
    name: nonEmptyString,
    slug: nonEmptyString.optional(),
    description: z.string().optional(),
    authors: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional()
  }).strict(),
  models: z.record(z.string(), z.unknown()),
  instructions: z.record(z.string(), z.unknown()),
  tools: z.array(toolSchema),
  memory: z.object({
    enabled: z.boolean(),
    kind: z.enum(MEMORY_KINDS)
  }).catchall(z.unknown()),
  workflows: z.array(workflowSchema),
  environment: z.object({
    variables: z.array(envVariableSchema),
    platform: z.object({
      os: z.array(z.string()),
      arch: z.array(z.string())
    }).strict()
  }).strict(),
  extensions: z.record(z.string(), z.unknown()),
  source: z.object({
    framework: nonEmptyString,
    detected_confidence: z.number().min(0).max(1).optional()
  }).catchall(z.unknown()),
  metadata: z.object({
    created_by: nonEmptyString
  }).catchall(z.unknown())
}).strict() satisfies z.ZodType<CamDocument>;

export const aeggManifestSchema = z.object({
  schema_version: z.literal(AEGG_SCHEMA_VERSION),
  cam_schema_version: z.literal(CAM_SCHEMA_VERSION),
  package_id: nonEmptyString,
  name: nonEmptyString,
  version: nonEmptyString,
  created_at: nonEmptyString,
  entrypoints: z.object({
    cam: nonEmptyString,
    metadata: nonEmptyString,
    compatibility: nonEmptyString,
    checksums: nonEmptyString
  }).strict()
}).strict() satisfies z.ZodType<AeggManifest>;

export const aeggMetadataSchema = z.object({
  display: z.object({
    title: nonEmptyString,
    summary: nonEmptyString,
    tags: z.array(z.string())
  }).strict(),
  provenance: z.object({
    created_by: nonEmptyString,
    created_by_version: nonEmptyString,
    source_framework: nonEmptyString,
    source_adapter_version: nonEmptyString
  }).strict(),
  distribution: z.object({
    public: z.boolean(),
    remote_refs: z.array(z.string()),
    listing_refs: z.array(z.string())
  }).strict(),
  commercial: z.object({
    entitlement_required: z.boolean(),
    supported_access_models: z.array(z.enum(ACCESS_MODELS))
  }).strict()
}).strict() satisfies z.ZodType<AeggMetadata>;

const categoryScoreSchema = z.object({
  category: z.enum(COMPATIBILITY_CATEGORIES),
  score: z.number().min(0).max(1),
  status: z.enum(COMPATIBILITY_STATUSES),
  weight: z.number()
}).strict();

const compatibilityItemSchema = z.object({
  category: z.enum(COMPATIBILITY_CATEGORIES),
  path: nonEmptyString,
  label: nonEmptyString,
  status: z.enum(COMPATIBILITY_STATUSES),
  score: z.number().min(0).max(1),
  weight: z.number(),
  critical: z.boolean(),
  message: nonEmptyString,
  manual_step: nonEmptyString.optional()
}).strict();

const packageCompatibilitySchema = z.object({
  generated_at: nonEmptyString,
  source_framework: nonEmptyString,
  targets: z.array(z.object({
    framework: nonEmptyString,
    status: z.enum(["supported", "partial", "unsupported"]),
    score: z.number().min(0).max(1)
  }).strict())
}).strict();

export const compatibilityReportSchema = z.object({
  target_framework: nonEmptyString,
  target_adapter_version: nonEmptyString,
  mode: z.enum(["safe", "best-effort"]),
  score: z.number().min(0).max(1),
  status: z.enum(["supported", "partial", "unsupported"]),
  category_scores: z.array(categoryScoreSchema),
  items: z.array(compatibilityItemSchema),
  manual_steps: z.array(nonEmptyString)
}).strict() satisfies z.ZodType<CompatibilityReport>;

export const compatibilityDocumentSchema = z.union([
  packageCompatibilitySchema,
  compatibilityReportSchema
]);

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  valid: boolean;
  data?: T;
  errors: ValidationError[];
}

function formatZodErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? `$.${issue.path.join(".")}` : "$",
    message: issue.message
  }));
}

function validateWithSchema<T>(schema: z.ZodType<T>, payload: unknown): ValidationResult<T> {
  const result = schema.safeParse(payload);
  if (result.success) {
    return { valid: true, data: result.data, errors: [] };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error)
  };
}

export function validateCamDocument(payload: unknown): ValidationResult<CamDocument> {
  return validateWithSchema(camDocumentSchema, payload);
}

export function validateAeggManifest(payload: unknown): ValidationResult<AeggManifest> {
  return validateWithSchema(aeggManifestSchema, payload);
}

export function validateAeggMetadata(payload: unknown): ValidationResult<AeggMetadata> {
  return validateWithSchema(aeggMetadataSchema, payload);
}

export function validateAeggCompatibilityDocument(
  payload: unknown
): ValidationResult<CompatibilityReport | z.infer<typeof packageCompatibilitySchema>> {
  return validateWithSchema(compatibilityDocumentSchema, payload);
}

export function inferValidationKind(filePath: string, payload: unknown) {
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const value = payload as Record<string, unknown> | null;

  if (normalizedPath.endsWith("cam.json")) {
    return "cam";
  }
  if (normalizedPath.endsWith("manifest.json")) {
    return "manifest";
  }
  if (normalizedPath.endsWith("metadata.json")) {
    return "metadata";
  }
  if (normalizedPath.endsWith("compatibility.json")) {
    return "compatibility";
  }
  if (value?.schema_version === CAM_SCHEMA_VERSION) {
    return "cam";
  }
  if (value?.schema_version === AEGG_SCHEMA_VERSION) {
    return "manifest";
  }
  if (value && "display" in value && "provenance" in value) {
    return "metadata";
  }

  return "compatibility";
}
