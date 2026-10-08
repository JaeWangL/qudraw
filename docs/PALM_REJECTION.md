# 손바닥과 Pencil 동시 입력의 복구

2026-10-08 사용자가 iPad에서 필기 중 갑자기 글이 써지지 않는 현상을 보고했습니다. PC에서는 재현되지 않았고 손바닥과 펜의 동시 접촉을 의심했습니다. 이 문서는 코드에서 확인한 경로와 실제 기기에서 추가 확인할 부분을 구분합니다.

## 확인한 결함

실험실은 측정용 `InkRecorder`에 이전 입력의 ID가 남아 있으면 다른 ID의 pointerdown을 차단했습니다. pointerup/cancel 유실이나 엔진의 자체 복구와 기록기 상태가 어긋나면, 다음 Pencil 접촉이 엔진에 도달하기 전에 막힙니다. 기록용 상태가 실제 필기 허용 여부를 결정한 것이 문제입니다.

엔진에도 notebook에서 손바닥 접촉이 먼저 들어와 gesture map에 남으면 이후 펜을 다중 입력으로 취급하고 시작을 차단할 수 있는 경로가 있었습니다. 기존 보호는 이미 펜으로 쓰는 도중 들어오는 손바닥에만 적용됐습니다. 이 엔진 경로의 직접 재현과 실험실 기본값인 Pencil-only의 영향은 구분해야 합니다.

Safari 계열에서는 PointerEvent 외에 TouchEvent·GestureEvent가 같은 동작에서 발생할 수 있어 이 경로도 분리해야 합니다. 다만 기존 native touchstart의 double-tap 처리는 freedraw에서 즉시 종료하므로, 이것만으로 숨겨진 텍스트 편집기가 열렸다고 단정할 수 없습니다. `removePointer` 역시 해당 ID만 제거하며 임의의 펜 획을 종료시키는 함수가 아닙니다.

## 처리 원칙

- 기록기는 관측만 담당합니다. 기록기의 오래된 상태가 새 Pencil 입력을 거절하지 않습니다.
- 새로운 Pencil pointerdown은 이전의 종료되지 않은 접촉을 정리하고 독립된 획으로 시작합니다.
- 손바닥은 진행 중인 Pencil 획을 종료하거나 이동·확대 동작으로 바꾸지 않습니다.
- iOS의 첫 native touchstart에서 기존 Scribble 방지 처리를 먼저 적용한 뒤 legacy 제스처 경로를 분리합니다. stylus도 예외로 빼지 않습니다. iPadOS의 데스크톱 사용자 에이전트도 인식합니다.
- notebook의 기본값에서는 손가락 필기를 허용하지 않습니다. 실험실의 손가락 허용 옵션은 명시적으로 전달합니다.
- pointerup, pointercancel, lostpointercapture, 창 이탈·숨김을 구분하고 이후 새 획을 받을 수 있게 정리합니다.
- 멈춤 진단은 획 경계·거절 사유·취소·복구 횟수를 제한된 메모리에 기록합니다. 매 이동마다 React 상태 갱신이나 JSON 직렬화를 하지 않습니다.
- pressure·선 보정 등 사용자가 선호한 notebook 프로필의 모양은 유지합니다.

## 회귀 확인 시나리오

1. 손바닥을 먼저 대고 Pencil로 여러 획을 쓴다.
2. Pencil로 쓰는 중 손바닥을 대거나 떼어도 획을 계속 쓸 수 있다.
3. 손바닥을 올린 채 Pencil만 반복해서 뗐다가 다시 쓴다.
4. 이전 획의 up을 받지 못하고 다른 pointerId로 새 down이 와도 다시 쓸 수 있다.
5. 뒤늦게 도착한 이전 접촉의 up/cancel이 새 획을 끝내지 않는다.
6. TouchEvent, GestureEvent, PointerEvent가 함께 발생해도 확대율·위치와 필기 도구가 바뀌지 않는다.
7. 앱 전환·브라우저 탭 전환·capture 유실 이후 새 획을 정상적으로 시작한다.
8. 기존 classic 동작, notebook 저장·복기 외형, 점·지우개·되돌리기를 보존한다.

자동 테스트와 데스크톱 브라우저 검사는 이러한 상태 전이를 검증합니다. 실제 iPad에서 브라우저가 이벤트를 누락하는지, 문제가 완전히 사라졌는지는 사용자 기기 재시험이 필요합니다. OS가 입력 이벤트 자체를 전달하지 않는 상황을 JavaScript의 정상 동작만으로 복구했다고 주장하지 않습니다.

실험실의 `기록 · 느낌` 패널과 JSON 내보내기에 `palm-recovery-v2`가 표시됩니다. 내보낸 `inputDiagnostics`에는 입력 종류별 down 수, 허용·차단 수와 사유, 복구 횟수, 시작 없이 들어온 펜 이동, 늦은 종료 신호, 마지막 256개 경계 판단을 포함합니다. 이 기록은 사용자가 직접 내보내기 전까지 브라우저 메모리에만 있습니다.

## 2026-10-08 확인 결과

- 필기 엔진 33개, iPad/iPadOS 데스크톱 UA 2개, 입력 제어·기록기 25개로 총 60개 회귀 테스트 통과.
- 루트·실험실 TypeScript 검사, 변경된 TS/TSX ESLint, 실험실 프로덕션 빌드 통과.
- Chrome의 CDP 입력으로 손바닥 접촉을 유지한 상태의 연속 8획과, 필기 도중 두 터치를 추가한 1획이 각각 독립된 획으로 남는 것을 확인. 이는 iPad 하드웨어 입력 시험을 대체하지 않습니다.
- 지우개 브라우저 확인 중 창 blur가 관측되어 해당 동작은 중단 처리됐습니다. 지우개 소유권·취소·복구 검증은 자동 테스트를 근거로 합니다.

## 참고

Pointer Events의 `isPrimary`는 입력 종류별 기준입니다. 손가락과 펜이 동시에 primary일 수 있으므로 이 값만으로 손바닥을 배제할 수 없습니다. [W3C Pointer Events §4.1.2](https://www.w3.org/TR/pointerevents3/#the-primary-pointer)

Excalidraw는 Apple Pencil 획이 빠지는 Scribble 문제를 iOS touchstart의 `preventDefault()`를 첫 분기보다 앞에 적용하는 방식으로 수정했습니다. 이번 분리에서도 그 처리를 보존합니다. [원본 수정 #4705](https://github.com/excalidraw/excalidraw/pull/4705), [증상 보고 #3502](https://github.com/excalidraw/excalidraw/issues/3502)
