import { commandCodeStreamRecordTooLargeError } from "./errors.js"

export async function* commandCodeRecords(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let buffer = "",
    recordBytes = 0,
    pendingCarriageReturn = false
  const append = (part: Uint8Array): void => {
    recordBytes += part.byteLength
    if (recordBytes > 1024 * 1024) throw commandCodeStreamRecordTooLargeError()
    buffer += decoder.decode(part, { stream: true })
  }
  const complete = (): string => {
    const line = buffer + decoder.decode()
    buffer = ""
    recordBytes = 0
    return line
  }
  for await (const chunk of chunks) {
    let start = 0
    if (pendingCarriageReturn && chunk.byteLength === 0) continue
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false
      if (chunk[0] === 10) {
        yield complete()
        start = 1
      } else append(new Uint8Array([13]))
    }
    for (let index = start; index < chunk.byteLength; index += 1) {
      if (chunk[index] !== 10) continue
      const end = chunk[index - 1] === 13 ? index - 1 : index
      append(chunk.subarray(start, end))
      yield complete()
      start = index + 1
    }
    const trailing = chunk.subarray(start)
    if (trailing.at(-1) === 13) {
      append(trailing.subarray(0, trailing.byteLength - 1))
      pendingCarriageReturn = true
    } else append(trailing)
  }
  if (pendingCarriageReturn) append(new Uint8Array([13]))
  buffer += decoder.decode()
  if (buffer.trim().length > 0) yield buffer
}
