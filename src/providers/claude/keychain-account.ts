export function parseKeychainAccount(dump: string): string | null {
  const marker = '"acct"<blob>="'
  const start = dump.indexOf(marker)
  if (start === -1) return null
  const valueStart = start + marker.length
  const end = dump.indexOf('"', valueStart)
  return end <= valueStart ? null : dump.slice(valueStart, end)
}
