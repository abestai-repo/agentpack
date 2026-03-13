import process from "node:process";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m"
} as const;

const PALETTE = {
  cyan: 51,
  ice: 159,
  blue: 45,
  green: 118,
  amber: 220,
  red: 203,
  slate: 110
} as const;

const LOGO_LINES = [
  "  █████╗  ██████╗ ███████╗███╗   ██╗████████╗██████╗  █████╗  ██████╗██╗  ██╗",
  " ██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██╔══██╗██╔════╝██║ ██╔╝",
  " ███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ██████╔╝███████║██║     █████╔╝ ",
  " ██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ██╔═══╝ ██╔══██║██║     ██╔═██╗ ",
  " ██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ██║     ██║  ██║╚██████╗██║  ██╗",
  " ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝     ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝"
] as const;

const HERO_TAGLINE = "Migrate. Snapshot. Restore. Clone agent DNA with operator-grade style.";
const HERO_SUBTITLE = "Local-first CLI for cinematic packaging, inspection, and recovery flows.";

function supportsColor() {
  return Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined);
}

function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

function color(text: string, code: number, bold = false) {
  if (!supportsColor()) {
    return text;
  }

  const weight = bold ? ANSI.bold : "";
  return `${weight}\u001b[38;5;${code}m${text}${ANSI.reset}`;
}

function dim(text: string) {
  return supportsColor() ? `${ANSI.dim}${text}${ANSI.reset}` : text;
}

function gradient(text: string, colors: readonly number[]) {
  if (!supportsColor()) {
    return text;
  }

  return [...text]
    .map((character, index) => color(character, colors[index % colors.length], true))
    .join("");
}

function padRight(text: string, width: number) {
  const visibleLength = stripAnsi(text).length;
  return visibleLength >= width ? text : `${text}${" ".repeat(width - visibleLength)}`;
}

function buildFrame(lines: string[]) {
  const rawWidths = lines.map((line) => stripAnsi(line).length);
  const width = Math.max(...rawWidths);
  const top = color(`┏${"━".repeat(width + 2)}┓`, PALETTE.blue, true);
  const bottom = color(`┗${"━".repeat(width + 2)}┛`, PALETTE.blue, true);
  const body = lines.map((line) => {
    const content = padRight(line, width);
    return `${color("┃", PALETTE.blue, true)} ${content} ${color("┃", PALETTE.blue, true)}`;
  });

  return [top, ...body, bottom].join("\n");
}

export function renderHero() {
  const logo = LOGO_LINES.map((line, index) =>
    gradient(line, index % 2 === 0 ? [PALETTE.cyan, PALETTE.ice, PALETTE.blue] : [PALETTE.blue, PALETTE.cyan, PALETTE.ice])
  );

  const overlay = [
    color("AGENTPACK // CHROMA OPS CONSOLE", PALETTE.green, true),
    dim("matrix/tron restore bay · premium local-first artifact tooling"),
    "",
    color(HERO_TAGLINE, PALETTE.ice, true),
    dim(HERO_SUBTITLE)
  ];

  return `${logo.join("\n")}\n\n${overlay.join("\n")}`;
}

export function renderSection(title: string, rows: Array<{ label: string; value: string }>) {
  const lines = [
    color(` ${title.toUpperCase()} `, PALETTE.amber, true),
    ...rows.map(({ label, value }) => {
      const paintedLabel = color(padRight(label, 24), PALETTE.slate, true);
      const paintedValue = color(value, PALETTE.ice);
      return `${paintedLabel} ${paintedValue}`;
    })
  ];

  return buildFrame(lines);
}

export function renderStatus(status: "valid" | "invalid") {
  return status === "valid"
    ? color("VALID", PALETTE.green, true)
    : color("INVALID", PALETTE.red, true);
}

export function renderErrorList(errors: string[]) {
  return errors
    .map((error, index) => `${color(` ${String(index + 1).padStart(2, "0")} `, PALETTE.red, true)} ${color(error, PALETTE.ice)}`)
    .join("\n");
}
