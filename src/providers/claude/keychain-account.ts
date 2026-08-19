const ACCT_MARKER = '"acct"<blob>="'

export function parseKeychainAccount(dump: string): string | null {
  const start = dump.indexOf(ACCT_MARKER)
  if (start === -1) {
    return null
  }
  const valueStart = start + ACCT_MARKER.length
  const end = dump.indexOf('"', valueStart)
  if (end === -1) {
    return null
  }
  const account = dump.slice(valueStart, end)
  return account.length > 0 ? account : null
}
