# OpenCode 외부 제공자 커넥터

[English](../README.md)

이미 로그인한 벤더 CLI의 **Claude**, **Cursor**, **Command Code**를 OpenCode에
노출하는 독립 플러그인입니다. `opencode.json`에 항목 하나. 새 OAuth를 만들지
않습니다.

## 면책 조항

이 프로젝트는 독립적이고 비공식적인 커뮤니티 프로젝트입니다. OpenCode 또는 제3자 서비스 제공자와 제휴, 보증, 후원, 승인 관계가 없습니다.

모든 제품명, 상표, 등록상표는 각 소유자의 재산입니다. 본 프로젝트에서 이러한 명칭을 사용하는 것은 식별과 상호운용성을 위해서이며, 어떠한 제휴 또는 보증 관계를 암시하지 않습니다.

이 프로젝트의 라이선스는 본 저장소에 배포된 소스 코드에만 적용됩니다. 이 라이선스는 제3자 서비스에 대한 접근, 사용, 수정, 자동화, 또는 제한 사항 우회 권한을 부여하지 않습니다.

이 프로젝트는 접근 통제, 사용 제한, 인증 요건, 또는 서비스 약관을 무력화할 것을 조장하지 않습니다. 사용자는 자신의 사용이 허용되는지 여부를 스스로 판단하고, 관련 법률, 계약, 정책, 제공자 약관을 준수할 책임이 전적으로 있습니다.

제3자 제공자는 언제든지 인터페이스, 인증 방식, 계정, 또는 서비스를 변경, 제한, 중단, 또는 종료할 수 있습니다. 본 소프트웨어를 사용하면 서비스 중단, 계정 제한 또는 해지, 데이터 손실, 예상치 못한 요금 발생, 또는 자격 증명 노출 등의 결과가 발생할 수 있습니다.

본 소프트웨어는 "있는 그대로" 제공되며, 어떠한 형태의 보증도 하지 않습니다. 관련 법률이 허용하는 최대 범위 내에서, 저작자 및 기여자는 본 소프트웨어의 사용 또는 사용 불능으로 인해 발생하는 어떠한 청구, 손해, 손실, 계정 조치, 또는 기타 결과에 대해서도 책임지지 않습니다. 본 소프트웨어는 전적으로 사용자의 책임 하에 사용하십시오.

[LICENSE](../LICENSE)의 BSD 3-Clause 라이선스가 본 소프트웨어의 복사, 수정, 배포를 규율합니다. 본 면책 조항이 라이선스와 충돌하는 경우, 라이선스가 우선합니다.

## 요구 사항

- [Bun](https://bun.sh) 1.3.14 이상
- OpenCode 플러그인 v2/promise (`@opencode-ai/plugin@1.18.18`)
- 이미 로그인된 벤더 CLI:
  - Claude Code 자격 증명 (`~/.claude/.credentials.json` 및/또는 macOS Keychain)
  - `PATH`의 `cursor-agent`
  - Command Code API 키 (`COMMAND_CODE_API_KEY` 또는 `~/.commandcode/auth.json`)

## 설치

```bash
bun install
bun run build
```

`opencode.json` / `opencode.jsonc` (OpenCode v2 필드 `plugins`):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///absolute/path/to/00G_opencode-ext-connector"
  ]
}
```

구버전 호스트는 `"plugin"`을 쓸 수 있습니다. 절대 경로와 `file://` URL을
지원합니다.

프로바이더 id: `claude`, `cursor`, `command-code`. 모델 id는 라이브 카탈로그에서
가져옵니다.

## 옵션

OpenCode는 객체 항목의 `options`를 `ctx.options`로 그대로 넘깁니다.

| 옵션 | 기본값 | 의미 |
|---|---|---|
| `writeBackCredentials` | `true` | Claude OAuth 갱신 후 파일, Keychain(macOS), OpenCode `auth.json`에 기록 |
| `catalogReloadMs` | `300000` | 카탈로그 스냅샷 주기. `0`이면 끔 |
| `snapshotTimeoutMs` | `30000` | 프로바이더별 스냅샷 기한 |
| `health.initialBackoffMs` | `1000` | 스냅샷 실패 백오프 |
| `health.maximumBackoffMs` | `60000` | 백오프 상한 |

writeback 끄기:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///absolute/path/to/00G_opencode-ext-connector",
      "options": { "writeBackCredentials": false }
    }
  ]
}
```

## 동작

- 기존 CLI 로그인을 재사용합니다. 새 OAuth를 발급하지 않습니다.
- Claude HTTP를 공식 CLI처럼 위장하고 Anthropic SSE를 스트림합니다.
- `cursor-agent --print --output-format stream-json` 프로세스 풀, tool-call
  파트, `--resume`을 사용합니다.
- Command Code `/alpha/generate`에 CLI 지문 헤더를 붙이고 NDJSON 텍스트/툴
  이벤트를 스트림합니다.
- 한 프로바이더가 실패해도 나머지 카탈로그는 유지합니다.

## 개발

```bash
bun run check
bun test
bun run verify:package
```

## 고지

파생 업스트림은 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 있습니다.

## 라이선스

BSD-3-Clause. [LICENSE](../LICENSE)를 참조하십시오.
