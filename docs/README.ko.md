# OpenCode External Provider Connector

**기존 Claude Code·Command Code 자격 증명과 신뢰하는 Ollama 데몬을 연결하는 독립·비공식 OpenCode 플러그인, 버전 0.9.1.**

[English](../README.md) · [변경 이력](../CHANGELOG.md) · [라이선스](../LICENSE)

## 지원 범위

| 프로바이더 | 연결 방식 |
| --- | --- |
| `claude` | 기존 Claude Code OAuth·키체인·파일, CLI 호환 bearer Models/Messages 요청 |
| `command-code` | 기존 CLI 자격 증명·파일 또는 명시적으로 선택한 직접 키, 모델 카탈로그와 `/alpha/generate` NDJSON |
| `ollama` | `ollamaBaseURL`로 선택한 신뢰하는 로컬·원격 데몬의 문서화된 API |

Cursor는 0.8.0에서 제외했습니다. 미공개 프로토콜을 사용하지 않으며, OpenCode 권한 경계를 검증하지 못한 Cursor SDK·CLI 에이전트로 우회하지 않습니다. `./cursor` SDK에서 모델을 요청하면 명시적으로 거절됩니다.

0.9.1은 이전 퇴역 결정을 대체하여 원래 V1 xAI OAuth consumer를 루트·전용 진입점 모두에서 복원하고 authority 관찰도 복원합니다. consumer는 V1 전용이며 V2에서 선택하면 리소스 할당 전 명시적인 설정 오류를 반환합니다. V2 authority는 선택된 네이티브 연결을 관찰하지만 외부 manager 호환성은 미검증입니다. xAI는 기본 세 프로바이더 목록과 독립적인 opt-in입니다.

## 0.9의 방향 교정

0.8.0의 API 키 전용 전환을 교정하여 기존 자격 증명 재사용이라는 원래 목적을 복원합니다. 이 교정은 사용자가 0.8 방향을 승인했다는 뜻이 아닙니다.

- Claude Code OAuth·키체인·자격 증명 파일을 다시 사용합니다. 새 OAuth 로그인은 수행하지 않습니다.
- Command Code는 `GET /provider/v1/models` 카탈로그와 CLI 호환 `/alpha/generate`의 프로바이더 전용 NDJSON 텍스트·툴 이벤트를 사용합니다. 직접 키를 선택하면 벤더 파일로 fallback하지 않습니다.
- 기본 생성에 네이티브 벤더 CLI를 요구하지 않으며, 실패나 토큰 형태를 근거로 유료 API 경로를 암묵적으로 선택하지 않습니다. 명시적 독립 API SDK는 별도의 자발적 선택입니다.
- owner/reader와 저수준 자격 증명 정책은 복원합니다. `xaiOAuth`는 독립적인 authority/consumer 옵션으로 복원합니다. `providers`에는 `claude`, `command-code`, `ollama`만 허용되며 `cursor`나 `xai`를 넣지 마십시오.

제3자 자격 증명 재사용은 서비스 약관으로 제한될 수 있습니다. 호환 프로토콜은 변경되어 동작하지 않을 수 있고 계정이 제한될 수 있습니다. 소스 라이선스는 벤더 사용 허가가 아닙니다. 무료·무비용 사용, 청구 방식, 실제 이용 자격이나 벤더 승인을 보장하지 않습니다.

## 요구 사항

- Bun 1.3.14 이상. 설치·빌드·검사는 Bun을 사용합니다.
- V1 named-function 플러그인 로더를 지원하는 OpenCode, 또는 별도 V2 진입점과 CLI·플러그인 API 2.0.20.
- Claude: `~/.claude/.credentials.json`(또는 `CLAUDE_CONFIG_DIR`) 및/또는 macOS Keychain의 기존 Claude Code 자격 증명과 OpenCode 연결 gate.
- Command Code: `~/.commandcode/auth.json` 또는 `COMMAND_CODE_API_KEY`의 기존 CLI 자격 증명, 또는 명시적으로 선택한 OpenCode 직접 키.
- Ollama: 선택한 주소에서 응답하는 신뢰하는 데몬. Cloud 로그인이 필요하면 그 데몬에서 별도로 `ollama signin`을 수행합니다.

기본 생성에는 Claude·Command Code 네이티브 CLI가 필수가 아닙니다. 클라이언트 버전은 `ANTHROPIC_CLI_VERSION` / `COMMAND_CODE_CLI_VERSION` → 선택적으로 설치된 `claude --version` / `command-code --version` → npm 레지스트리(`@anthropic-ai/claude-code` / `command-code`) 순서로 동적으로 구하며 상수로 고정하지 않습니다. 선택적 Claude CLI authority에는 별도 요구 사항이 있습니다.

## OpenCode V1 설치

전역 `~/.config/opencode/opencode.json` 또는 프로젝트 `opencode.json`의 단수 `plugin` 필드에 추가하십시오.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector@0.9.1",
      {
        "providers": ["claude", "command-code", "ollama"],
        "ollamaBaseURL": "http://localhost:11434"
      }
    ]
  ]
}
```

해당 런타임에 기존 벤더 자격 증명을 제공하고 `/connect`를 수행한 뒤 **OpenCode를 완전히 종료하고 재시작**하십시오. 설정 리로드는 인스턴스 재생성과 같지 않습니다. 실제 토큰·키를 `opencode.json`에 넣지 마십시오.

루트와 `./server`는 V1 전용이며 다음 여섯 named 함수를 유지합니다: `connectorServer`, `claudeAuthServer`, `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, `xaiAuthServer`. Cursor는 비활성입니다. 루트 `xaiAuthServer`는 consumer 모드에서만 인증 훅을 제공하고 `connectorServer`는 authority 관찰을 담당합니다. 기본 프로바이더는 `claude`, `command-code`, `ollama` 세 개이며 xAI는 별도 opt-in입니다.

V1 프로바이더 `claude`는 integration/auth ID `anthropic`으로 연결되며 모델 이름은 `claude/<id>`입니다. 정확한 `cli-session:anthropic` 마커(또는 지원되는 OAuth 레코드)와 사용 가능한 Claude Code 자격 증명이 필요합니다. Command Code의 CLI 연결은 정확한 `cli-session:command-code`와 벤더 자격 증명이 필요하고, 직접 키는 명시적 선택입니다. Ollama는 응답하는 설정 데몬을 `/connect`로 확인한 뒤 정확한 `cli-session:ollama`를 저장합니다. 마커는 벤더 토큰이 아니며 마커만으로 생성할 수 없습니다.

## OpenCode V2

V2는 `@opencode/plugin@2.0.20`과 `@opencode/cli@2.0.20`을 대상으로 하는 별도 default 플러그인입니다. 오래된 beta CLI는 이 계약을 대신하지 않습니다.

복수 `plugins` 필드를 사용하고, `package`를 설치하거나 빌드한 패키지의 **`dist/v2-entry` 디렉터리**로 지정하십시오.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "file:///absolute/path/to/opencode-ext-connector/dist/v2-entry",
      "options": {
        "providers": ["claude", "command-code", "ollama"],
        "ollamaBaseURL": "http://localhost:11434"
      }
    }
  ]
}
```

직접 `dist/v2.js`를 가리키는 file URL은 CLI 2.0.20에서 무시됩니다. `opencode-ext-connector/v2`를 그대로 `plugins.package`에 넣지 마십시오. `./v2`는 Node import 진입점이며, 같은 루트 npm 플러그인 spec이 V2에서 자동으로 작동하는 것은 아닙니다.

V2는 선택한 호스트 연결의 `active`·`resolve`와 선언된 연결 방식만 사용합니다. 선택한 연결이 없거나 사용할 수 없을 때 V1 `auth.json`이나 다른 프로세스 env 연결로 fallback하지 않습니다. `claude`의 integration ID는 `anthropic`입니다. 선언된 Claude OAuth/CLI 방식은 기존 자격 증명을 재사용하며 새 로그인을 하지 않습니다.

| Integration | 선언된 env 연결 | 해석된 값 |
| --- | --- | --- |
| `anthropic` | `CLAUDE_EXT_CONNECTOR_ENABLED` | 정확한 `cli-session:anthropic` gate와 벤더 자격 증명 |
| `command-code` | `COMMAND_CODE_API_KEY` | 명시적 직접 키; CLI 연결은 정확한 `cli-session:command-code`와 벤더 자격 증명 |
| `ollama` | `OLLAMA_EXT_CONNECTOR_ENABLED` | 정확한 `cli-session:ollama`와 응답하는 신뢰하는 데몬 |

다른 플러그인의 V2 호환성은 그 플러그인이 제공해야 합니다. 이 패키지가 다른 플러그인을 자동으로 V2에 맞춰 주지는 않습니다.

xAI consumer는 **V1 전용**입니다. 네이티브 CLI 2.0.20의 `/api/experimental/generate`는 모든 세션 훅을 우회하고 `nativeModelResolver`는 SDK 훅을 사용하지 않으며 노출된 auth factory interceptor도 없습니다. 따라서 V2는 `xaiOAuth: { mode: "consumer" }`를 리소스 할당 전 타입이 지정된 설정 오류로 거절합니다. 네이티브 HTTP/WebSocket 가로채기나 네이티브 API 요청 전체의 fail-closed 집행을 약속하지 않습니다. consumer opt-in을 설정하지 않으면 독립적인 네이티브 xAI API 키 사용과 다른 V2 프로바이더는 그대로 유지됩니다.

V2 authority는 V1 `auth.json`이나 선택되지 않은 env 대신 선택한 네이티브 `xai` 연결의 `active`·`resolve`만 관찰하며, 연결 제거와 안정적인 부재 상태로의 전환도 관찰합니다. 별도로 제공하는 고정 helper와 외부 manager가 projection을 소유합니다. 네이티브 V2 manager 호환성은 미검증이며 패키지가 helper를 번들하거나 설치하지 않습니다.

## 설정

| 옵션 | 기본값 | 의미 |
| --- | --- | --- |
| `providers` | `claude`, `command-code`, `ollama` | 엄격한 허용 목록. 명시적 `[]`는 이 세 개를 비활성화하며 xAI와 독립적 |
| `xaiOAuth` | 생략(비활성) | 엄격한 authority/consumer 객체. consumer는 V1 전용이며 V2 설정 시 할당 전에 명시적으로 거절. null·누락/잘못된 mode·추가 필드는 거절 |
| `ollamaBaseURL` | `http://localhost:11434` | 신뢰하는 데몬의 절대 HTTP·HTTPS base. 경로 prefix 보존 |
| `credentialRole` | 생략 | Claude 공유 로그인 `owner` 또는 `reader` |
| `credentialManagement` | 생략 | 고급 `connector` 갱신/writeback 또는 `external` 외부 관리 |
| `credentialRefresh` | `mode: "auto", leadMs: 60000` | deprecated; management·role 없이 단독 사용 가능, 사용자 지정 lead 포함 |
| `writeBackCredentials` | `false` | deprecated; management·role 없이 단독 사용 가능 |
| `credentialAuthority.claudeCli.enabled` | `false` | external 관리가 필요한 선택적 Linux CLI authority |
| `credentialAuthority.claudeCli.leadMs` / `retryMs` | `300000` / `300000` | 만료 전 실행 시간 / 재시도 간격(ms) |
| `catalogReloadMs` | `300000` | 카탈로그 갱신 간격. `0`은 주기 갱신만 끄며 초기 갱신은 수행 |
| `snapshotTimeoutMs` | `30000` | 프로바이더별 스냅샷 기한 |
| `health.initialBackoffMs` | `1000` | 실패 후 초기 backoff |
| `health.maximumBackoffMs` | `60000` | backoff 상한 |

### 자격 증명 소유권과 저수준 정책

공유 Claude 로그인마다 owner는 하나만 두십시오. `credentialRole: "reader"`는 external 관리와 authority 비활성을 선택하며 읽기 전용 자격 증명을 사용합니다. `"owner"`는 external 관리와 선택적 Claude CLI authority를 선택합니다. 역할은 호스트/게스트 위치가 아니라 자격 증명 소유권을 뜻합니다. role은 `credentialManagement`, `credentialAuthority`, `credentialRefresh`, `writeBackCredentials`와 함께 사용할 수 없습니다.

owner/저수준 CLI authority는 Linux, util-linux `flock`, Claude Code >=2.1.265, 인증된 세션과 쓰기 가능한 영구 authority 상태가 필요합니다. 각 제한된 요청은 실제 모델 요청이며 사용량을 소비할 수 있습니다. 기본 생성 경로가 아니며 로그인이나 취소된 세션 복구를 하지 않습니다. 저수준 설정은 `credentialManagement: "external"`과 `credentialAuthority: { claudeCli: { enabled: true } }`를 함께 사용합니다. 동기화는 운영자 책임이며 같은 회전 토큰에서 파생된 로그인을 여러 프로세스가 독립 갱신하면 안 됩니다.

정책을 모두 생략하면 Claude는 auto/`60_000` ms 갱신과 no-write를 유지합니다. `credentialManagement: "connector"`는 auto/`60_000`와 writeback, `"external"`은 never/no-write와 401 후 재읽기를 선택합니다. deprecated `credentialRefresh`·`writeBackCredentials`는 한 마이그레이션 주기 동안 단독으로 허용하지만 management와 혼합할 수 없습니다. Command Code는 읽기 전용이고 Ollama는 영향을 받지 않습니다. 독립적인 `xaiOAuth`는 이 Claude 정책을 바꾸지 않습니다.

V1/V2 모델 뷰는 실제 요청과 내부 재시도 전에 gate/선택 연결, 자격 증명 소스, 세대, 모델 멤버십과 수명을 확인합니다. 외부에서 알 수 없는 토큰·계정·소스로 변경하면 이전 모델 뷰를 폐기하고 새 카탈로그 바인딩을 요구합니다. 현재 소스와 gate가 유지되는 알려진 관리형 갱신의 후손만 scope를 유지할 수 있습니다. 출력 전 정확한 401은 재읽기의 계기가 될 수 있지만, 외부 교체는 옛 프롬프트를 다른 계정으로 조용히 재전송할 권한이 아닙니다. 종료도 바인딩을 폐기합니다. `connectorV1`은 내부 메타데이터이지 사용자 옵션이 아닙니다. 새 모델의 반영은 OpenCode의 정상 인스턴스 재생성을 따르며 커넥터가 강제하지 않습니다.

## 선택적 xAI authority와 V1 consumer

`xaiOAuth`를 생략하면 조용히 비활성화됩니다. 정확히 `{ "mode": "authority" }` 또는 `{ "mode": "consumer" }`를 선택하십시오. literal null, 누락/알 수 없는 mode와 추가 키는 거절합니다. Claude 역할·정책 및 `providers`와 독립적입니다. V1에서 xAI만 사용하려면 **루트 npm tuple**과 빈 세 프로바이더 목록을 사용합니다:

```jsonc
{
  "plugin": [["opencode-ext-connector@0.9.1", {
    "providers": [],
    "xaiOAuth": { "mode": "consumer" }
  }]]
}
```

기존 자격 증명 변경을 관찰하는 인스턴스는 같은 루트 tuple에서 `xaiOAuth: { mode: "authority" }`를 선택합니다. authority는 기존 인증 변경만 관찰하고 고정 `${HOME}/.local/bin/opensandbox-xai-auth-sync`를 인자 없이 실행합니다. 자식 환경은 절대 `HOME`, `PATH=/usr/local/bin:/usr/bin:/bin`, 지정된 경우 절대 `XDG_DATA_HOME`만 전달합니다. 기본 polling은 1000 ms, 관찰·helper 시작 실패나 non-zero 종료 후 retry는 5000 ms입니다. dispose는 polling과 감독 중인 작업을 취소합니다. V1은 기존 `xai` 인증 레코드, V2는 선택된 네이티브 `active`·`resolve` 소스를 관찰하며 연결 제거 후 안정적인 부재 상태로의 전환도 포함합니다.

projection과 세션 관리는 외부 manager가 소유합니다. 패키지는 helper를 번들·설치하거나 접근 파일을 쓰거나 비밀을 복제하지 않고, 새 OAuth grant·xAI 토큰 갱신을 수행하지 않습니다. 실제 helper는 검증 환경에 없으며 네이티브 V2 manager 호환성은 검증되지 않았습니다. 게스트에 refresh token을 전달하지 마십시오.

V1 consumer는 정확한 `{ "type": "api", "key": "cli-session:xai" }` 마커를 요구합니다. 운영자가 제공하는 마커이며 실제 API 자격 증명이 아닙니다. loader의 `apiKey: "xai-access-file"`도 sentinel일 뿐이고 실제 bearer는 요청 transport가 projection에서 읽습니다. `methods: []`로 새 로그인·`/connect` 방법을 제공하지 않습니다. 실제 네이티브 API 키 연결은 별도의 자발적 선택이며 자동 fallback이 아닙니다.

접근 파일은 절대 XDG일 때 `${XDG_DATA_HOME}/opencode/xai-access.json`, XDG가 없거나 비어 있고 HOME이 절대 경로이면 `${HOME}/.local/share/opencode/xai-access.json`입니다. 상대 XDG는 fail-closed입니다. 닫힌 v1 schema는 `schema_version: 1`, `provider: "xai"`와 `state: "ready"`의 비어 있지 않은 `access`·정수 `expires`(epoch ms), 또는 `state: "unavailable"`만 허용합니다. refresh token을 포함한 추가 필드는 거절합니다. 현재 사용자 소유의 일반 파일, link 수 1, 정확한 `0600`, read-only/no-follow 열기가 필요합니다. 누락·링크·잘못된 JSON/schema·unavailable·만료는 네트워크 전송 전에 차단합니다.

매 새 V1 요청은 projection을 다시 읽으므로 같은 loader가 access A를 사용한 뒤 다음 새 요청에서 갱신된 access B를 사용할 수 있습니다. 대기 중인 시도는 원래 경로·토큰 fingerprint·만료·선택 gate·수명에 묶여 관찰된 변경 시 차단되며, 교체 자격 증명을 채택하거나 옛 프롬프트를 재전송하지 않습니다. 전송 전에 신뢰하는 xAI 대상·취소·dispose를 다시 확인하고 redirect는 거절합니다. 401 프롬프트 replay, 커넥터 갱신, 새 grant, 유료 fallback은 없습니다.

전용 `./xai` Node 진입점은 `xaiAuthServer`만 export합니다:

```ts
import { xaiAuthServer } from "opencode-ext-connector/xai"
```

raw npm `/xai` subpath를 V1 plugin spec으로 로드하는 계약은 검증되지 않았으므로 V1 설정에는 위 루트 npm tuple을 사용하십시오. V2 authority는 위 복수 `plugins`의 `dist/v2-entry` 디렉터리 URL과 `options`의 `xaiOAuth: { mode: "authority" }`를 사용합니다. V2 consumer는 설정 단계에서 거절됩니다.

## 호스트와 게스트

일반 데스크톱·호스트와 컨테이너·VM·샌드박스 게스트에서 같은 기존 자격 증명 연결 계약을 사용합니다.

게스트는 자신의 `localhost`, HOME, 환경, 파일 권한, 키체인과 네트워크를 가집니다. 필요한 벤더 자격 증명 소스만 읽기 전용 mount하고 Claude reader에는 `credentialRole: "reader"`를 사용하십시오. 공유 로그인마다 갱신 owner는 하나만 둡니다. 호스트 macOS Keychain은 Linux 게스트에서 사용할 수 없으므로 적절한 파일 소스를 제공해야 합니다.

Claude 디렉터리를 mount하고 게스트 `CLAUDE_CONFIG_DIR`을 그 경로로 지정합니다. Command Code 파일은 게스트 `${HOME}/.commandcode/auth.json`에 읽기 전용 mount하거나 선택한 키를 secret 기능으로 주입하십시오. 버전은 env override, 선택적 바이너리 또는 npm 접근으로 구합니다. Ollama 자격 증명은 복사하지 않습니다.

별도의 영구 `HOME`과 writable `XDG_DATA_HOME`을 두십시오. Linux V1 저장소는 `${XDG_DATA_HOME}/opencode/auth.json`, XDG가 없으면 `${HOME}/.local/share/opencode/auth.json`입니다. OAuth 레코드·직접 키를 담을 수 있으므로 secret 파일로 보호하고 게스트 `/connect`가 쓸 수 있어야 합니다. 호스트 OpenCode 데이터 전체를 읽기 전용 mount하는 방식으로 대체하지 마십시오. V2는 V1 저장소가 아니라 호스트가 관리하는 선택 연결을 사용합니다.

호스트 Ollama 데몬을 사용할 때는 게스트의 `ollamaBaseURL`을 호스트 경로로 지정합니다.

```jsonc
{
  "plugin": [["opencode-ext-connector@0.9.1", {
    "providers": ["claude", "command-code", "ollama"],
    "ollamaBaseURL": "http://host.docker.internal:11434",
    "credentialRole": "reader"
  }]]
}
```

Docker Desktop의 호스트 이름 또는 Linux의 `host-gateway` 매핑처럼 해당 런타임에서 제공하는 호스트 경로를 사용하십시오. 데몬을 외부 인터페이스에 노출해야 한다면 방화벽·네트워크 정책·HTTPS 종료를 운영자가 관리해야 합니다. `OLLAMA_HOST`는 호스트 데몬 설정이고 커넥터는 읽지 않습니다.

Ollama는 설정한 신뢰하는 데몬의 `/api/tags`, `/api/pull`, `/api/chat`을 사용하며 경로 prefix를 보존합니다. 이미 pull된 모델에 더해 공개 JSON 카탈로그 `https://ollama.com/api/tags`에서 익명으로 전역 Cloud 모델을 발견합니다. 이 호스팅 카탈로그는 데몬에 설치된 모델 목록과 독립적입니다. 각 호스팅 ID에 대응하는 데몬 참조는 공식 `registry.ollama.ai`의 manifest·config로 검증합니다. `remote_model`이 호스팅 ID와 정확히 일치하고, `remote_host`가 허용된 HTTPS 호스트인 `https://ollama.com`이며, config 크기와 SHA-256 digest가 일치하고, 가중치 layer가 없어야 합니다(manifest layer 목록이 비어 있어야 함). 동일한 ID는 로컬 항목이 우선합니다.

resolver는 제한된 후보 참조 이름을 조회하지만, 그 후보가 승인된 보편적 suffix 규칙이거나 전체 매핑의 증거는 아닙니다. 모든 호스팅 ID를 검증된 참조로 해석해야 Cloud 갱신이 완료됩니다. 매핑 미해결이나 검증 실패로 갱신이 불완전하면 일부 목록으로 교체하지 않고 마지막으로 완료된 Cloud 목록과 pull 허용 상태를 유지합니다. 완료된 갱신이 한 번도 없으면 Cloud 참조의 pull은 허용되지 않습니다. 전체 매핑과 후보 조회의 서비스상 허용 여부는 아직 검토가 필요한 항목이며, 메타데이터 검증이 서비스 사용 권한이나 라이브 생성 성공을 입증하지는 않습니다.

발견 작업이 실패하면 다른 조회 작업을 취소하고 정리가 끝난 뒤 스냅샷을 종료합니다. 호출자의 부모 signal은 취소하지 않으며 원래 실패를 유지합니다. 최초 사용을 위한 pull이 끝난 뒤에도 각 대기 호출은 처음 확보한 카탈로그 허용 상태를 프롬프트 전송 전에 다시 확인합니다. lease 해제나 참조 교체로 그 상태가 더 이상 유효하지 않으면 chat을 차단합니다. 신뢰하는 데몬에 이미 설치된 모델은 Cloud 카탈로그 lease 없이 기존 로컬 우선 동작을 유지합니다.

검증되고 활성 카탈로그 lease가 pull을 허용한 참조를 선택했는데 설정한 데몬에 없다면, 커넥터가 그 데몬에서 경량 원격 참조를 자동으로 `/api/pull`한 뒤 `/api/chat`을 호출합니다. 같은 정규화 base와 참조의 동시 pull은 하나의 진행 중 요청을 공유하고, 실패한 pull은 나중에 재시도할 수 있습니다. 공유 pull 요청 안에서 다른 후보로 대체하지 않고 정확히 선택한 참조의 manifest·config를 보존된 원래 호스팅 ID와 다시 대조·검증합니다. 그 후 데몬 pull 직전에 활성 lease와 카탈로그 참조가 그대로 유지되는지 다시 확인하며, 검증 실패나 더 이상 유효하지 않은 pull 허용 상태는 pull을 차단합니다. 카탈로그 갱신도 발견 작업이 끝난 뒤 lease 해제와 취소 여부를 다시 확인하고 결과를 반영합니다.

Cloud 생성의 인증·proxy는 사용자 데몬이 담당합니다. 필요한 Cloud 로그인은 데몬 머신에서 별도로 `ollama signin`으로 수행하며 계정의 요금제·사용 한도를 따릅니다. 커넥터는 직접 Cloud 생성 endpoint, 자격 증명·쿠키·사용자 지정 인증 헤더·redirect·사용자 지정 CA·TLS 우회를 제공하지 않습니다. 데몬 base의 URL 자격 증명·query·fragment·직접 API 경로 및 `ollama.com`과 그 하위 호스트는 거절합니다. 신뢰하는 데몬과 네트워크 경로만 사용하고 노출·접근 정책은 운영자가 관리하십시오.

## SDK와 운영

- `opencode-ext-connector/claude`: `createClaude({ apiKey })`
- `opencode-ext-connector/command-code`: `createCommandCode({ apiKey })`
- `opencode-ext-connector/ollama`: `createOllama({ ollamaBaseURL })`

Claude·Command Code 독립 API SDK는 별도로 명시적으로 선택하는 자발적 경로이며, 호스트 바인딩 호환 생성의 fallback이 아닙니다. 명시적 API 키는 ambient 인증보다 우선하고 잘못된 값은 다른 자격 증명으로 조용히 전환하지 않습니다. 호스트 바인딩·계정 정보는 사용자 옵션이 아닙니다. `./v2`는 별도 default Node import이며 CLI는 `dist/v2-entry` 디렉터리를 사용합니다.

업데이트할 때는 원하는 공개 버전을 확인하고 정확한 플러그인 spec으로 바꾼 후 완전히 재시작하십시오. 제거는 해당 플러그인 항목을 설정에서 삭제하고 재시작하면 됩니다. 캐시된 패키지는 설정되어 있지 않으면 비활성입니다.

모델이 없으면 정확한 integration gate, 벤더 자격 증명 또는 선택한 Command Code 직접 키, V2 선택 연결과 데몬 가용성을 확인하십시오. 클라이언트 버전을 구할 수 없으면 env override·선택적 바이너리·npm 접근을 확인합니다. 정책 거절은 role/저수준 혼합이나 management/deprecated 혼합 여부를 확인하고 Cursor는 제외하십시오. xAI consumer는 V1에서만 사용하며 strict mode, 정확한 마커, 절대 경로, 소유자·단일 링크·0600·schema·미래 만료를 확인합니다. V2 consumer 설정은 할당 전 거절됩니다. helper 시작 실패는 성공이 아니라 retry이며 네이티브 V2 manager 호환성은 미검증입니다. 오래된 모델이 거절되면 새 카탈로그 바인딩을 확보해야 합니다. 카탈로그 표시는 실제 생성 성공·툴 지원·이용 자격의 증거가 아닙니다.

## 검사와 참고 자료

```bash
bun run check
bun run build
bun test
bun run test:provider
bun run test:integration
bun run test:e2e
OPENCODE_V2_BIN=/path/to/opencode2 bun run test:e2e:v2
bun run verify:package
```

검사는 오프라인 가짜 자격 증명·transport와 loopback 서버, 임시 HOME/XDG에서 실행하는 실제 격리 OpenCode 호스트 프로세스를 사용합니다. 호스트 비밀을 상속하거나 라이브 벤더 endpoint를 호출하면 안 됩니다. 기본 `bun test`는 `OPENCODE_V2_BIN`이 없고 `opencode2`도 없으면 V2를 건너뛸 수 있습니다. 명시적 V2 레인은 CLI 2.0.20을 대상으로 하며 바이너리가 없으면 조용히 건너뛰지 않고 실패합니다. 검사는 라이브 벤더 승인·이용 자격·청구 방식을 증명하지 않습니다.

V2 경계 교정 후 부모의 `bun run check`는 종료 코드 0으로 통과했고, 전체 검사는 129개 파일에서 753 pass/0 fail, 1951개 assertion으로 통과했습니다. Bun 1.3.14·Node 24.20.0에서 빌드된 루트·전용 공개 진입점의 consumer QA와 production supervisor로 실행한 합성 helper의 초기 상태·변경·제거 QA도 통과했으며, 라이브 벤더는 호출하지 않았습니다. 소스 동결, packed package, CI 및 registry의 상세 증거는 패키지 외부의 부모 릴리스 ledger에서 관리합니다.

[Anthropic API](https://platform.claude.com/docs/en/api/overview) · [Command Code Provider API](https://commandcode.ai/docs/provider) · [Cursor API 범위](https://cursor.com/docs/api) · [파생 소스 고지](../THIRD_PARTY_NOTICES.md)

## 라이선스 및 면책 조항

BSD-3-Clause. [LICENSE](../LICENSE)를 참조하십시오. 파생 업스트림 작업은 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)에 있습니다.

이 프로젝트는 독립적이고 비공식적인 커뮤니티 프로젝트입니다. OpenCode 또는 제3자 서비스 제공자와 제휴, 보증, 후원, 승인 관계가 없습니다.

모든 제품명, 상표, 등록상표는 각 소유자의 재산입니다. 본 프로젝트에서 이러한 명칭을 사용하는 것은 식별과 상호운용성을 위해서이며, 어떠한 제휴 또는 보증 관계를 암시하지 않습니다.

이 프로젝트의 라이선스는 본 저장소에 배포된 소스 코드에만 적용됩니다. 이 라이선스는 제3자 서비스에 대한 접근, 사용, 수정, 자동화, 또는 제한 사항 우회 권한을 부여하지 않습니다.

이 프로젝트는 접근 통제, 사용 제한, 인증 요건, 또는 서비스 약관을 무력화할 것을 조장하지 않습니다. 사용자는 자신의 사용이 허용되는지 여부를 스스로 판단하고, 관련 법률, 계약, 정책, 제공자 약관을 준수할 책임이 전적으로 있습니다.

제3자 제공자는 언제든지 인터페이스, 인증 방식, 계정, 또는 서비스를 변경, 제한, 중단, 또는 종료할 수 있습니다. 본 소프트웨어를 사용하면 서비스 중단, 계정 제한 또는 해지, 데이터 손실, 예상치 못한 요금 발생, 또는 자격 증명 노출 등의 결과가 발생할 수 있습니다.

본 소프트웨어는 "있는 그대로" 제공되며, 어떠한 형태의 보증도 하지 않습니다. 관련 법률이 허용하는 최대 범위 내에서, 저작자 및 기여자는 본 소프트웨어의 사용 또는 사용 불능으로 인해 발생하는 어떠한 청구, 손해, 손실, 계정 조치, 또는 기타 결과에 대해서도 책임지지 않습니다. 본 소프트웨어는 전적으로 사용자의 책임 하에 사용하십시오.

[LICENSE](../LICENSE)의 BSD 3-Clause 라이선스가 본 소프트웨어의 복사, 수정, 배포를 규율합니다. 본 면책 조항이 라이선스와 충돌하는 경우, 라이선스가 우선합니다.
