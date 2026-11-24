# 조문희 포트폴리오

주문이 몰리는 순간에도 재고와 결제가 어긋나지 않는 커머스 백엔드를 지향하는 신입 백엔드 개발자 조문희의 포트폴리오입니다.

**사이트: <https://munhee777.github.io>**

## 첫 화면 시뮬레이션

남은 객실 6개에 100명이 동시에 예약을 누르는 상황을 브라우저에서 계산합니다.

- **분산 락 켜짐**: 요청이 락 대기열에 줄을 서고, 락을 쥔 요청 하나만 재고 확인과 차감을 한 번에 처리합니다. 항상 정확히 6건만 확정됩니다.
- **분산 락 꺼짐**: 재고 확인과 차감 사이에 다른 요청이 끼어들어 재고가 음수로 내려가고 초과 예약이 생깁니다.
- 로직(`js/sim-core.js`)과 그리기(`js/sim.js`)를 나눠서, 같은 로직을 Node에서 돌려 검증합니다.

```bash
node tests/sim-core.test.cjs
```

화면의 수치는 시뮬레이션입니다. 실제 k6 테스트 결과(남은 객실 6개, 가상 사용자 100명, 106건 중 6건 성공)는 문제 해결 기록에 적었습니다.

## 구조

| 경로 | 설명 |
| --- | --- |
| `index.html` | 페이지 전체 |
| `css/style.css` | 스타일. 색과 서체 토큰은 맨 위 `:root`에 있습니다 |
| `js/sim-core.js` | 동시 예약 시뮬레이션 로직 (브라우저와 Node 공용) |
| `js/sim.js` | 시뮬레이션 캔버스 그리기와 조작 |
| `js/motion.js` | GSAP·Lenis 모션: 첫 화면 등장, 성능 개선 과정 스크롤 재생, 티켓 인쇄 효과 |
| `js/main.js` | 모션과 상관없이 동작하는 부분: 헤더, 아코디언, 탭, 처리량 격자 |
| `assets/img/` | 제주 야호 이미지와 설계 자료 |
| `tests/` | 시뮬레이션 로직 테스트 |

## 로컬에서 보기

빌드 과정 없이 정적 파일로 동작합니다.

```bash
python3 -m http.server 8000
```

이후 <http://localhost:8000>을 엽니다.

## 사용한 오픈소스

**라이브러리** (CDN, 버전 고정과 SRI 해시 적용)

- [GSAP](https://gsap.com) 3.15.1: ScrollTrigger, SplitText, ScrambleTextPlugin (GreenSock Standard License, 무료)
- [Lenis](https://github.com/darkroomengineering/lenis) 1.3.28: 부드러운 스크롤 (MIT)
- 서체: [Wanted Sans](https://github.com/wanteddev/wanted-sans), [Big Shoulders Display](https://fonts.google.com/specimen/Big+Shoulders+Display), [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (모두 OFL)

**만들 때 따른 AI 에이전트 스킬**

- [greensock/gsap-skills](https://github.com/greensock/gsap-skills): GSAP 공식 스킬. 플러그인 등록, `matchMedia`로 움직임 줄이기 대응, 타임라인과 ScrollTrigger 규칙, 성능 규칙
- [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): 포트폴리오 유형 추천(Motion-Driven + Minimalism), 스크롤 스토리텔링 구성, 모션 프리셋(고정 구간은 1~2개, 자석 효과는 화면당 1~2개)
- [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)의 frontend-design: 디자인 계획과 템플릿처럼 보이는 요소 점검

## 채울 곳

- `index.html`의 `TODO(조문희)`: 진행 중인 AI 역량평가 프로젝트의 설명, 역할, 기술, 링크
