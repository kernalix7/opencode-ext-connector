export async function settleCursorCleanup(
  obligations: readonly (() => void | Promise<void>)[],
): Promise<void> {
  const failures: unknown[] = []
  for (const obligation of obligations) {
    const [result] = await Promise.allSettled([Promise.resolve().then(obligation)])
    if (result?.status === "rejected") failures.push(result.reason)
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "Cursor cleanup failed")
  }
}
