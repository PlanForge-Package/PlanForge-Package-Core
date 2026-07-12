# @figam-dev-variable-tools/design-kit

**Figma Dev Tools** 디자인 시스템의 React 컴포넌트 키트입니다. Figma 플러그인과 Storybook이 **같은 토큰(`tokens/*.json`)** 으로 만든 91개 컴포넌트를 npm으로 바로 가져다 씁니다.

- 🎨 **CSS 변수(`--ds-*`) 기반** — 프리셋(bootstrap · tailwind · toss) 전환을 `data-theme`으로
- 🪶 **런타임 의존 없음** — `styled-components`/`emotion` 불필요, `react`만 peer
- 🔁 **Figma ⇄ Storybook 100% 동기화** — [문서](https://figam-dev-variable-tools.github.io/Design-System-Hub-Tools/docs/)

## 설치

```bash
npm install @figam-dev-variable-tools/design-kit react react-dom
```

## 사용

`tokens.css`(디자인 토큰)와 `styles.css`(컴포넌트 스타일)를 앱 진입점에서 한 번만 import 하세요.

```tsx
import '@figam-dev-variable-tools/design-kit/tokens.css'
import '@figam-dev-variable-tools/design-kit/styles.css'
import { Button, Badge, TextField, Alert } from '@figam-dev-variable-tools/design-kit'

export function App() {
  return (
    <>
      <Button variant="primary" appearance="solid" size="md" label="시작하기" />
      <Button variant="primary" appearance="outline" size="md" label="더보기" />
      <Badge variant="success" appearance="soft" size="md" label="완료" />
      <Alert variant="warning" label="저장 공간이 부족해요." showIcon />
      <TextField label="이메일" placeholder="name@example.com" size="md" />
    </>
  )
}
```

## 프리셋(테마) 전환

`tokens.css`는 기본값으로 `:root`에 **bootstrap** 프리셋을 깔고, `data-theme`으로 전환할 수 있게 세 프리셋을 모두 포함합니다.

```html
<html data-theme="toss">  <!-- bootstrap | tailwind | toss -->
```

특정 프리셋 하나만 쓰려면 개별 파일을 import 하세요(이 경우 `:root`에 바로 적용됩니다):

```tsx
import '@figam-dev-variable-tools/design-kit/tokens/toss.css'
```

## 테마 커스터마이즈 — **선언된 변수만 덮어쓰면 끝**

모든 컴포넌트는 `--ds-*` **디자인 변수 위에** 만들어져 있습니다. 그래서 서비스 브랜드에 맞추려면 CSS 컴포넌트를 건드릴 필요 없이 **이미 선언된 변수 몇 개만 오버라이드**하면 Button·Badge·Alert·입력·링크까지 전부 한 번에 따라옵니다.

```css
/* app.css — tokens.css 다음에 로드 */
:root {
  --ds-color-primary: #ff5a5f;      /* 주요 버튼·강조·포커스링 전부 이 색으로 */
  --ds-color-success: #12b886;
  --ds-radius-md: 12px;             /* 버튼·입력 모서리 */
  --ds-font-family: 'Pretendard', system-ui, sans-serif;
}
```

즉, **프론트엔드에서는 이미 선언된 변수(토큰)와 컴포넌트 변형(prop)만 조합**하면 됩니다 — 색·타이포·간격·모서리는 `--ds-*` 변수로, 컴포넌트 형태는 `variant`·`appearance`·`size` 같은 선언된 prop 조합으로.

```tsx
// 선언된 변형(prop)만 조합 — 새 CSS 작성 불필요
<Button variant="primary"  appearance="solid"   size="lg" label="결제하기" />
<Button variant="secondary" appearance="outline" size="md" label="취소" />
<Badge  variant="warning"  appearance="soft"    size="sm" label="대기중" />
```

사용 가능한 변수 전체 목록은 배포된 `tokens.css`에, 컴포넌트별 변형 조합은 **[문서](https://figam-dev-variable-tools.github.io/Design-System-Hub-Tools/docs/)** 의 "변수 조합" 탭에서 실시간으로 확인할 수 있습니다.

## 컴포넌트

Button · Badge · Alert · TextField · Card · Checkbox · Toggle · Chip · Toast · Select · Modal · Dialog · Tabs · Avatar · Tooltip · Table · Calendar · DatePicker · Carousel · Accordion · Drawer · Rating · Skeleton · Kbd · Callout … 외 다수(한국형 KR 컴포넌트 포함). 전체 목록과 실시간 예제는 **[컴포넌트 문서](https://figam-dev-variable-tools.github.io/Design-System-Hub-Tools/docs/)** 를 참고하세요.

> 차트(Chart)는 `chart.js` 의존이 있어 이 키트에는 포함하지 않습니다.

## 타입

모든 컴포넌트의 prop 타입이 함께 배포됩니다(`XProps`).

```tsx
import type { ButtonProps, TextFieldProps } from '@figam-dev-variable-tools/design-kit'
```

## 라이선스

MIT
