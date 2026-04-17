import { existsSync, promises as fsp } from "node:fs"
import path from "node:path"
import { app, safeStorage, systemPreferences } from "electron"

const keyFile = (): string =>
  path.join(app.getPath("userData"), "worth-biometric.bin")

export const biometricAvailable = (): boolean => {
  if (process.platform !== "darwin") return false
  if (!systemPreferences.canPromptTouchID()) return false
  if (!safeStorage.isEncryptionAvailable()) return false
  return true
}

export const biometricEnabled = (): boolean => existsSync(keyFile())

export const storeBiometricPassword = async (password: string): Promise<void> => {
  const encrypted = safeStorage.encryptString(password)
  await fsp.writeFile(keyFile(), encrypted, { mode: 0o600 })
}

export const clearBiometricPassword = async (): Promise<void> => {
  try {
    await fsp.unlink(keyFile())
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause
  }
}

export type BiometricPromptResult =
  | { ok: true; password: string }
  | {
      ok: false
      reason: "user-cancelled" | "unavailable" | "not-enabled" | "corrupt"
    }

// Security rests on the Touch ID gate in front — the on-disk blob is only
// Keychain-protected at the app-identity level, not by biometrics directly.
export const promptForBiometricPassword = async (
  reason: string,
): Promise<BiometricPromptResult> => {
  if (!biometricAvailable()) return { ok: false, reason: "unavailable" }
  if (!biometricEnabled()) return { ok: false, reason: "not-enabled" }
  try {
    await systemPreferences.promptTouchID(reason)
  } catch {
    return { ok: false, reason: "user-cancelled" }
  }
  try {
    const buf = await fsp.readFile(keyFile())
    const password = safeStorage.decryptString(buf)
    return { ok: true, password }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: false, reason: "not-enabled" }
    }
    return { ok: false, reason: "corrupt" }
  }
}
