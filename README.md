# 용원초등학교 교육과정 편성 도우미

초등학교 학교교육과정 편성(학사일정·수업일수·시수 배정·시간표·편제표)과 교육활동 일정(외부강의·교내행사, 한국어학급 연계)을 관리하는 웹 프로그램입니다.

- 사이트: https://collinsst10-cmyk.github.io/curriculum/
- 호스팅: GitHub Pages (`main` 브랜치, 최상위 폴더)
- 데이터: Firebase Authentication(구글 로그인) + Cloud Firestore
- 빌드 도구 없음: 순수 HTML/CSS/JavaScript (프레임워크·번들러 없음)

## 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 골격. 상단 메뉴(HOME·교육과정 편성·시간표 편성·교육활동 일정·자료 관리·관리자)와 각 화면 섹션 |
| `style.css` | 전체 스타일. 학교 색(남색 `--navy`, 파랑 `--primary`, 금색 `--gold`) |
| `data.js` | 기준 데이터: 2022 개정 교육과정 시간 배당(학년군·교과군 기준 시수), 학년도별 공휴일 |
| `app.js` | 핵심 상태(`state`)·저장(localStorage)·화면 전환(`showTab`)·학사일정·수업일수·시수 배정·편제표·검토 |
| `features.js` | 주차표, 기초 시간표(자동 편성), 시수 운영 확인(연간 시수표), 교과전담 |
| `cloud-config.js` | Firebase 웹 설정값(공개되어도 되는 값), `REQUIRE_LOGIN` |
| `cloud.js` | 구글 로그인, 관리자 승인(가입·이름 등록), 교육과정 문서 클라우드 저장·공유·실시간 동기화, 관리자 화면 |
| `activities.js` | 교육활동 일정(신청/확정/취소), 겹침 방지 트랜잭션, 한국어학급 시간표 연계·담당 교사 알림 |
| `assets/` | 학교 로고(`logo.png`), 엠블럼 아이콘(`emblem.png`) |
| `firestore.rules` | Firestore 보안 규칙 (Firebase 콘솔 > Firestore > 규칙 에 게시해야 적용됨) |
| `deploy.ps1`, `배포하기.cmd` | 로컬 폴더의 파일을 이 저장소로 올리는 배포 스크립트 |
| `클라우드_설정_안내.md` | Firebase·GitHub Pages 설정과 운영 안내 |

스크립트 로드 순서: `data.js → app.js → features.js → cloud-config.js → cloud.js → activities.js` (모두 일반 `<script>`, 전역 함수·상태 공유)

## Firestore 데이터 구조

| 경로 | 내용 |
|---|---|
| `admins/{email}` | 관리자 (콘솔에서만 추가) |
| `allowed/{email}` | 승인된 사용자 `{ email, name, addedBy, addedAt }` — `name`이 일정 기록자 이름 |
| `requests/{email}` | 사용 승인 요청 `{ email, name, requestedAt }` |
| `plans/{id}` | 교육과정 문서 `{ ownerUid, ownerEmail, editors[], title, year, stateJson }` |
| `activityDays/{YYYY-MM-DD}` | 날짜별 교육활동 `{ items: [ { id, date, kind, title, periods[], targets["3-1"...], status, ownerName, kslAdjust } ] }` |
| `config/ksl` | 한국어학급 주간 시간표 `{ slots: { "요일-교시": { group, targets[] } }, teachers[] }` |

겹침 규칙: 같은 날 + 교시가 겹치고 + 대상 학급이 겹치면 등록 불가 (취소 제외). 등록·수정은 `runTransaction`으로 처리해 동시 신청을 막습니다.

## 로컬에서 실행

`index.html`을 브라우저로 열면 동작합니다. 구글 로그인(Firebase)은 `http://localhost` 또는 배포 주소에서만 됩니다.

## 함께 작업할 때 주의

- **보안 규칙(`firestore.rules`)을 바꾸면 Firebase 콘솔에 직접 게시**해야 적용됩니다. 파일만 바꿔서는 반영되지 않습니다.
- 학생 개인정보(이름 등)를 저장하는 기능은 넣지 않습니다.
- `deploy.ps1`은 로컬 폴더의 파일로 저장소를 덮어씁니다. GitHub에서 직접 고친 내용이 있으면, 배포 전에 로컬 폴더에 먼저 반영해야 합니다.
