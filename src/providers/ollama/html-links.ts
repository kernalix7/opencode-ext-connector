import { z } from "zod"

const HtmlSchema = z.string().max(256 * 1024)
const HrefSchema = z.string().min(1).max(2048)
const ANCHOR_HREF = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/giu

export function extractOfficialLibraryPaths(html: string): readonly string[] {
  const source = HtmlSchema.parse(html)
  const paths: string[] = []
  for (const match of source.matchAll(ANCHOR_HREF)) {
    const href = HrefSchema.safeParse(match[1] ?? match[2] ?? match[3])
    if (!href.success) continue
    let url: URL
    try {
      url = new URL(href.data, "https://ollama.com")
    } catch (error) {
      if (error instanceof TypeError) continue
      throw error
    }
    if (
      url.origin === "https://ollama.com" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    ) {
      paths.push(url.pathname)
    }
  }
  return paths
}
