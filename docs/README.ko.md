<div align="center">

# OpenCode External Provider Connector

**Claude, Cursor, Command Code, Ollama를 위한 OpenCode 플러그인 설정 하나 — 기존 벤더 세션과 신뢰하는 Ollama 데몬을 사용합니다. 새 OAuth 없음.**

<p>
  <img src="https://img.shields.io/badge/Bun-%3E%3D1.3.14-000000?style=for-the-badge" alt="Bun >=1.3.14" />
  <img src="https://img.shields.io/badge/TypeScript-6.0.2-3178C6?style=for-the-badge" alt="TypeScript 6.0.2" />
  <img src="https://img.shields.io/badge/OpenCode-E2E_tested-111111?style=for-the-badge" alt="OpenCode E2E tested" />
  <img src="https://img.shields.io/badge/License-BSD--3--Clause-blue?style=for-the-badge" alt="BSD-3-Clause" />
</p>

[English](../README.md) · **한국어** · [문서](#문서)

[상태](#상태) · [요구 사항](#요구-사항) · [빠른 설치](#빠른-설치) · [설정](#설정) · [호스트/게스트 샌드박스 설정](#호스트게스트-샌드박스-설정) · [업데이트 및 제거](#업데이트-및-제거) · [최초 연결](#최초-연결) · [프로바이더](#프로바이더) · [문제 해결](#문제-해결) · [문서](#문서) · [테스트](#테스트) · [라이선스 및 면책 조항](#라이선스-및-면책-조항)

</div>

## 상태

> 독립적인 비공식 커뮤니티 플러그인, 버전 **0.4.0**. CI에 설치된 OpenCode CLI를 대상으로 legacy multi-function 로더를 패키지 E2E 테스트로 검증합니다. `@opencode-ai/plugin@1.18.18`은 컴파일 시 사용하는 플러그인 API 대상이며 OpenCode 런타임 버전 고정이 아닙니다. 소스는 BSD-3-Clause입니다. 이 프로젝트는 OpenCode 또는 어떤 프로바이더와도 제휴, 보증, 후원, 승인 관계가 없습니다. 전체 조건은 [라이선스 및 면책 조항](#라이선스-및-면책-조항)에 있습니다.

이미 가지고 있는 Claude, Cursor, Command Code, Ollama 세션을 재사용합니다. `opencode.json` 플러그인 항목 하나가 라이브 카탈로그를 OpenCode에 공개합니다. Claude와 Cursor는 OpenCode에 마커 또는 OAuth 레코드가 있고 벤더 세션이 있을 때까지 연결되지 않은 상태로 유지됩니다. Command Code는 OpenCode에 저장된 직접 API 키 또는 기존 CLI 세션/키를 사용할 수 있습니다. Ollama는 정확한 세션 마커와 응답하는 신뢰된 데몬이 필요합니다.

## 요구 사항

| 필요 | 상세 |
| --- | --- |
| [Bun](https://bun.sh) | 1.3.14 이상 |
| Node.js | 22 이상, Cursor 직접 생성 전용 |
| OpenCode | legacy multi-function 플러그인 로더를 지원하는 런타임; 패키지 E2E는 CI에 설치된 CLI를 테스트합니다. `@opencode-ai/plugin@1.18.18`은 컴파일 시 사용하는 API 대상입니다. |
| Claude | 기존 Claude Code 자격 증명 (`~/.claude/.credentials.json` 및/또는 macOS Keychain). `claude` 바이너리는 선택 사항입니다. |
| Cursor | 기존 Cursor CLI 로그인 (`~/.config/cursor/auth.json` 또는 `CURSOR_ACCESS_TOKEN`) |
| Command Code | 기존 API 키 (`COMMAND_CODE_API_KEY` 또는 `~/.commandcode/auth.json`). `command-code` 바이너리는 선택 사항입니다. |
| Ollama | 신뢰하는 데몬; 기본값은 `http://localhost:11434`이며 명시적인 원격/self-hosted URL도 지원; Cloud는 별도로 `ollama signin` 실행 |

OpenCode가 실행되는 곳에 벤더 CLI를 설치할 필요가 없습니다. Claude와 Command Code 요청에는 클라이언트 버전이 포함되는데, 커넥터는 `ANTHROPIC_CLI_VERSION` / `COMMAND_CODE_CLI_VERSION`이 설정되어 있으면 그 값을, 아니면 설치된 `claude` / `command-code` 바이너리를, 그것도 없으면 npm registry에 공개된 최신 버전(`@anthropic-ai/claude-code`, `command-code`)을 사용합니다. 패키지에 고정된 버전은 없습니다.

## 빠른 설치

전역 `~/.config/opencode/opencode.json` 또는 프로젝트 수준 `opencode.json` 중 하나를 선택한 뒤, 공식 단수 `plugin` 필드에 패키지를 추가하십시오:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-ext-connector"
  ]
}
```

OpenCode는 시작 시 Bun으로 설정된 npm 플러그인을 설치하고 캐시합니다. 재현 가능한 설치가 필요하면 정확한 공개 버전을 대신 사용하십시오:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ext-connector@0.4.0"]
}
```

항목을 추가하거나 변경한 뒤 OpenCode를 완전히 종료하고 다시 시작하십시오. 리로드만으로는 충분하지 않습니다.

패키지 항목 하나가 카탈로그 플러그인과 Claude, Cursor, Command Code, Ollama 인증 hook을 노출합니다. 프로바이더 id: `claude`, `cursor`, `command-code`, `ollama`. 모델 id는 각 프로바이더의 라이브 카탈로그에서 가져오며, 라이브 목록이 비어 있으면 문서화된 fallback은 Cursor의 `default`와 Command Code의 `Qwen/Qwen3.8-Max`입니다.

## 설정

OpenCode는 플러그인 옵션을 두 요소 튜플의 두 번째 항목으로 전달합니다. 첫 번째 항목에는 npm 패키지 이름을 사용하십시오.

`providers`를 생략하면 네 프로바이더가 모두 활성화됩니다. 명시적 목록은 엄격한 allow-list입니다. 명시적 `[]`는 모두 비활성화합니다.

| 옵션 | 기본값 | 의미 |
| --- | --- | --- |
| `providers` | 네 프로바이더 모두 | 등록할 프로바이더 id: `claude`, `cursor`, `command-code`, `ollama`; 명시적 `[]`는 모두 비활성화 |
| `ollamaBaseURL` | `"http://localhost:11434"` | 신뢰하는 Ollama 데몬의 절대 `http` 또는 `https` base; 경로 prefix를 보존 |
| `credentialManagement` | 생략 | 권장 권한 정책: `"connector"`는 어댑터가 갱신과 writeback을 모두 지원할 때 이를 허용하고, `"external"`은 커넥터의 갱신과 writeback을 금지 |
| `writeBackCredentials` | `false` | **사용 중단 예정:** 한 번의 마이그레이션 주기 동안 단독 사용 시 허용되며, 갱신 후 Claude writeback을 제어 |
| `credentialRefresh.mode` | `"auto"` | **사용 중단 예정:** 한 번의 마이그레이션 주기 동안 단독 사용 시 허용되며, Claude의 `"auto"` 또는 `"never"` 갱신 동작을 제어 |
| `credentialRefresh.leadMs` | `60000` | **사용 중단 예정:** 한 번의 마이그레이션 주기 동안 단독 사용 시 허용되며, 사용자 지정 리드 타임에는 여전히 이 레거시 설정이 필요 |
| `catalogReloadMs` | `300000` | 이 간격으로 카탈로그 스냅샷을 다시 실행; `0`이면 비활성화 |
| `snapshotTimeoutMs` | `30000` | 프로바이더별 스냅샷 기한 |
| `health.initialBackoffMs` | `1000` | 스냅샷 실패 후 health backoff |
| `health.maximumBackoffMs` | `60000` | health backoff 상한 |

`credentialManagement: "connector"`는 프로바이더 어댑터가 갱신과 writeback을 모두 지원하는 경우 커넥터에 그 권한을 부여합니다. 현재 이 기능을 지원하는 것은 Claude뿐이며, 만료 `60_000`ms 전 자동 갱신과 writeback 활성화로 매핑됩니다:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector",
      {
        "credentialManagement": "connector"
      }
    ]
  ]
}
```

다른 프로세스가 자격 증명을 관리한다면 외부 권한을 사용하십시오:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector",
      {
        "credentialManagement": "external"
      }
    ]
  ]
}
```

`credentialManagement: "external"`은 커넥터의 갱신과 writeback을 금지합니다. 현재 Claude에서는 갱신 안 함/writeback 안 함으로 매핑되며, 401 이후 외부에서 관리되는 자격 증명을 다시 읽을 수 있습니다. 모든 자격 증명 정책 옵션을 생략하면 Claude는 레거시 기본 동작을 유지합니다. 즉, `60_000`ms 리드 타임으로 자동 갱신하지만 writeback하지 않습니다. `credentialManagement`만 생략한 경우에는 제공된 사용 중단 예정 `credentialRefresh` 또는 `writeBackCredentials` 옵션이 계속 동작을 제어합니다. 두 모드 모두 Cursor direct 생성과 Command Code는 읽기 전용입니다. 정확한 HTTP 401이 출력이나 효과 전에 발생하면 null이 아니며 변경된 자격 증명을 다시 읽고 한 번만 재시도합니다. 이 안전한 다시 읽기는 갱신이나 writeback이 아니므로 두 모드에서 모두 허용되며, Cursor legacy/compatibility 생성은 한 번만 시도합니다. Ollama에는 영향이 없습니다. 이 옵션은 로그인하거나 OAuth를 발급하지 않고, 머신 간 동기화를 수행하지 않으며, 자격 증명이 파일에 저장된다는 의미도 아닙니다.

한 번의 마이그레이션 주기 동안 `writeBackCredentials`와 `credentialRefresh.*`는 `credentialManagement` 없이 사용할 때 계속 허용됩니다. 사용자 지정 `credentialRefresh.leadMs` 값에는 여전히 레거시 설정이 필요합니다. 새 옵션을 레거시 옵션 중 하나와 함께 사용하면 다음 정확한 메시지와 함께 거부됩니다: `` `credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials` ``.

활성화된 프로바이더는 프로바이더별 인증 규칙이 충족될 때까지 연결되지 않은 상태로 유지됩니다. Claude와 Cursor는 OpenCode 마커 또는 OAuth 레코드와 벤더 세션이 필요하고, Command Code는 OpenCode에 저장된 직접 API 키 또는 기존 CLI 세션/키를 사용할 수 있으며, Ollama는 정확한 세션 마커와 응답하는 설정된 데몬이 필요합니다.

명시적으로 선택한 원격 또는 self-hosted 데몬을 사용하려면 패키지 항목에 같은 flat 옵션을 설정하십시오:

```jsonc
{
  "plugin": [["opencode-ext-connector", { "ollamaBaseURL": "https://ollama.example.test/team" }]]
}
```

커넥터는 이 base에 `/api/tags`, `/api/pull`, `/api/chat`을 붙입니다. 자격 증명, query, fragment, 직접 API route base, `ollama.com` host를 거부합니다. `OLLAMA_HOST`를 읽지 않고 cookie나 authorization header를 보내지 않으며 redirect를 따르지 않고 custom CA나 TLS 검증 우회를 지원하지 않습니다. Ollama 데몬에는 내장 인증이 없으므로 신뢰하는 데몬과 네트워크 경로만 사용하고, HTTPS 종료와 접근 정책은 커넥터 외부에서 적용하십시오. 정규화된 base가 다르면 catalog lease와 pull flight가 격리되고, 같은 base는 프로세스 내 상태를 공유합니다.

커넥터는 항상 초기 카탈로그 갱신을 한 번 수행합니다. `snapshotTimeoutMs`는 각 프로바이더 스냅샷에 적용되고, `catalogReloadMs: 0`은 주기적 갱신만 비활성화합니다. 주기적 갱신은 fixed-delay이며 single-flight입니다. 다음 지연은 현재 갱신이 끝난 뒤에 시작됩니다. health backoff는 반복 실패를 억제합니다. 일시적 실패는 마지막으로 알려진 카탈로그를 유지하고, 명시적인 unavailable 스냅샷은 커넥터가 소유한 프로바이더 데이터만 제거합니다.

OpenCode는 인스턴스 구성 중에 활성 프로바이더 레지스트리를 만듭니다. 주기적 갱신은 커넥터가 유지하는 카탈로그와 health 상태를 갱신하지만, 새 인증이나 변경된 모델 소속은 정상적인 OpenCode 인스턴스 재생성 후에 표시됩니다. 커넥터는 재생성을 강제하지 않으며 생성된 프로바이더 설정을 기록하지 않습니다. `@opencode-ai/plugin@1.18.18` 패키지는 이 커넥터가 대상으로 하는 플러그인 API이며, OpenCode 런타임 고정이 아닙니다.

모든 자격 증명 정책 옵션을 생략하면 갱신된 Claude 토큰은 메모리에만 남습니다. 저장된 refresh 토큰이 회전하면 다음 프로세스 시작 때 동작하지 않을 수 있습니다. 커넥터가 갱신 내용을 기록할 권한을 가져야 한다면 `credentialManagement: "connector"`를 선택하십시오. `credentialManagement`만 생략한 경우에는 제공된 사용 중단 예정 옵션이 갱신과 writeback을 계속 제어합니다.

### 여러 머신에서 하나의 Claude 로그인 공유

Anthropic은 갱신할 때마다 refresh 토큰을 회전시키고 이전 토큰을 무효화합니다. 따라서 `~/.claude/.credentials.json` 사본 두 개가 각자 갱신하면 서로를 깨뜨립니다. 파일 복사는 정확히 한 머신만 갱신하고, 나머지 머신이 자기 사본이 만료되기 전에 그 결과를 받을 때만 동작합니다:

- **갱신 권한 머신** (로그인한 곳): `credentialManagement: "connector"`. 사용자 지정 배포 여유 시간이 필요하면 이번 마이그레이션 주기에는 사용 중단 예정인 레거시 옵션만 사용하십시오. 예: `writeBackCredentials: true`와 `credentialRefresh: { mode: "auto", leadMs: 1800000 }`.
- **외부 권한 머신**: `credentialManagement: "external"`. OAuth 엔드포인트에 접속하지 않으며, 요청이 401을 반환하면 외부에서 관리되는 자격 증명을 다시 읽고 한 번 재시도합니다.
- 갱신 권한 머신의 외부 관리 자격 증명 자료가 바뀔 때마다 동기화하십시오. 이 옵션 자체는 머신을 동기화하거나 파일 저장을 요구하지 않습니다. `~/.claude/.credentials.json`을 복사하는 경우 OpenCode 자체 `auth.json`에는 `anthropic` 레코드만 한 번 있으면 되며 다른 프로바이더는 건드리지 마십시오.

대화형으로 사용하는 Claude Code 설치처럼 스스로 갱신하는 머신은 파일을 공유하면 안 됩니다. 그곳에서는 별도로 로그인하십시오.

## 호스트/게스트 샌드박스 설정

OpenCode가 컨테이너, VM 또는 다른 샌드박스에서 실행될 때 그 런타임을 **게스트**, 벤더 로그인과 Ollama 데몬을 소유한 머신을 **호스트**로 봅니다. 게스트에는 자체 `localhost`, 홈 디렉터리, 환경, keychain, 파일 권한, 네트워크 namespace가 있습니다. 파일을 mount하거나 환경 값을 명시적으로 주입하지 않으면 호스트 세션은 게스트에 보이지 않습니다.

가장 안전한 공유 세션 구성은 각 벤더 로그인의 소유와 갱신을 호스트에 두고, 필요한 벤더 자격 증명 source만 read-only로 mount하며, 게스트에는 별도의 writable persistent OpenCode 데이터 디렉터리를 제공하는 것입니다:

| 프로바이더 | 호스트 | 게스트 |
| --- | --- | --- |
| Claude | Claude Code 로그인을 소유하고 갱신 | Claude 자격 증명 디렉터리를 read-only로 mount하고 `CLAUDE_CONFIG_DIR`을 그 게스트 경로로 설정하며 `credentialManagement: "external"`을 사용; 호스트 macOS Keychain은 Linux 게스트 안에서 사용할 수 없음; `ANTHROPIC_CLI_VERSION`, 설치된 `claude` 바이너리 또는 npm registry 접근으로 클라이언트 버전 확인 |
| Cursor | Cursor CLI 로그인을 소유 | 자격 증명 파일을 게스트의 `${HOME}/.config/cursor/auth.json`에 read-only로 mount하거나 샌드박스 secret 기능으로 `CURSOR_ACCESS_TOKEN` 주입; 게스트에 Node.js 22 이상 설치 |
| Command Code | CLI 로그인 또는 API 키를 소유 | `${HOME}/.commandcode/auth.json`을 read-only로 mount하거나 `COMMAND_CODE_API_KEY` 주입; `COMMAND_CODE_CLI_VERSION`, 설치된 `command-code` 바이너리 또는 npm registry 접근으로 클라이언트 버전 확인 |
| Ollama | 신뢰하는 데몬을 실행하고 Cloud 접근이 필요하면 그곳에서 `ollama signin` 실행 | Ollama 자격 증명을 복사하지 않고 `ollamaBaseURL`로 선택한 데몬에만 연결 |

예를 들어 Linux 게스트는 다음 경로와 선택적인 secret/version override를 사용할 수 있습니다. Mount source와 destination은 샌드박스 런타임에 맞게 조정하십시오:

```dotenv
HOME=/home/sandbox
XDG_DATA_HOME=/home/sandbox/.local/share
CLAUDE_CONFIG_DIR=/run/host-credentials/claude
CURSOR_ACCESS_TOKEN=<optional-sandbox-secret>
COMMAND_CODE_API_KEY=<optional-sandbox-secret>
ANTHROPIC_CLI_VERSION=<optional-compatible-version>
COMMAND_CODE_CLI_VERSION=<optional-compatible-version>
```

게스트에 writable persistent `XDG_DATA_HOME`을 설정하십시오. `/connect`는 OpenCode 인증 상태를 `${XDG_DATA_HOME}/opencode/auth.json`에 기록하며, Linux에서 `XDG_DATA_HOME`이 없으면 `${HOME}/.local/share/opencode/auth.json`을 사용합니다. 이 파일에는 비밀인 Claude OAuth 레코드 또는 Command Code API 키가 들어갈 수 있습니다. Cursor와 Ollama는 비밀이 아닌 CLI 세션 마커를 사용하고, Command Code는 마커 또는 키를 사용할 수 있습니다. 비밀을 담을 수 있는 파일로 보호하십시오. 게스트의 `/connect` 또는 Claude writeback이 파일을 갱신해야 한다면 호스트 OpenCode 데이터 디렉터리 전체를 read-only로 mount하지 마십시오.

네 프로바이더를 모두 활성화하고 호스트가 공유 자격 증명을 소유할 때 다음과 같은 완전한 게스트 `opencode.json`을 사용하십시오:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector",
      {
        "providers": ["claude", "cursor", "command-code", "ollama"],
        "ollamaBaseURL": "http://host.docker.internal:11434",
        "credentialManagement": "external",
        "catalogReloadMs": 300000,
        "snapshotTimeoutMs": 30000,
        "health": {
          "initialBackoffMs": 1000,
          "maximumBackoffMs": 60000
        }
      }
    ]
  ]
}
```

`ollamaBaseURL`은 OpenCode 프로바이더 옵션이 아니라 패키지 tuple에 넣는 flat 커넥터 옵션입니다. 위 숫자 값은 커넥터 기본값이고, `credentialManagement: "external"`과 호스트 데몬 URL은 read-only 호스트 소유 자격 증명을 위한 의도적인 override입니다. `opencode.json`에 벤더 토큰을 넣지 말고 read-only mount 또는 샌드박스 secret 주입 기능을 사용하십시오.

Docker Desktop에서는 보통 `host.docker.internal`이 호스트로 resolve됩니다. Linux Docker bridge에는 `--add-host=host.docker.internal:host-gateway` 또는 다음 Compose 설정이 추가로 필요할 수 있습니다:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Ollama는 보통 호스트 loopback에서 수신합니다. Bridge networking에서는 호스트가 `OLLAMA_HOST=0.0.0.0:11434`로 시작해야 할 수 있으며, 노출된 port를 호스트 firewall과 샌드박스 network policy로 제한하십시오. `OLLAMA_HOST`는 호스트 데몬을 설정하고 `ollamaBaseURL`은 게스트의 이 커넥터를 설정합니다. Host networking을 사용하면 게스트 `localhost`가 호스트에 도달하지만 격리가 약해지므로 명시적으로 선택해야 합니다. 다른 샌드박스 런타임도 이에 해당하는 호스트 route가 필요하며, 활성화한 각 프로바이더로 outbound 접근을 허용해야 합니다. Claude 또는 Command Code가 환경 값이나 설치된 바이너리에서 클라이언트 버전을 확인할 수 없을 때만 `registry.npmjs.org` 접근을 허용하십시오.

대신 게스트가 persistent guest storage에서 자체 벤더 로그인을 소유할 수도 있습니다. 이 모드에서는 호스트 자격 증명을 mount하지 말고 게스트에서 벤더 로그인 flow를 실행하십시오. 게스트가 유일한 Claude 갱신 소유자라면 `credentialManagement: "connector"`를 사용할 수 있습니다. 호스트와 게스트가 같은 Claude refresh token에서 파생된 자격 증명을 각자 갱신하게 해서는 안 됩니다.

## 업데이트 및 제거

결정론적으로 업데이트하려면 원하는 공개 버전을 확인하고 `plugin` 항목을 해당 정확한 spec으로 바꾼 뒤 OpenCode를 완전히 재시작하십시오:

```bash
npm view opencode-ext-connector version
```

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-ext-connector@<version>"]
}
```

고정하지 않은 항목이 재시작 시 캐시된 패키지를 자동으로 갱신한다고 기대하지 마십시오. 커넥터를 제거하려면 `plugin`에서 해당 항목을 삭제하고 OpenCode를 완전히 재시작하십시오. 패키지가 설정되어 있지 않으면 캐시된 패키지 파일은 비활성입니다.

## 최초 연결

OpenCode가 샌드박스에서 실행된다면 `/connect` 전에 writable OpenCode 인증 저장소와 호스트 networking을 포함한 [호스트/게스트 샌드박스 설정](#호스트게스트-샌드박스-설정)을 완료하십시오.

1. npm 패키지 항목 또는 버전 spec을 추가한 뒤 **OpenCode를 완전히 재시작**하십시오. 프로세스를 종료한 다음 다시 시작해야 named legacy auth hook이 로드됩니다. 리로드나 주기적 카탈로그 갱신은 인스턴스 재생성이 아닙니다.
2. 활성화한 프로바이더의 **로컬 전제 조건을 확인**하십시오. Claude와 Cursor는 벤더 세션이 필요합니다. Command Code는 OpenCode에 저장할 API 키 또는 기존 CLI 세션/키가 필요합니다. Ollama는 설정한 `ollamaBaseURL`에서 신뢰하는 데몬이 필요하며, Cloud는 별도로 `ollama signin`이 여전히 필요합니다.
3. 원하는 각 프로바이더에 대해 **`/connect`를 실행**하십시오. Claude와 Cursor는 벤더 세션이 사용 가능할 때만 마커 또는 OAuth 항목을 기록합니다. Command Code는 OpenCode에 직접 API 키를 저장하거나 기존 CLI 세션/키를 재사용할 수 있습니다. Ollama는 설정된 데몬이 응답할 때만 정확한 세션 마커를 저장합니다. 모델은 그 프로바이더별 규칙이 충족된 뒤에만 공개됩니다.
4. **카탈로그를 확인**하십시오. Claude, Cursor, Command Code 모델이 OpenCode에 나타나는지 확인합니다. Ollama는 `opencode models ollama`를 실행하여 로컬로 pull된 모델과, 커넥터가 자격 증명을 제공하지 않은 채 비인증으로 발견된 Cloud 태그를 확인하십시오.

Ollama `/connect`는 설정된 데몬을 조사하고 정확한 세션 마커를 저장합니다. `ollama signin`을 실행하거나 Ollama 자격 증명을 다루지 않습니다.

## 프로바이더

| 프로바이더 | 하는 일 |
| --- | --- |
| **Claude** | 기존 Claude Code 자격 증명을 재사용합니다. OAuth를 발급하지 않습니다. 호환 fetch가 CLI 호환 요청 메타데이터를 보내고, 내장 `anthropic` 경로에서 Anthropic SSE를 스트림합니다. `credentialManagement: "connector"`는 `60_000`ms 리드 타임의 자동 갱신과 writeback으로, `"external"`은 갱신 안 함/writeback 안 함 및 401 이후 자격 증명 다시 읽기로 매핑됩니다. 모든 자격 증명 정책 옵션을 생략하면 레거시 자동 갱신/`60_000` 동작과 writeback 안 함이 유지되며, `credentialManagement`만 생략하면 제공된 사용 중단 예정 옵션이 계속 동작을 제어합니다. |
| **Cursor** | CLI 액세스 토큰으로 Cursor의 미공개 클라이언트 프로토콜(`api2.cursor.sh` `AgentService`, HTTP/2 위의 Connect+protobuf)을 호출합니다. 두 자격 증명 관리 모드 모두 자격 증명은 읽기 전용입니다. direct 생성은 정확한 HTTP 401이 출력이나 효과 전에 발생할 때만 null이 아니며 변경된 자격 증명을 다시 읽고 한 번 재시도할 수 있으며, 이는 갱신이나 writeback이 아닙니다. legacy/compatibility 생성은 한 번만 시도합니다. 플러그인이 소유한 Node 자식 프로세스가 private stdio로 통신하고, 툴 결과를 같은 bidi Run에 유지하며, parked call을 절대 재실행하지 않고, 사용자 대면 데몬을 열지 않으며, 생성에 `cursor-agent`를 절대 spawn하지 않습니다. 비공식이며 공개 Cursor API가 아닙니다. 프로토콜이 어긋난 뒤에는 암시적 fallback이 없습니다 — 해당 프로바이더가 실패합니다. Node.js 22 이상이 필요합니다. 라이브 카탈로그 id가 있으면 그것을 쓰고, 없으면 문서화된 fallback은 `default`입니다. |
| **Command Code** | CLI 호환 요청 메타데이터와 함께 `/alpha/generate`를 호출하고, 프로바이더 로컬 NDJSON 텍스트와 툴 이벤트를 스트림합니다. 두 자격 증명 관리 모드 모두 자격 증명은 읽기 전용입니다. 정확한 HTTP 401이 출력이나 효과 전에 발생하면 null이 아니며 변경된 자격 증명을 다시 읽고 한 번만 재시도할 수 있으며, 이는 갱신이나 writeback이 아닙니다. 클라이언트 버전은 `COMMAND_CODE_CLI_VERSION`, 설치된 `command-code` 바이너리, 또는 npm registry에서 가져옵니다. 요청 메타데이터에는 Node.js 버전, 플랫폼, 아키텍처, 절대 작업 디렉터리가 포함됩니다. 라이브 카탈로그 id가 있으면 그것을 쓰고, 없으면 문서화된 fallback은 `Qwen/Qwen3.8-Max`입니다. |
| **Ollama** | `credentialManagement`의 영향을 받지 않습니다. `ollamaBaseURL`로 선택한 신뢰된 데몬(기본값 `http://localhost:11434`)의 `/api/tags`, `/api/pull`, `/api/chat`을 사용하며 경로 prefix를 보존합니다. 이미 pull된 모델과, 커넥터 자격 증명 없이 Ollama 공식 Cloud 검색 및 library 페이지에서 익명으로 발견한 정확한 Cloud 태그를 공개합니다. 정확히 중복되는 항목은 로컬이 이깁니다. 불완전한 Cloud 갱신은 마지막 완전한 목록을 유지합니다. 없는 인가된 Cloud 태그를 선택하면 최초 사용 시 lightweight remote reference를 pull합니다. 같은 정규화 base와 태그의 동시 pull은 하나의 in-flight 요청을 공유하며 실패한 pull은 재시도할 수 있습니다. 데몬은 사용자의 Ollama Cloud 구독으로 Cloud 태그 프롬프트를 proxy할 수 있습니다. 커넥터는 Ollama API 키, 사용량 과금 direct Cloud API, `OLLAMA_HOST`, 자격 증명/custom header, cookie, direct Cloud 생성 endpoint를 사용하지 않습니다. |

프로바이더 health는 격리됩니다. 한 프로바이더가 실패해도 나머지는 제거되지 않습니다.

독립 SDK entry는 `opencode-ext-connector/ollama`입니다. `{ ollamaBaseURL }`을 전달해 같은 신뢰된 데몬을 선택할 수 있습니다. 해당 데몬에 이미 있는 모델로 생성할 수 있으며, 커넥터가 관리하는 Cloud 자동 pull은 그 정규화 base의 활성 Ollama 카탈로그 lease가 필요합니다.

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| `/connect` 메서드가 없음 | `plugin`에 `"opencode-ext-connector"` 또는 정확한 공개 `"opencode-ext-connector@<version>"` spec이 있는지 확인한 뒤 OpenCode를 완전히 재시작하십시오. |
| 프로바이더가 활성화됐지만 모델이 없음 | `providers`를 생략하면 네 프로바이더가 모두 활성화됩니다. 명시적 목록은 엄격한 allow-list입니다. Claude와 Cursor는 마커 또는 OAuth 레코드와 벤더 세션이 필요하고, Command Code는 OpenCode에 저장된 API 키 또는 CLI 세션/키를 사용할 수 있으며, Ollama는 정확한 마커와 응답하는 설정된 데몬이 필요합니다. `/connect` 후 완전히 재시작해야 인스턴스 재생성이 새 소속을 반영합니다. |
| Claude가 다음 시작 전까지만 동작함 | 모든 자격 증명 정책 옵션을 생략하면 레거시의 메모리 내 갱신과 writeback 안 함이 유지됩니다. 회전된 refresh 토큰은 다음 프로세스 시작에서 실패할 수 있습니다. 커넥터가 갱신하고 기록해야 한다면 `credentialManagement: "connector"`를 사용하십시오. `credentialManagement`만 생략했다면 제공된 사용 중단 예정 갱신/writeback 옵션을 확인하십시오. |
| 공유 자격 증명에서 Claude가 `invalid_grant`를 보고함 | 같은 로그인을 쓰는 다른 머신이 이미 갱신해서 refresh 토큰이 회전됐습니다. 한 머신에 `credentialManagement: "connector"`로 갱신 권한을 주고 나머지에는 `"external"`을 사용하거나, 별도로 로그인하십시오. |
| 설정이 자격 증명 옵션을 거부함 | 새 옵션과 레거시 옵션을 함께 사용하지 마십시오. 정확한 오류는 다음과 같습니다: `` `credentialManagement` cannot be combined with deprecated `credentialRefresh` or `writeBackCredentials` ``. 레거시 옵션은 한 번의 마이그레이션 주기 동안 단독으로 계속 허용됩니다. |
| `Claude Code client version is unavailable` | `ANTHROPIC_CLI_VERSION`도, `claude` 바이너리도 없고 `registry.npmjs.org`에 접근할 수 없었습니다. 변수를 설정하거나 registry 접근을 허용하십시오. |
| Cursor 생성이 실패함 | Node.js 22 이상이 필요합니다. 생성은 `cursor-agent`가 아니라 private Node 자식 프로세스를 통한 미공개 프로토콜을 사용합니다. 프로토콜이 어긋나면 해당 프로바이더가 실패하며, 암시적 fallback은 없습니다. |
| Command Code 생성이 실패함 | 클라이언트 버전을 확인할 수 없었습니다: `COMMAND_CODE_CLI_VERSION`을 설정하거나, `command-code`를 설치하거나, `registry.npmjs.org` 접근을 허용하십시오. 요청 메타데이터에는 Node.js 버전, 플랫폼, 아키텍처, 절대 작업 디렉터리가 포함됩니다. |
| `opencode models ollama`에 Ollama가 없음 | `ollamaBaseURL`(또는 기본 `localhost:11434`)에서 신뢰하는 데몬을 시작한 뒤 `/connect`하십시오. 경로 prefix가 Ollama `/api/*` route에 도달하는지 확인하십시오. Cloud 태그는 익명 catalog 항목이며 `OLLAMA_HOST`, API 키, credential header, redirect, direct Cloud 생성은 사용하지 않습니다. |
| 호스트 자격 증명이 있지만 게스트 프로바이더가 연결되지 않음 | mount 대상과 권한, 게스트의 `HOME`, `CLAUDE_CONFIG_DIR`, 주입한 secret 환경, writable 게스트 OpenCode `auth.json`, 게스트 안에서 `/connect`가 완료됐는지 확인하십시오. |
| Ollama가 호스트에서는 동작하지만 게스트에서는 동작하지 않음 | 게스트 `localhost`는 보통 호스트가 아닙니다. `host.docker.internal` resolve, Linux `host-gateway` mapping, 데몬 bind 주소, firewall과 샌드박스 egress, base path prefix가 Ollama `/api/*` route에 도달하는지 확인하십시오. |
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
