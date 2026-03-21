import process from "node:process";

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m"
} as const;

const PALETTE = {
  matrixGreen: 46, // Bright Neon Green
  tronCyan: 51,    // Electric Cyan
  darkGreen: 28,   // Deep Matrix Green
  emerald: 40,
  ice: 159,
  neonYellow: 226,
  alertRed: 196,
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

const HERO_TAGLINE = "Migrate. Snapshot. Restore. Clone agent DNA everywhere.";
const HERO_SUBTITLE = "Local-first CLI for packaging, inspection, and recovery.";

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
  const top = color(`┏${"━".repeat(width + 2)}┓`, PALETTE.matrixGreen, true);
  const bottom = color(`┗${"━".repeat(width + 2)}┛`, PALETTE.matrixGreen, true);
  const body = lines.map((line) => {
    const content = padRight(line, width);
    return `${color("┃", PALETTE.matrixGreen, true)} ${content} ${color("┃", PALETTE.matrixGreen, true)}`;
  });

  return [top, ...body, bottom].join("\n");
}

export const TIPS = {
  detect: [
    "When using OpenClaw, run \"agentpack detect\" on OpenClaw state or workspace folders, such as \"~/.openclaw\"",
    "Use \"agentpack detect\" on any agent folders to detect the AI framework. ",
    "Use \"agentpack inspect\" to determine if an Agent Egg (.aegg) package backup is possible."
  ],
  general: [
    "Run 'agentpack --help' to see all available commands and options."
  ]
};

export function getRandomTip(command?: string) {
  const isDetect = command === "detect";
  if (isDetect) {
    if (Math.random() < 0.70) {
      if (TIPS.detect.length > 0) {
        return `TIP: ${TIPS.detect[Math.floor(Math.random() * TIPS.detect.length)]}`;
      }
    }
  }

  if (TIPS.general.length > 0) {
    return `TIP: ${TIPS.general[Math.floor(Math.random() * TIPS.general.length)]}`;
  }
  return "TIP: Welcome to AgentPack.";
}

export function renderHero(command?: string) {
  const logo = LOGO_LINES.map((line, index) =>
    gradient(line, index % 2 === 0 ? [PALETTE.matrixGreen, PALETTE.emerald, PALETTE.tronCyan] : [PALETTE.tronCyan, PALETTE.matrixGreen, PALETTE.emerald])
  );

  const overlay = [
    color(getRandomTip(command), PALETTE.tronCyan, true),
    "",
    color(HERO_TAGLINE, PALETTE.matrixGreen, true),
    dim(HERO_SUBTITLE)
  ];

  return `${logo.join("\n")}\n\n${overlay.join("\n")}`;
}

export function renderSection(title: string, rows: Array<{ label: string; value: string }>) {
  const lines = [
    color(` ${title.toUpperCase()} `, PALETTE.neonYellow, true),
    ...rows.map(({ label, value }) => {
      const paintedLabel = color(padRight(label, 24), PALETTE.emerald, true);
      const paintedValue = color(value, PALETTE.ice);
      return `${paintedLabel} ${paintedValue}`;
    })
  ];

  return buildFrame(lines);
}

export function renderStatus(status: "valid" | "invalid") {
  return status === "valid"
    ? color("VALID", PALETTE.matrixGreen, true)
    : color("INVALID", PALETTE.alertRed, true);
}

export function renderErrorList(errors: string[]) {
  return errors
    .map((error, index) => `${color(` ${String(index + 1).padStart(2, "0")} `, PALETTE.alertRed, true)} ${color(error, PALETTE.ice)}`)
    .join("\n");
}
