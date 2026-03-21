import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export interface LoggedAction {
  type: "copy" | "mkdir" | "write" | "delete" | "merge";
  src?: string;
  dest: string;
  timestamp: string;
  originalContent?: string;
}

export class HatchOperations {
  private log: LoggedAction[] = [];
  private confirm: boolean;
  private logUndo: boolean;
  private rl?: readline.Interface;

  constructor(options: { confirmStepByStep?: boolean; logUndo?: boolean }) {
    this.confirm = !!options.confirmStepByStep;
    this.logUndo = !!options.logUndo;
    if (this.confirm) {
      this.rl = readline.createInterface({ input, output });
    }
  }

  async close() {
    if (this.rl) {
      this.rl.close();
    }
    if (this.logUndo && this.log.length > 0) {
      const logPath = path.resolve(process.cwd(), `hatch-undo-${Date.now()}.json`);
      await fs.writeFile(logPath, JSON.stringify(this.log, null, 2));
      process.stdout.write(`\n  \x1b[1m\x1b[35m[UNDO LOG SAVED]\x1b[0m \x1b[36m${logPath}\x1b[0m\n`);
    }
  }

  async askConfirmation(prompt: string): Promise<"Y" | "N" | "S" | "A"> {
    if (!this.rl) return "Y";
    while (true) {
      const answer = await this.rl.question(`  \x1b[33m?\x1b[0m ${prompt} [Y/n/s/a]: `);
      const normalized = answer.trim().toUpperCase();
      if (!normalized || normalized === "Y") return "Y";
      if (normalized === "N") return "N";
      if (normalized === "S") return "S";
      if (normalized === "A") return "A";
    }
  }

  async performCopy(src: string, dest: string, force: boolean): Promise<boolean> {
    if (this.confirm) {
       const ans = await this.askConfirmation(`Copy \x1b[36m${path.basename(src)}\x1b[0m to \x1b[36m${dest}\x1b[0m?`);
       if (ans === "N" || ans === "S") return false;
       if (ans === "A") throw new Error("Operation aborted by user.");
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.cp(src, dest, { force, errorOnExist: !force });
    
    if (this.logUndo) {
      this.log.push({ type: "copy", src, dest, timestamp: new Date().toISOString() });
    }
    return true;
  }

  async performMergeJson(src: string, dest: string, force: boolean): Promise<boolean> {
    const destExists = await fs.stat(dest).then(() => true).catch(() => false);
    
    if (this.confirm) {
       const actionType = destExists ? "Merge" : "Write";
       const ans = await this.askConfirmation(`${actionType} \x1b[36m${path.basename(src)}\x1b[0m into \x1b[36m${dest}\x1b[0m?`);
       if (ans === "N" || ans === "S") return false;
       if (ans === "A") throw new Error("Operation aborted by user.");
    }

    const srcContent = await fs.readFile(src, "utf8");
    const srcJson = JSON.parse(srcContent);

    let originalContent: string | undefined;
    let finalJson = srcJson;

    if (destExists) {
       originalContent = await fs.readFile(dest, "utf8");
       try {
         const destJson = JSON.parse(originalContent);
         finalJson = await this.mergeSanitized(destJson, srcJson, path.basename(dest));
       } catch (err) {
         if (!force) throw new Error(`Destination ${dest} exists and is not valid JSON. Use --force to overwrite.`);
       }
    }

    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, JSON.stringify(finalJson, null, 2) + "\n", "utf8");

    if (this.logUndo) {
      this.log.push({ type: "merge", src, dest, timestamp: new Date().toISOString(), originalContent });
    }
    return true;
  }

  private async mergeSanitized(target: any, source: any, currentPath: string): Promise<any> {
    if (Array.isArray(source)) {
      if (this.confirm && JSON.stringify(target) !== JSON.stringify(source)) {
        const ans = await this.askConfirmation(`Overwrite array \x1b[36m${currentPath}\x1b[0m?`);
        if (ans === "A") throw new Error("Operation aborted by user.");
        if (ans === "N" || ans === "S") return target;
      }
      return source;
    }
    
    if (source !== null && typeof source === 'object') {
      const merged = target !== null && typeof target === 'object' ? { ...target } : {};
      for (const key of Object.keys(source)) {
        const fieldPath = `${currentPath}.${key}`;
        if (source[key] === "__OPENCLAW_REDACTED__") {
           if (!(key in merged)) {
              merged[key] = "__FILL_IN_VALUE__";
           }
        } else if (typeof source[key] === 'object' && source[key] !== null) {
           merged[key] = await this.mergeSanitized(merged[key], source[key], fieldPath);
        } else {
           if (merged[key] !== source[key]) {
             if (this.confirm) {
               const valStr = JSON.stringify(source[key]);
               const displayVal = valStr.length > 50 ? valStr.substring(0, 47) + "..." : valStr;
               const ans = await this.askConfirmation(`Update \x1b[36m${fieldPath}\x1b[0m to \x1b[32m${displayVal}\x1b[0m?`);
               if (ans === "A") throw new Error("Operation aborted by user.");
               if (ans === "N" || ans === "S") continue; // Keep old value
             }
             merged[key] = source[key];
           }
        }
      }
      return merged;
    }
    
    if (this.confirm && target !== source) {
      const valStr = JSON.stringify(source);
      const displayVal = valStr.length > 50 ? valStr.substring(0, 47) + "..." : valStr;
      const ans = await this.askConfirmation(`Update \x1b[36m${currentPath}\x1b[0m to \x1b[32m${displayVal}\x1b[0m?`);
      if (ans === "A") throw new Error("Operation aborted by user.");
      if (ans === "N" || ans === "S") return target;
    }
    return source;
  }
}

export async function performUndo(logPath: string) {
  const resolvedPath = path.resolve(process.cwd(), logPath);
  const logData = await fs.readFile(resolvedPath, "utf8");
  const actions: LoggedAction[] = JSON.parse(logData);

  process.stdout.write(`  \x1b[1m\x1b[35m[INITIATING UNDO SEQUENCE]\x1b[0m\n  > LOG SOURCE: \x1b[36m${resolvedPath}\x1b[0m\n  status: reversing changes...\n\n`);

  for (let i = actions.length - 1; i >= 0; i--) {
    const action = actions[i];
    if (action.type === "copy" || action.type === "write" || action.type === "merge") {
      try {
        if (action.originalContent !== undefined) {
          await fs.writeFile(action.dest, action.originalContent, "utf8");
          process.stdout.write(`  \x1b[32m✔\x1b[0m Restored original: \x1b[36m${action.dest}\x1b[0m\n`);
        } else {
          await fs.rm(action.dest, { force: true, recursive: true });
          process.stdout.write(`  \x1b[32m✔\x1b[0m Reverted: \x1b[36m${action.dest}\x1b[0m\n`);
        }
      } catch (err: any) {
        process.stdout.write(`  \x1b[31m✘\x1b[0m Failed to revert \x1b[36m${action.dest}\x1b[0m: ${err.message}\n`);
      }
    }
  }
  
  process.stdout.write(`\n  \x1b[1m\x1b[32m// ⚡ UNDO SEQUENCE COMPLETE ⚡ //\x1b[0m\n\n`);
}
