# OpenCode External Provider Connector

**Claude·Command Code 공식 API와 신뢰하는 Ollama 데몬을 연결하는 독립·비공식 OpenCode 플러그인, 버전 0.8.0.**

[English](../README.md) · [변경 이력](../CHANGELOG.md) · [라이선스](../LICENSE)

## 지원 범위

| 프로바이더 | 연결 방식 |
| --- | --- |
| `claude` | 사용자 소유 Anthropic API 키, 공식 Messages API와 페이지 단위 Models API |
| `command-code` | 사용자 소유 Command Code API 키, 공식 Provider API가 공개한 `supported_endpoints`에 따른 Chat Completions·Messages·Responses |
| `ollama` | `ollamaBaseURL`로 선택한 신뢰하는 로컬·원격 데몬의 문서화된 API |

Cursor는 0.8.0에서 제외했습니다. 미공개 프로토콜을 사용하지 않으며, OpenCode 권한 경계를 검증하지 못한 Cursor SDK·CLI 에이전트로 우회하지 않습니다. `./cursor` SDK에서 모델을 요청하면 명시적으로 거절됩니다.

xAI는 OpenCode의 기본 `xai` 프로바이더에 API 키를 설정해 사용하십시오. 이 커넥터는 xAI 인증을 가로채지 않습니다. 과거 OAuth 권한·컨슈머·접근 파일 projection은 제거했으며, `opencode-ext-connector/xai` 항목은 퇴역 오류를 반환합니다.

## 0.7.x에서 전환

0.8.0은 인증과 지원 범위가 바뀌는 릴리스입니다.

- Claude Code 구독 로그인·OAuth·키체인·자격 증명 파일을 재사용하지 않습니다. Anthropic API 키와 API 사용 권한이 필요하며 API 요금은 Claude 구독과 별개입니다.
- Command Code는 `/alpha/generate`와 CLI 메타데이터 대신 공식 `/provider/v1/*` 경로를 사용합니다. 공식 문서는 Go를 제외한 요금제에서 API 접근을 제공한다고 설명합니다. 실제 모델 접근·크레딧·비용은 계정의 요금제를 따릅니다.
- `credentialRole`, `credentialManagement`, `credentialAuthority`, `credentialRefresh`, `writeBackCredentials`, `xaiOAuth`를 설정에서 제거하십시오. 이제 이 옵션들은 리소스를 만들기 전에 명시적으로 거절됩니다.
- `providers`에서 `cursor`를 제거하고, 별도로 설정한 `opencode-ext-connector/xai` 항목도 제거하십시오. 구독 자격 증명을 게스트로 복사하거나 mount하는 절차는 필요하지 않습니다.

커넥터는 OAuth 발급·갱신·writeback·로그인·권한 헬퍼 실행을 하지 않습니다. API 키의 보관과 연결 상태 저장은 OpenCode와 운영자의 secret 관리 절차를 따릅니다.

## 요구 사항

- Bun 1.3.14 이상. 설치·빌드·검사는 Bun을 사용합니다.
- V1 named-function 플러그인 로더를 지원하는 OpenCode, 또는 별도 V2 진입점과 CLI·플러그인 API 2.0.20.
- Claude: `ANTHROPIC_API_KEY` 또는 OpenCode의 전용 `claude` API 키 레코드. 기본 `anthropic` OAuth 레코드를 사용하지 않습니다.
- Command Code: `COMMAND_CODE_API_KEY` 또는 전용 `command-code` API 키 레코드와 API 접근이 가능한 요금제.
- Ollama: 선택한 주소에서 응답하는 신뢰하는 데몬. Cloud 로그인이 필요하면 그 데몬에서 별도로 `ollama signin`을 수행합니다.

Claude·Command Code CLI나 Cursor용 Node 브리지는 필요하지 않습니다. 공식 API가 문서화되어 있다는 사실이 모든 계정·배포 형태의 법적 허용이나 서비스 접근을 보장하지는 않습니다.

## OpenCode V1 설치

전역 `~/.config/opencode/opencode.json` 또는 프로젝트 `opencode.json`의 단수 `plugin` 필드에 추가하십시오.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    [
      "opencode-ext-connector@0.8.0",
      {
        "providers": ["claude", "command-code", "ollama"],
        "ollamaBaseURL": "http://localhost:11434"
      }
    ]
  ]
}
```

환경 변수 또는 OpenCode의 연결 기능을 통해 자신의 API 키를 제공하고, **OpenCode를 완전히 종료한 뒤 재시작**하십시오. 설정 리로드는 플러그인 재생성과 같지 않습니다. 실제 키를 `opencode.json`에 넣지 마십시오.

루트와 `./server`는 V1 전용이며 다음 여섯 named 함수를 유지합니다: `connectorServer`, `claudeAuthServer`, `cursorAuthServer`, `commandCodeAuthServer`, `ollamaAuthServer`, `xaiAuthServer`. 이름을 유지한 Cursor·xAI 함수는 루트에서 비활성이고 인증 훅을 등록하지 않습니다. 활성 커넥터 인증 ID는 `claude`, `command-code`, `ollama`입니다.

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

V2는 선택한 호스트 연결의 `active`·`resolve`를 통해 API 키 또는 등록된 env 연결을 사용합니다. V1의 `auth.json`이나 관련 없는 프로세스 환경 변수로 fallback하지 않습니다. Ollama는 정확한 `cli-session:ollama` 마커와 선택한 데몬이 필요합니다. 마커는 API 키가 아닙니다.

다른 플러그인의 V2 호환성은 그 플러그인이 제공해야 합니다. 이 패키지가 다른 플러그인을 자동으로 V2에 맞춰 주지는 않습니다.

## 설정

| 옵션 | 기본값 | 의미 |
| --- | --- | --- |
| `providers` | `claude`, `command-code`, `ollama` | 엄격한 허용 목록. 명시적 `[]`는 모두 비활성화 |
| `ollamaBaseURL` | `http://localhost:11434` | 신뢰하는 데몬의 절대 HTTP·HTTPS base. 경로 prefix 보존 |
| `catalogReloadMs` | `300000` | 카탈로그 갱신 간격. `0`은 주기 갱신만 끄며 초기 갱신은 수행 |
| `snapshotTimeoutMs` | `30000` | 프로바이더별 스냅샷 기한 |
| `health.initialBackoffMs` | `1000` | 실패 후 초기 backoff |
| `health.maximumBackoffMs` | `60000` | backoff 상한 |

API 키·계정 세대가 달라지면 이전 계정의 모델·health 상태를 재사용하지 않습니다. V1 호스트에서 이미 캐시한 SDK 모델도 소유자 종료나 해당 계정 변경 후 거절됩니다. 새 모델·옵션이 활성 레지스트리에 반영되는 시점은 OpenCode의 정상 인스턴스 재생성을 따르며, 커넥터는 강제 재생성을 수행하지 않습니다.

## 호스트와 게스트

이 플러그인은 일반 데스크톱·호스트에서도, 컨테이너·VM·샌드박스 게스트에서도 같은 공식 연결 경로를 사용합니다. 샌드박스에만 맞춘 인증 방식이 아닙니다.

게스트는 자신의 `localhost`, HOME, 환경, 파일 권한, 네트워크를 가집니다. 해당 런타임의 secret 주입 기능이나 OpenCode의 보호된 API 키 저장소로 자신의 키를 제공하고, 별도의 writable persistent `XDG_DATA_HOME`을 설정하십시오. 공유 Claude·Cursor 구독 자격 증명 디렉터리를 mount하지 마십시오. OpenCode `auth.json`은 API 키를 담을 수 있으므로 secret 파일로 보호합니다.

호스트 Ollama 데몬을 사용할 때는 게스트의 `ollamaBaseURL`을 호스트 경로로 지정합니다.

```jsonc
{
  "plugin": [["opencode-ext-connector@0.8.0", {
    "providers": ["ollama"],
    "ollamaBaseURL": "http://host.docker.internal:11434"
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

독립 SDK에 명시적으로 제공한 API 키는 ambient 인증보다 우선합니다. 잘못된 명시적 값은 다른 자격 증명으로 조용히 전환하지 않습니다. 호스트가 소유하는 바인딩·계정 정보는 사용자 설정 옵션이 아닙니다.

업데이트할 때는 원하는 공개 버전을 확인하고 정확한 플러그인 spec으로 바꾼 후 완전히 재시작하십시오. 제거는 해당 플러그인 항목을 설정에서 삭제하고 재시작하면 됩니다. 캐시된 패키지는 설정되어 있지 않으면 비활성입니다.

모델이 없으면 API 키·계정의 API 권한·선택한 연결·데몬 가용성을 확인하십시오. 카탈로그 표시만으로 실제 생성 성공이나 모든 모델·툴 지원이 검증된 것은 아닙니다. 거절된 옛 정책 옵션 또는 Cursor 선택은 제거해야 합니다.

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

검사는 가짜 자격 증명·transport와 격리된 loopback 서버를 사용합니다. 기본 `bun test`는 V2 바이너리가 없으면 그 레인을 건너뛸 수 있으므로 명시적인 V2 레인을 별도로 수행해야 합니다. 이는 모든 벤더 계정의 라이브 성공을 검증했다는 의미가 아닙니다.

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
