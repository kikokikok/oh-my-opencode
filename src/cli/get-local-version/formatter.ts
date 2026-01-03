import color from "picocolors"
import type { VersionInfo } from "./types"
import { getPackageName } from "../../shared"

const SYMBOLS = {
  check: color.green("✓"),
  cross: color.red("✗"),
  arrow: color.cyan("→"),
  info: color.blue("ℹ"),
  warn: color.yellow("⚠"),
  pin: color.magenta("📌"),
  dev: color.cyan("🔧"),
}

export function formatVersionOutput(info: VersionInfo): string {
  const packageName = getPackageName()
  const lines: string[] = []

  lines.push("")
  lines.push(color.bold(color.white(`${packageName} Version Information`)))
  lines.push(color.dim("─".repeat(50)))
  lines.push("")

  if (info.currentVersion) {
    lines.push(`  Current Version: ${color.cyan(info.currentVersion)}`)
  } else {
    lines.push(`  Current Version: ${color.dim("unknown")}`)
  }

  if (!info.isLocalDev && info.latestVersion) {
    lines.push(`  Latest Version:  ${color.cyan(info.latestVersion)}`)
  }

  lines.push("")

  switch (info.status) {
    case "up-to-date":
      lines.push(`  ${SYMBOLS.check} ${color.green("You're up to date!")}`)
      break
    case "outdated":
      lines.push(`  ${SYMBOLS.warn} ${color.yellow("Update available")}`)
      lines.push(`  ${color.dim("Run:")} ${color.cyan(`cd ~/.config/opencode && bun update ${packageName}`)}`)
      break
    case "local-dev":
      lines.push(`  ${SYMBOLS.dev} ${color.cyan("Running in local development mode")}`)
      lines.push(`  ${color.dim("Using file:// protocol from config")}`)
      break
    case "pinned":
      lines.push(`  ${SYMBOLS.pin} ${color.magenta(`Version pinned to ${info.pinnedVersion}`)}`)
      lines.push(`  ${color.dim("Update check skipped for pinned versions")}`)
      break
    case "error":
      lines.push(`  ${SYMBOLS.cross} ${color.red("Unable to check for updates")}`)
      lines.push(`  ${color.dim("Network error or npm registry unavailable")}`)
      break
    case "unknown":
      lines.push(`  ${SYMBOLS.info} ${color.yellow("Version information unavailable")}`)
      break
  }

  lines.push("")

  return lines.join("\n")
}

export function formatJsonOutput(info: VersionInfo): string {
  return JSON.stringify(info, null, 2)
}
