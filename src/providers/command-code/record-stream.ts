import { commandCodeStreamRecordTooLargeError } from "./errors"

const MAX_STREAM_RECORD_BYTES = 1024 * 1024
const CARRIAGE_RETURN = 13
const LINE_FEED = 10

export async function* commandCodeRecords(
  chunks: AsyncIterable<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder()
  let buffer = ""
  let recordBytes = 0
  let pendingCarriageReturn = false
  const append = (segment: Uint8Array): void => {
    recordBytes += segment.byteLength
    if (recordBytes > MAX_STREAM_RECORD_BYTES) {
      throw commandCodeStreamRecordTooLargeError()
    }
    buffer += decoder.decode(segment, { stream: true })
  }
  const complete = (): string => {
    const record = buffer + decoder.decode()
    buffer = ""
    recordBytes = 0
    return record
  }
  for await (const chunk of chunks) {
    let start = 0
    if (pendingCarriageReturn && chunk.byteLength === 0) continue
    if (pendingCarriageReturn) {
      pendingCarriageReturn = false
      if (chunk[0] === LINE_FEED) {
        yield complete()
        start = 1
      } else {
        append(new Uint8Array([CARRIAGE_RETURN]))
      }
    }
    for (let index = 0; index < chunk.byteLength; index += 1) {
      if (index < start) continue
      if (chunk[index] !== LINE_FEED) continue
      const contentEnd = chunk[index - 1] === CARRIAGE_RETURN ? index - 1 : index
      append(chunk.subarray(start, contentEnd))
      yield complete()
      start = index + 1
    }
    const trailing = chunk.subarray(start)
    if (trailing.at(-1) === CARRIAGE_RETURN) {
      append(trailing.subarray(0, trailing.byteLength - 1))
      pendingCarriageReturn = true
    } else {
      append(trailing)
    }
  }
  if (pendingCarriageReturn) append(new Uint8Array([CARRIAGE_RETURN]))
  buffer += decoder.decode()
  if (buffer.trim().length > 0) yield buffer
}
