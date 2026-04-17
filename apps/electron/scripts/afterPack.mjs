// Ad-hoc signs the packaged Worth.app on macOS.
//
// Apple's Gatekeeper shows a misleading "app is damaged" error for completely
// unsigned apps downloaded with quarantine (i.e. via a DMG from the internet).
// An ad-hoc signature — `codesign -s -` with identity "-" — is free, needs no
// Apple Developer account, and downgrades that error into the friendlier
// "unknown developer" prompt that the user can bypass via right-click → Open.

import { execFileSync } from "node:child_process"
import path from "node:path"

export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return

  const productFilename = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${productFilename}.app`)

  console.log(`[afterPack] ad-hoc signing ${appPath}`)
  execFileSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" },
  )
}
