import { expect, it } from "bun:test"

it("requires paired v0.3.3 release records", async () => {
  // Given
  const releaseDocuments = [
    new URL("../../../docs/releases/v0.3.3.md", import.meta.url),
    new URL("../../../docs/releases/v0.3.3.ko.md", import.meta.url),
  ]

  // When
  const documentPresence = await Promise.all(
    releaseDocuments.map((documentUrl) => Bun.file(documentUrl).exists()),
  )

  // Then
  expect(documentPresence).toEqual([true, true])
})

it("records exact v0.3.3 publication evidence in both languages", async () => {
  // Given
  const releaseDocuments = [
    new URL("../../../docs/releases/v0.3.3.md", import.meta.url),
    new URL("../../../docs/releases/v0.3.3.ko.md", import.meta.url),
  ]
  const requiredTokens = [
    "0.3.3",
    "edf38582784dbc809c4126b42eb9238f65603710",
    "sha512-RPOVS8NxJBFhNrWwvfoQDeP0ntUvXw7mwV1aWxN5CI287n0j6EKWki54khBXWW8xxHY69f5AsuheiYSiuwmw3Q==",
    "db7bdb9369c2db8b972fde4b006b6526bb2398e5",
    "75b16f744167dadde8e6f3952421c962ecc27b1f",
    "34026270904",
    "34022281701",
    "invalid=[]",
    "missing=[]",
    "628/628",
    "3/3",
    "631/631",
    `npm publish "./\${{ steps.artifact.outputs.tarball }}" --provenance --access public`,
    "https://github.com/kernalix7/opencode-ext-connector/pull/6",
    "https://github.com/kernalix7/opencode-ext-connector/pull/7",
    "https://opencode.ai/docs/plugins/",
    "https://opencode.ai/v2/docs/plugins/",
    "https://opencode.ai/v2/docs/migrate-v1/#plugins",
    '"plugin": ["opencode-ext-connector@0.3.3"]',
  ]

  // When
  const releaseContents = await Promise.all(
    releaseDocuments.map((documentUrl) => Bun.file(documentUrl).text()),
  )

  // Then
  for (const [index, content] of releaseContents.entries()) {
    for (const token of requiredTokens) {
      expect(content).toContain(token)
    }
    expect(content).toContain(
      index === 0 ? "V2 compatibility: not supported" : "V2 호환성: 지원하지 않음",
    )
  }
})

it("binds v0.3.3 publication evidence to its documented roles", async () => {
  // Given
  const releaseRecords = [
    {
      documentUrl: new URL("../../../docs/releases/v0.3.3.md", import.meta.url),
      roleTokens: [
        "Package `gitHead` | `edf38582784dbc809c4126b42eb9238f65603710`",
        "attestation source commit `75b16f744167dadde8e6f3952421c962ecc27b1f`",
        "[run 34026270904, attempt 1]",
        "[first failed run 34022281701]",
        "recovery was tracked in [PR #6]",
        "workflow cleanup was tracked in [PR #7]",
        "V2 uses plural `plugins`",
      ],
    },
    {
      documentUrl: new URL("../../../docs/releases/v0.3.3.ko.md", import.meta.url),
      roleTokens: [
        "패키지 `gitHead` | `edf38582784dbc809c4126b42eb9238f65603710`",
        "증명 소스 커밋 `75b16f744167dadde8e6f3952421c962ecc27b1f`",
        "[run 34026270904, attempt 1]",
        "[첫 실패 실행 34022281701]",
        "복구는 [PR #6]",
        "워크플로 정리는 [PR #7]",
        "V2는 복수형 `plugins`",
      ],
    },
  ]

  // When
  const recordsWithContent = await Promise.all(
    releaseRecords.map(async (record) => ({
      ...record,
      content: await Bun.file(record.documentUrl).text(),
    })),
  )

  // Then
  for (const { content, roleTokens } of recordsWithContent) {
    for (const roleToken of roleTokens) {
      expect(content).toContain(roleToken)
    }
  }
})

it("keeps repository-only release records reachable from packaged docs", async () => {
  // Given
  const packagedDocuments = [
    new URL("../../../README.md", import.meta.url),
    new URL("../../../docs/README.ko.md", import.meta.url),
    new URL("../../../CHANGELOG.md", import.meta.url),
  ]
  const releaseRecordLinks = [
    "https://github.com/kernalix7/opencode-ext-connector/blob/main/docs/releases/v0.3.3.md",
    "https://github.com/kernalix7/opencode-ext-connector/blob/main/docs/releases/v0.3.3.ko.md",
  ]

  // When
  const packagedContents = await Promise.all(
    packagedDocuments.map((documentUrl) => Bun.file(documentUrl).text()),
  )

  // Then
  for (const content of packagedContents) {
    for (const releaseRecordLink of releaseRecordLinks) {
      expect(content).toContain(releaseRecordLink)
    }
  }
})
