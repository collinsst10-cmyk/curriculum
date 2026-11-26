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
| `haksa.js` | 학교 공용 학사일정(`calendar/{학년도}`) 동기화, 학교 정보(`config/school`) 공유 |
| `menus.js` | 화면 묶기: 학사일정 보기(선생님), 교육과정 편성 ①학사일정 ②교내행사 ③시수 배정 |
| `schedule.js` | 학급별 시간표 배치 |
| `kclass.js` | 한국어학급 1~3 주간 시간표. 지정 담임 또는 관리자가 편집 |
| `home.js` | HOME의 학교운영일지 보기(조회 전용)와 이번 달 학사일정 넘기기 |
| `status.js` | 학교 현황(학생·교직원·이주배경학생) 편집 화면과 HOME의 '우리 학교 현황' |
| `log.js` | 학교 일지 작성(관리자·교무부장)과 교무부장(일지 작성자) 지정 |
| `transfer.js` | 학생 전입·전출 등록(관리자·교무부장), 학생 현황 인원 자동 반영, HOME 알림 |

역할: **관리자** = 교육과정 편성·시간표 편성·자료 관리·관리자 메뉴 / **선생님** = HOME·학사일정(조회)·교육활동 일정(신청)·한국어 학급. 관리자는 상단 `👀 선생님 화면 보기`로 선생님 화면을 미리 볼 수 있습니다(이 창에서만, 데이터는 그대로).
| `assets/` | 학교 로고(`logo.png`), 엠블럼 아이콘(`emblem.png`) |
| `firestore.rules` | Firestore 보안 규칙 (Firebase 콘솔 > Firestore > 규칙 에 게시해야 적용됨) |
| `deploy.ps1`, `배포하기.cmd` | 로컬 폴더의 파일을 이 저장소로 올리는 배포 스크립트 |
| `클라우드_설정_안내.md` | Firebase·GitHub Pages 설정과 운영 안내 |

스크립트 로드 순서: `data.js → app.js → features.js → cloud-config.js → cloud.js → activities.js → haksa.js → menus.js → schedule.js → kclass.js → home.js → status.js → log.js → transfer.js` (모두 일반 `<script>`, 전역 함수·상태 공유)

## Firestore 데이터 구조

| 경로 | 내용 |
|---|---|
| `admins/{email}` | 관리자 (콘솔에서만 추가) |
| `allowed/{email}` | 승인된 사용자 `{ email, name, addedBy, addedAt }` — `name`이 일정 기록자 이름 |
| `requests/{email}` | 사용 승인 요청 `{ email, name, requestedAt }` |
| `plans/{id}` | 교육과정 문서 `{ ownerUid, ownerEmail, editors[], title, year, stateJson }` |
| `activityDays/{YYYY-MM-DD}` | 날짜별 교육활동 `{ items: [ { id, date, kind, title, periods[], targets["3-1"...], status, ownerName, kslAdjust } ] }` |
| `config/ksl` | 한국어학급 주간 시간표 `{ slots: { "요일-교시": { group, targets[] } }, teachers[] }` |
| `kclassOwners/{1-3}`, `kclassTimetables/{1-3}` | 한국어학급 담임 지정 `{ email }`, 주간 시간표 `{ slots }` |
| `dailyLogs/{YYYY-MM-DD}` | 학교운영일지 `{ text, by, byName, updatedAt }` — 승인된 선생님 읽기, 관리자·교무부장 작성 |
| `config/roles` | `{ logWriters: [email] }` 교무부장(일지 작성자). 관리자만 지정 |
| `config/stats` | 학생 현황·교직원 현황 `{ asOf, students:{byClass:{"학년-반":{m,f}}, male[], female[]}, staff:{m,f} }` — 관리자·교무부장 수정. 반 수는 학교 정보의 학급 수 |
| `transfers/{id}` | 전입·전출 `{ date, type:in/out, grade, cls, sex, note, applied }` (학생 이름 없음) — 관리자·교무부장 등록·삭제 |
| `config/migrant` | 이주배경학생 현황 `{ asOf, foreign, domestic, midEntry, nonMigrant, countries, note }` — 관리자·한국어학급 담당 수정 |

겹침 규칙: 같은 날 + 교시가 겹치고 + 대상 학급이 겹치면 등록 불가 (취소 제외). 등록·수정은 `runTransaction`으로 처리해 동시 신청을 막습니다.

## 로컬에서 실행

`index.html`을 브라우저로 열면 동작합니다. 구글 로그인(Firebase)은 `http://localhost` 또는 배포 주소에서만 됩니다.

## 함께 작업하는 방법 (Claude · ChatGPT · 사람)

학교 PC의 프로젝트 폴더가 이 저장소의 작업 사본(`main` 브랜치)이고, 양방향으로 동기화합니다.

| 하고 싶은 일 | 방법 |
|---|---|
| GitHub의 새 변경(예: ChatGPT가 커밋한 것)을 학교 PC로 가져오기 | `가져오기.cmd` 더블클릭 (= `deploy.ps1 -PullOnly`) |
| 학교 PC에서 고친 것을 올리고 사이트에 배포 | `배포하기.cmd` 더블클릭 (= 커밋 → GitHub 변경 합치기 → 푸시) |
| ChatGPT 등 다른 곳에서 작업 | `main` 브랜치에 커밋하거나 PR을 만들어 `main`에 합치기 |

- 배포 전에 항상 GitHub의 변경을 먼저 가져와 합치므로, 다른 곳에서 한 작업이 덮어써지지 않습니다.
- 같은 파일의 같은 줄을 양쪽에서 동시에 고치면 자동으로 합치지 않고 멈춥니다(파일은 그대로). 이때는 충돌을 직접 해결해야 합니다.
- `main`에 올라간 내용은 1~2분 뒤 사이트에 바로 반영됩니다. 확인되지 않은 실험은 별도 브랜치에서 하세요.

## 주의

- **보안 규칙(`firestore.rules`)을 바꾸면 Firebase 콘솔에 직접 게시**해야 적용됩니다. 파일만 바꿔서는 반영되지 않습니다.
- 학생 개인정보(이름 등)를 저장하는 기능은 넣지 않습니다.
- `cloud-config.js`의 값은 공개되어도 되는 Firebase 웹 설정입니다. 비밀번호·토큰 같은 비밀 값은 저장소에 넣지 않습니다.
