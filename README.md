# qudraw

Apple Pencil과 태블릿 필기를 개선한 React 드로잉 컴포넌트입니다. Excalidraw 0.18.1을 기반으로 하며, 독립적인 저장소와 npm 패키지 `qudraw`로 배포합니다. 원본 MIT 라이선스와 폰트 저작권을 유지합니다. 정확한 출처는 [UPSTREAM.json](./UPSTREAM.json)에 있습니다.

## 설치와 사용

```sh
npm install qudraw react react-dom
```

```tsx
import { QuDraw } from "qudraw";
import "qudraw/index.css";

export function DrawingCanvas() {
  return (
    <div style={{ width: "100%", height: 600 }}>
      <QuDraw handwritingMode="notebook" notebookTouchEnabled={false} />
    </div>
  );
}
```

`notebook` 모드는 획 보정을 줄이고 펜 접촉마다 획을 분리합니다. 손바닥 입력을 펜·지우개 입력과 분리하며, 이전 접촉의 종료 신호를 놓친 경우 다음 펜 입력에서 복구합니다. 기본값은 기존 렌더링과 호환되는 `classic`입니다. `Excalidraw` 이름의 컴포넌트와 기존 장면 API도 계속 사용할 수 있습니다.

Next.js에서는 클라이언트 컴포넌트 안에서 `dynamic(..., { ssr: false })`로 불러오세요. 높이가 지정된 컨테이너가 필요합니다. [전체 사용법 / English package guide](./npm/qudraw/README.md)에 Next.js 예제, 타입, 폰트 자체 호스팅 방법을 설명합니다.

## 실행

Node.js 22와 Yarn 1.22.22를 사용합니다.

```sh
yarn install --frozen-lockfile
yarn lab
```

Node/Yarn이 설치되어 있지 않은 개발 환경에서는 다음과 같이 실행할 수도 있습니다.

```sh
npm exec --yes --package=node@22 --package=yarn@1.22.22 -- yarn lab
```

실험 화면은 `http://localhost:4174`입니다. 같은 Wi-Fi의 태블릿에서는 개발 머신의 LAN 주소와 포트 4174로 접속합니다. 공개 서비스에 배포하는 명령은 아닙니다.

필기감 비교에는 개발 서버보다 프로덕션 빌드를 권장합니다. 개발 서버를 종료한 뒤 다음을 실행합니다.

```sh
yarn build:lab
yarn preview:lab
```

## 필기 비교 실험

- 동일한 Excalidraw 엔진의 기존 필기와 `notebook` 필기를 비교합니다.
- 보정으로 발생하는 공간적 뒤처짐, 이벤트 처리 지연, 획의 분리를 각각 확인합니다.
- 사용자가 내보내기를 누를 때만 측정 자료를 JSON 파일로 내려받습니다. 서버 수집·분석 모델 호출은 없습니다.
- 실험 결과를 실제 진단평가 서비스에 적용하기 전에는 저장 이미지·영상 복기·기존 필기 데이터의 호환성을 별도로 검증해야 합니다.

[실험 기준과 사용자 확인 절차](./docs/HANDWRITING_EXPERIMENT.md)를 먼저 읽어 주세요. 브라우저 내부의 시간 기록은 물리적인 펜 접촉부터 화면에 빛이 나타나는 시간과 다릅니다.

iPad에서 입력이 간헐적으로 멈추는 문제의 수정과 재시험 기준은 [손바닥·Pencil 동시 입력 복구](./docs/PALM_REJECTION.md)에 기록합니다.

## 검증

```sh
yarn test:typecheck
yarn tsc --project examples/ink-lab/tsconfig.json
yarn test:ink
yarn build:lab
```

필기 관련 테스트와 측정의 의미는 실험 문서에 기록합니다. 원본의 일반 화이트보드 앱은 `yarn start:upstream`으로 실행할 수 있으며, 필기 비교 실험에는 `yarn lab`을 사용합니다.

## npm 패키지 빌드

```sh
yarn build:npm
yarn pack:npm
yarn test:npm
yarn test:npm-consumer
```

배포 대상은 `dist/npm/qudraw`에 생성되는 `qudraw` 패키지입니다. 타입·스타일·폰트와 라이선스가 함께 들어갑니다. `@excalidraw/*` 내부 워크스페이스는 소스 호환성을 위해 이름을 유지하고 비공개로 설정합니다. 해당 이름으로 게시하지 않습니다.

원본의 배포·릴리스 워크플로는 `.github/upstream-workflows-disabled`에 보관했으며 실행되지 않습니다. 공개 소스는 [JaeWangL/qudraw](https://github.com/JaeWangL/qudraw)에서 관리합니다.

## 출처

- [Excalidraw](https://github.com/excalidraw/excalidraw), MIT — [LICENSE](./LICENSE)
- [원본 README](./docs/UPSTREAM_README.md)
