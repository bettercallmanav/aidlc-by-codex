import fs from "node:fs"
import path from "node:path"

const normalizeValue = (value: string) => {
  const trimmed = value.trim()

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

export const loadLocalEnv = (rootDir: string) => {
  const envFiles = [".env.local", ".env"]

  for (const fileName of envFiles) {
    const envPath = path.join(rootDir, fileName)

    if (!fs.existsSync(envPath)) {
      continue
    }

    const raw = fs.readFileSync(envPath, "utf8")

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()

      if (!trimmed || trimmed.startsWith("#")) {
        continue
      }

      const separatorIndex = trimmed.indexOf("=")

      if (separatorIndex <= 0) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex).trim()

      if (!key || process.env[key]) {
        continue
      }

      const value = normalizeValue(trimmed.slice(separatorIndex + 1))
      process.env[key] = value
    }
  }
}
