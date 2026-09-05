<div align="center">

# OpenCode External Provider Connector

**Claude, Cursor, Command Code, Ollama를 위한 OpenCode 플러그인 설정 하나 — 기존 벤더 세션과 로컬 Ollama 데몬을 사용합니다. 새 OAuth 없음.**

<p>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.14-000000?style=for-the-badge" alt="Bun >=1.3.14" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.2-3178C6?style=for-the-badge" alt="TypeScript 6.0.2" />
  <img src="https://img.shields.io/badge/OpenCode-E2E_tested-111111?style=for-the-badge" alt="OpenCode E2E tested" />
  <img src="https://img.shields.io/badge/License-BSD--3--Clause-blue?style=for-the-badge" alt="BSD-3-Clause" />
</p>

[English](../README.md) · **한국어** · [문서](#문서)

[상태](#상태) · [요구 사항](#요구-사항) · [빠른 설치](#빠른-설치) · [설정](#설정) · [최초 연결](#최초-연결) · [프로바이더](#프로바이더) · [문제 해결](#문제-해결) · [문서](#문서) · [테스트](#테스트) · [라이선스 및 면책 조항](#라이선스-및-면책-조항)

</div>

## 상태

> 독립적인 비공식 커뮤니티 플러그인, 버전 **0.2.0**. CI에 설치된 OpenCode CLI를 대상으로 legacy multi-function 로더를 패키지 E2E 테스트로 검증합니다. `@opencode-ai/plugin@1.18.18`은 컴파일 시 사용하는 플러그인 API 대상이며 OpenCode 런타임 버전 고정이 아닙니다. 소스는 BSD-3-Clause입니다. 이 프로젝트는 OpenCode 또는 어떤 프로바이더와도 제휴, 보증, 후원, 승인 관계가 없습니다. 전체 조건은 [라이선스 및 면책 조항](#라이선스-및-면책-조항)에 있습니다.

이미 가지고 있는 Claude, Cursor, Command Code, Ollama 세션을 재사용합니다. `opencode.json` 플러그인 항목 하나가 라이브 카탈로그를 OpenCode에 공개합니다. Claude와 Cursor는 OpenCode에 마커 또는 OAuth 레코드가 있고 벤더 세션이 있을 때까지 연결되지 않은 상태로 유지됩니다. Command Code는 OpenCode에 저장된 직접 API 키 또는 기존 CLI 세션/키를 사용할 수 있습니다. Ollama는 정확한 세션 마커와 응답하는 localhost 데몬이 필요합니다.

## 요구 사항

| 필요 | 상세 |
| --- | --- |
| [Bun](https://bun.sh) | 1.3.14 이상 |
| Node.js | 22 이상, Cursor 직접 생성 전용 |
| OpenCode | legacy multi-function 플러그인 로더를 지원하는 런타임; 패키지 E2E는 CI에 설치된 CLI를 테스트합니다. `@opencode-ai/plugin@1.18.18`은 컴파일 시 사용하는 API 대상입니다. |
| Claude | 기존 Claude Code 자격 증명 (`~/.claude/.credentials.json` 및/또는 macOS Keychain). `claude` 바이너리는 선택 사항입니다. |
| Cursor | 기존 Cursor CLI 로그인 (`~/.config/cursor/auth.json` 또는 `CURSOR_ACCESS_TOKEN`) |
| Command Code | 기존 API 키 (`COMMAND_CODE_API_KEY` 또는 `~/.commandcode/auth.json`). `command-code` 바이너리는 선택 사항입니다. |
| Ollama | `localhost:11434`에서 실행 중인 설치된 로컬 데몬; 그 프로세스를 신뢰할 것; Cloud는 별도로 `ollama signin` 실행 |

OpenCode가 실행되는 곳에 벤더 CLI를 설치할 필요가 없습니다. Claude와 Command Code 요청에는 클라이언트 버전이 포함되는데, 커넥터는 `ANTHROPIC_CLI_VERSION` / `COMMAND_CODE_CLI_VERSION`이 설정되어 있으면 그 값을, 아니면 설치된 `claude` / `command-code` 바이너리를, 그것도 없으면 npm registry에 공개된 최신 버전(`@anthropic-ai/claude-code`, `command-code`)을 사용합니다. 패키지에 고정된 버전은 없습니다.

## 빠른 설치

이 저장소를 빌드한 뒤, 컴파일된 모듈을 OpenCode에 지정합니다:

```bash
bun install
bun run build
```

`opencode.json` / `opencode.jsonc` (공식 `plugin` 필드):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/opencode-ext-connector/dist/index.js"
  ]
}
```

신뢰할 수 있는, 사용자가 소유한 `file://` 빌드의 직접 `dist/index.js` URL을 사용하십시오. 패키지 디렉터리 URL은 이 커넥터의 named legacy auth hook을 로드하지 않습니다.

패키지 항목 하나가 카탈로그 플러그인과 Claude, Cursor, Command Code, Ollama 인증 hook을 노출합니다. 프로바이더 id: `claude`, `cursor`, `command-code`, `ollama`. 모델 id는 각 프로바이더의 라이브 카탈로그에서 가져오며, 라이브 목록이 비어 있으면 문서화된 fallback은 Cursor의 `default`와 Command Code의 `Qwen/Qwen3.8-Max`입니다.

## 설정

OpenCode는 플러그인 옵션을 두 요소 튜플의 두 번째 항목으로 전달합니다.

`providers`를 생략하면 네 프로바이더가 모두 활성화됩니다. 명시적 목록은 엄격한 allow-list입니다. 명시적 `[]`는 모두 비활성화합니다.

| 옵션 | 기본값 | 의미 |
| --- | --- | --- |
| `providers` | 네 프로바이더 모두 | 등록할 프로바이더 id: `claude`, `cursor`, `command-code`, `ollama`; 명시적 `[]`는 모두 비활성화 |
| `writeBackCredentials` | `false` | Claude OAuth 갱신 후 토큰을 Claude 파일, Keychain(macOS), OpenCode `auth.json`에 기록 |
| `credentialRefresh.mode` | `"auto"` | `"auto"`는 만료 전에 Claude 토큰을 갱신; `"never"`는 자격 증명 파일의 내용만 보내고 401 이후 그 파일을 다시 읽음 |
| `credentialRefresh.leadMs` | `60000` | `"auto"`가 만료 얼마 전부터 갱신을 시작할지 |
| `catalogReloadMs` | `300000` | 이 간격으로 카탈로그 스냅샷을 다시 실행; `0`이면 비활성화 |
| `snapshotTimeoutMs` | `30000` | 프로바이더별 스냅샷 기한 |
| `health.initialBackoffMs` | `1000` | 스냅샷 실패 후 health backoff |
| `health.maximumBackoffMs` | `60000` | health backoff 상한 |

writeback은 기본적으로 꺼져 있어, 요청하지 않는 한 이 플러그인은 자격 증명 저장소를 변경하지 않습니다. 명시적으로 켜십시오:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "file:///absolute/path/to/opencode-ext-connector/dist/index.js",
      {
        "writeBackCredentials": true
      }
    ]
  ]
}
```

활성화된 프로바이더는 프로바이더별 인증 규칙이 충족될 때까지 연결되지 않은 상태로 유지됩니다. Claude와 Cursor는 OpenCode 마커 또는 OAuth 레코드와 벤더 세션이 필요하고, Command Code는 OpenCode에 저장된 직접 API 키 또는 기존 CLI 세션/키를 사용할 수 있으며, Ollama는 정확한 세션 마커와 응답하는 localhost 데몬이 필요합니다.

커넥터는 항상 초기 카탈로그 갱신을 한 번 수행합니다. `snapshotTimeoutMs`는 각 프로바이더 스냅샷에 적용되고, `catalogReloadMs: 0`은 주기적 갱신만 비활성화합니다. 주기적 갱신은 fixed-delay이며 single-flight입니다. 다음 지연은 현재 갱신이 끝난 뒤에 시작됩니다. health backoff는 반복 실패를 억제합니다. 일시적 실패는 마지막으로 알려진 카탈로그를 유지하고, 명시적인 unavailable 스냅샷은 커넥터가 소유한 프로바이더 데이터만 제거합니다.

OpenCode는 인스턴스 구성 중에 활성 프로바이더 레지스트리를 만듭니다. 주기적 갱신은 커넥터가 유지하는 카탈로그와 health 상태를 갱신하지만, 새 인증이나 변경된 모델 소속은 정상적인 OpenCode 인스턴스 재생성 후에 표시됩니다. 커넥터는 재생성을 강제하지 않으며 생성된 프로바이더 설정을 기록하지 않습니다. `@opencode-ai/plugin@1.18.18` 패키지는 이 커넥터가 대상으로 하는 플러그인 API이며, OpenCode 런타임 고정이 아닙니다.

writeback이 꺼져 있으면 갱신된 Claude 토큰은 메모리에만 남습니다. 저장된 refresh 토큰이 회전하면 다음 프로세스 시작 때 동작하지 않을 수 있습니다 — 파일까지 갱신하려면 `writeBackCredentials: true`를 설정하십시오.

### 여러 머신에서 하나의 Claude 로그인 공유

Anthropic은 갱신할 때마다 refresh 토큰을 회전시키고 이전 토큰을 무효화합니다. 따라서 `~/.claude/.credentials.json` 사본 두 개가 각자 갱신하면 서로를 깨뜨립니다. 파일 복사는 정확히 한 머신만 갱신하고, 나머지 머신이 자기 사본이 만료되기 전에 그 결과를 받을 때만 동작합니다:

- **소유자** (로그인한 곳): `writeBackCredentials: true`와 사본이 만료되기 전에 파일을 배포할 만큼 충분한 리드 타임, 예: `credentialRefresh: { mode: "auto", leadMs: 1800000 }`.
- **모든 사본**: `credentialRefresh: { mode: "never" }`. 그 머신은 OAuth 엔드포인트에 절대 접속하지 않으며, 요청이 401을 반환하면 파일을 다시 읽고 소유자가 push한 내용으로 한 번 재시도합니다.
- 소유자의 `~/.claude/.credentials.json`이 바뀔 때마다 각 사본으로 push하십시오(파일 watcher면 충분합니다). OpenCode 자체 `auth.json`은 `anthropic` 레코드만 한 번 있으면 되며, 다른 프로바이더 레코드는 건드리지 마십시오.

대화형으로 사용하는 Claude Code 설치처럼 스스로 갱신하는 머신은 파일을 공유하면 안 됩니다. 그곳에서는 별도로 로그인하십시오.

## 최초 연결

1. 플러그인 URL을 추가한 뒤 **OpenCode를 완전히 재시작**하십시오. 프로세스를 종료한 다음 다시 시작해야 named legacy auth hook이 로드됩니다. 리로드나 주기적 카탈로그 갱신은 인스턴스 재생성이 아닙니다.
2. 활성화한 프로바이더의 **로컬 전제 조건을 확인**하십시오. Claude와 Cursor는 벤더 세션이 필요합니다. Command Code는 OpenCode에 저장할 API 키 또는 기존 CLI 세션/키가 필요합니다. Ollama는 `http://localhost:11434`에서 신뢰하는 프로세스가 필요하며, Cloud는 별도로 `ollama signin`이 여전히 필요합니다.
3. 원하는 각 프로바이더에 대해 **`/connect`를 실행**하십시오. Claude와 Cursor는 벤더 세션이 사용 가능할 때만 마커 또는 OAuth 항목을 기록합니다. Command Code는 OpenCode에 직접 API 키를 저장하거나 기존 CLI 세션/키를 재사용할 수 있습니다. Ollama는 localhost 데몬이 응답할 때만 정확한 세션 마커를 저장합니다. 모델은 그 프로바이더별 규칙이 충족된 뒤에만 공개됩니다.
4. **카탈로그를 확인**하십시오. Claude, Cursor, Command Code 모델이 OpenCode에 나타나는지 확인합니다. Ollama는 `opencode models ollama`를 실행하여 로컬로 pull된 모델과, 커넥터가 자격 증명을 제공하지 않은 채 비인증으로 발견된 Cloud 태그를 확인하십시오.

Ollama `/connect`는 로컬 데몬을 조사하고 정확한 세션 마커를 저장합니다. `ollama signin`을 실행하거나 Ollama 자격 증명을 다루지 않습니다.

## 프로바이더

| 프로바이더 | 하는 일 |
| --- | --- |
| **Claude** | 기존 Claude Code 자격 증명을 재사용합니다. OAuth를 발급하지 않습니다. 호환 fetch가 CLI 호환 요청 메타데이터를 보내고, 내장 `anthropic` 경로에서 Anthropic SSE를 스트림합니다. `writeBackCredentials` 기본값은 `false`(메모리 내 갱신만); `true`는 갱신된 토큰을 Claude 파일, macOS Keychain, OpenCode `auth.json`에 기록합니다. |
| **Cursor** | CLI 액세스 토큰으로 Cursor의 미공개 클라이언트 프로토콜(`api2.cursor.sh` `AgentService`, HTTP/2 위의 Connect+protobuf)을 호출합니다. 플러그인이 소유한 Node 자식 프로세스가 private stdio로 통신하고, 툴 결과를 같은 bidi Run에 유지하며, parked call을 절대 재실행하지 않고, 사용자 대면 데몬을 열지 않으며, 생성에 `cursor-agent`를 절대 spawn하지 않습니다. 비공식이며 공개 Cursor API가 아닙니다. 프로토콜이 어긋난 뒤에는 암시적 fallback이 없습니다 — 해당 프로바이더가 실패합니다. Node.js 22 이상이 필요합니다. 라이브 카탈로그 id가 있으면 그것을 쓰고, 없으면 문서화된 fallback은 `default`입니다. |
| **Command Code** | CLI 호환 요청 메타데이터와 함께 `/alpha/generate`를 호출하고, 프로바이더 로컬 NDJSON 텍스트와 툴 이벤트를 스트림합니다. 클라이언트 버전은 `COMMAND_CODE_CLI_VERSION`, 설치된 `command-code` 바이너리, 또는 npm registry에서 가져옵니다. 요청 메타데이터에는 Node.js 버전, 플랫폼, 아키텍처, 절대 작업 디렉터리가 포함됩니다. 라이브 카탈로그 id가 있으면 그것을 쓰고, 없으면 문서화된 fallback은 `Qwen/Qwen3.8-Max`입니다. |
| **Ollama** | `http://localhost:11434`의 로컬 데몬만 사용하며, 고정된 `/api/tags`, `/api/pull`, `/api/chat`을 씁니다. 그 포트에 바인딩된 프로세스를 신뢰하십시오. 이미 로컬에 pull된 모델과, 커넥터가 자격 증명을 제공하지 않은 채 Ollama 공식 Cloud 검색 및 library 페이지에서 비인증으로 발견한 정확한 Cloud 태그를 공개합니다. 정확히 중복되는 항목은 로컬이 이깁니다. 불완전한 Cloud 갱신은 마지막 완전한 목록을 유지합니다. 없는 인가된 Cloud 태그를 선택하면 최초 사용 시 lightweight remote reference를 pull합니다. 같은 태그의 동시 pull은 하나의 in-flight 요청을 공유하고, 실패한 pull은 나중에 재시도할 수 있습니다. 로컬 데몬은 이후 사용자의 Ollama Cloud 구독으로 Cloud 태그 프롬프트를 proxy할 수 있습니다. 커넥터는 Ollama API 키, 사용량 과금 direct Cloud API, `OLLAMA_HOST`, 원격 Cloud 생성 endpoint를 절대 사용하지 않습니다. |

프로바이더 health는 격리됩니다. 한 프로바이더가 실패해도 나머지는 제거되지 않습니다.

독립 SDK entry는 `opencode-ext-connector/ollama`입니다. 로컬 데몬에 이미 있는 모델로 생성할 수 있으며, 커넥터가 관리하는 Cloud 자동 pull은 활성 Ollama 카탈로그 lease가 필요합니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `/connect` 메서드가 없음 | 플러그인 URL은 신뢰할 수 있는, 사용자가 소유한 `file:///absolute/path/to/opencode-ext-connector/dist/index.js`여야 합니다. 패키지 디렉터리 URL은 named legacy auth hook을 로드하지 않습니다. 변경한 뒤 OpenCode를 완전히 재시작하십시오. |
| 프로바이더가 활성화됐지만 모델이 없음 | `providers`를 생략하면 네 프로바이더가 모두 활성화됩니다. 명시적 목록은 엄격한 allow-list입니다. Claude와 Cursor는 마커 또는 OAuth 레코드와 벤더 세션이 필요하고, Command Code는 OpenCode에 저장된 API 키 또는 CLI 세션/키를 사용할 수 있으며, Ollama는 정확한 마커와 응답하는 localhost 데몬이 필요합니다. `/connect` 후 완전히 재시작해야 인스턴스 재생성이 새 소속을 반영합니다. |
| Claude가 다음 시작 전까지만 동작함 | 기본 `writeBackCredentials: false`는 갱신된 토큰을 메모리에만 둡니다. 회전된 refresh 토큰은 writeback을 켜지 않으면 다음 프로세스 시작에서 실패합니다. |
| 복사한 자격 증명 파일에서 Claude가 `invalid_grant`를 보고함 | 같은 로그인의 다른 사본이 이미 갱신해서 refresh 토큰이 회전됐습니다. 한 머신에만 갱신 소유권을 주고 나머지에는 `credentialRefresh: { mode: "never" }`를 설정하거나, 별도로 로그인하십시오. |
| `Claude Code client version is unavailable` | `ANTHROPIC_CLI_VERSION`도, `claude` 바이너리도 없고 `registry.npmjs.org`에 접근할 수 없었습니다. 변수를 설정하거나 registry 접근을 허용하십시오. |
| Cursor 생성이 실패함 | Node.js 22 이상이 필요합니다. 생성은 `cursor-agent`가 아니라 private Node 자식 프로세스를 통한 미공개 프로토콜을 사용합니다. 프로토콜이 어긋나면 해당 프로바이더가 실패하며, 암시적 fallback은 없습니다. |
| Command Code 생성이 실패함 | 클라이언트 버전을 확인할 수 없었습니다: `COMMAND_CODE_CLI_VERSION`을 설정하거나, `command-code`를 설치하거나, `registry.npmjs.org` 접근을 허용하십시오. 요청 메타데이터에는 Node.js 버전, 플랫폼, 아키텍처, 절대 작업 디렉터리가 포함됩니다. |
| `opencode models ollama`에 Ollama가 없음 | `localhost:11434`에서 신뢰하는 프로세스를 시작한 뒤 `/connect`하여 정확한 세션 마커를 저장할 수 있게 하십시오. Cloud 태그는 커넥터가 자격 증명을 제공하지 않은 비인증 카탈로그 항목이며, 로컬 데몬이 Cloud 태그 프롬프트를 proxy할 수 있습니다. `OLLAMA_HOST`, API 키, direct Cloud 생성은 사용하지 않습니다. |
| 한 프로바이더가 다운됨 | 실패는 격리됩니다. 일시적 스냅샷 실패는 마지막으로 알려진 카탈로그를 유지하고, unavailable 스냅샷은 해당 커넥터 소유 프로바이더만 제거합니다. |

## 문서

| 문서 | 내용 |
| --- | --- |
| [../README.md](../README.md) | 영어 README |
| [../CHANGELOG.md](../CHANGELOG.md) | 릴리스 노트 |
| [../LICENSE](../LICENSE) | BSD 3-Clause 라이선스 |
| [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | 파생 업스트림 작업 |

## 테스트

```bash
bun run check
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
bun run verify:package
```

E2E 스위트는 임시 HOME/XDG 디렉터리 아래에서 실제 격리된 `opencode serve` 프로세스를 실행합니다. 호스트 자격 증명, proxy/token 변수를 상속하거나 외부 벤더 endpoint에 접근해서는 안 됩니다.

## 라이선스 및 면책 조항

BSD-3-Clause. [LICENSE](../LICENSE)를 참조하십시오. 파생 업스트림 작업은 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 있습니다.

이 프로젝트는 독립적이고 비공식적인 커뮤니티 프로젝트입니다. OpenCode 또는 제3자 서비스 제공자와 제휴, 보증, 후원, 승인 관계가 없습니다.

모든 제품명, 상표, 등록상표는 각 소유자의 재산입니다. 본 프로젝트에서 이러한 명칭을 사용하는 것은 식별과 상호운용성을 위해서이며, 어떠한 제휴 또는 보증 관계를 암시하지 않습니다.

이 프로젝트의 라이선스는 본 저장소에 배포된 소스 코드에만 적용됩니다. 이 라이선스는 제3자 서비스에 대한 접근, 사용, 수정, 자동화, 또는 제한 사항 우회 권한을 부여하지 않습니다.

이 프로젝트는 접근 통제, 사용 제한, 인증 요건, 또는 서비스 약관을 무력화할 것을 조장하지 않습니다. 사용자는 자신의 사용이 허용되는지 여부를 스스로 판단하고, 관련 법률, 계약, 정책, 제공자 약관을 준수할 책임이 전적으로 있습니다.

제3자 제공자는 언제든지 인터페이스, 인증 방식, 계정, 또는 서비스를 변경, 제한, 중단, 또는 종료할 수 있습니다. 본 소프트웨어를 사용하면 서비스 중단, 계정 제한 또는 해지, 데이터 손실, 예상치 못한 요금 발생, 또는 자격 증명 노출 등의 결과가 발생할 수 있습니다.

본 소프트웨어는 "있는 그대로" 제공되며, 어떠한 형태의 보증도 하지 않습니다. 관련 법률이 허용하는 최대 범위 내에서, 저작자 및 기여자는 본 소프트웨어의 사용 또는 사용 불능으로 인해 발생하는 어떠한 청구, 손해, 손실, 계정 조치, 또는 기타 결과에 대해서도 책임지지 않습니다. 본 소프트웨어는 전적으로 사용자의 책임 하에 사용하십시오.

[LICENSE](../LICENSE)의 BSD 3-Clause 라이선스가 본 소프트웨어의 복사, 수정, 배포를 규율합니다. 본 면책 조항이 라이선스와 충돌하는 경우, 라이선스가 우선합니다.
