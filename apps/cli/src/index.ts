#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { Command } from "commander";

import {
  AEGG_SCHEMA_VERSION,
  CAM_SCHEMA_VERSION,
  COMPATIBILITY_CATEGORIES,
  EXIT_CODES
} from "../../../packages/domain/src/index.js";
import {
  inferValidationKind,
  validateAeggCompatibilityDocument,
  validateAeggManifest,
  validateAeggMetadata,
  validateCamDocument,
  type ValidationError
} from "../../../packages/schemas/src/index.js";
import {
  renderErrorList,
  renderHero,
  renderSection,
  renderStatus
} from "./render.js";

export async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export function formatErrors(errors: ValidationError[]) {
  return errors.map((error) => `${error.path}: ${error.message}`);
}

function validateByKind(kind: string, payload: unknown) {
  switch (kind) {
    case "cam":
      return validateCamDocument(payload);
    case "manifest":
      return validateAeggManifest(payload);
    case "metadata":
      return validateAeggMetadata(payload);
    case "compatibility":
      return validateAeggCompatibilityDocument(payload);
    default:
      return {
        valid: false,
        errors: [{ path: "$", message: `Unknown validation kind "${kind}".` }]
      };
  }
}

export async function main(argv = process.argv): Promise<number> {
  const program = new Command();
  let resolvedExitCode: number = EXIT_CODES.SUCCESS;

  program
    .name("agentpack")
    .description("AgentPack Phase 1 foundation CLI")
    .showHelpAfterError()
    .configureOutput({
      writeOut: (text) => process.stdout.write(text),
      writeErr: (text) => process.stderr.write(text)
    });

  program
    .command("schemas")
    .description("Print the active schema versions and compatibility categories")
    .option("--json", "print JSON output")
    .action(async (options: { json?: boolean }) => {
      const payload = {
        product: "agentpack",
        versions: {
          cam: CAM_SCHEMA_VERSION,
          aegg: AEGG_SCHEMA_VERSION
        },
        compatibility: {
          categories: [...COMPATIBILITY_CATEGORIES]
        }
      };

      if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHero()}\n\n`);
      process.stdout.write(
        `${renderSection("Schema Matrix", [
          { label: "CAM schema", value: payload.versions.cam },
          { label: ".aegg schema", value: payload.versions.aegg },
          {
            label: "compatibility lanes",
            value: payload.compatibility.categories.join(", ")
          }
        ])}\n`
      );
    });

  program
    .command("validate")
    .description("Validate a CAM or .aegg JSON document")
    .argument("<file>", "path to the JSON file")
    .option("--kind <kind>", "cam | manifest | metadata | compatibility")
    .option("--json", "print JSON output")
    .action(async (file: string, options: { kind?: string; json?: boolean }) => {
      const resolvedPath = path.resolve(process.cwd(), file);
      const payload = await readJsonFile(resolvedPath);
      const kind = options.kind ?? inferValidationKind(resolvedPath, payload);
      const result = validateByKind(kind, payload);

      if (options.json) {
        process.stdout.write(
          `${JSON.stringify(
            {
              command: "validate",
              file: resolvedPath,
              kind,
              valid: result.valid,
              errors: result.errors
            },
            null,
            2
          )}\n`
        );
      } else {
        process.stdout.write(`${renderHero()}\n\n`);
        process.stdout.write(
          `${renderSection("Validation Telemetry", [
            { label: "file", value: resolvedPath },
            { label: "kind", value: kind },
            { label: "status", value: renderStatus(result.valid ? "valid" : "invalid") }
          ])}\n`
        );
        if (!result.valid) {
          process.stdout.write(`\n${renderErrorList(formatErrors(result.errors))}\n`);
        }
      }

      resolvedExitCode = result.valid ? EXIT_CODES.SUCCESS : EXIT_CODES.GENERAL_ERROR;
    });

  try {
    await program.parseAsync(argv, { from: "node" });
    return resolvedExitCode;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_CODES.GENERAL_ERROR;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;

if (invokedPath === import.meta.url) {
  const exitCode = await main();
  process.exit(exitCode);
}
