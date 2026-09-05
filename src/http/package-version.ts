import type { HttpTransport } from "../core/http"

const REGISTRY_URL = "https://registry.npmjs.org"
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/

export type PackageVersionResolver = (signal: AbortSignal) => Promise<string | null>

export type PackageVersionResolverOptions = {
  readonly transport: HttpTransport
  readonly packageName: string
}

function versionFromPayload(body: Uint8Array): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return null
  }
  if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
    return null
  }
  const version = Reflect.get(parsed, "version")
  return typeof version === "string" && SEMVER_PATTERN.test(version) ? version : null
}

export function createPackageVersionResolver(
  options: PackageVersionResolverOptions,
): PackageVersionResolver {
  const url = `${REGISTRY_URL}/${encodeURIComponent(options.packageName)}/latest`
  let resolved: string | null = null
  let inFlight: Promise<string | null> | null = null
  const lookup = async (signal: AbortSignal): Promise<string | null> => {
    try {
      const response = await options.transport.request(
        { method: "GET", url, headers: { accept: "application/json" }, body: null },
        signal,
      )
      if (response.status < 200 || response.status >= 300) {
        return null
      }
      return versionFromPayload(response.body)
    } catch {
      return null
    }
  }
  return async (signal) => {
    if (resolved !== null) {
      return resolved
    }
    if (inFlight === null) {
      inFlight = lookup(signal).then((version) => {
        resolved = version
        inFlight = null
        return version
      })
    }
    return inFlight
  }
}
