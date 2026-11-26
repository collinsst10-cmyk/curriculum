/* =========================================================
 * 클라우드(Firebase) 연결 설정
 *  - Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹) 의 "firebaseConfig" 값을 붙여 넣으세요.
 *  - 이 값은 공개되어도 되는 식별 정보입니다. (보안은 firestore.rules 로 지킵니다)
 *  - null 로 두면 클라우드 없이 이 PC 저장 방식으로만 동작합니다.
 * ========================================================= */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyBBRB7IhqIuJ18wmlYKESOp1Jf1GxLg7Is",
  authDomain: "school-curriculum-478ba.firebaseapp.com",
  projectId: "school-curriculum-478ba",
  storageBucket: "school-curriculum-478ba.firebasestorage.app",
  messagingSenderId: "894003386419",
  appId: "1:894003386419:web:ac8f40c9670315079e2b46"
};

/* true: 관리자 승인을 받은 계정으로 로그인해야 메뉴를 쓸 수 있음
 * false: 로그인 없이도 이 PC 저장 모드로 사용 가능 (클라우드는 승인 사용자만) */
window.REQUIRE_LOGIN = true;

/* 예시:
window.FIREBASE_CONFIG = {
  apiKey: "AIza....",
  authDomain: "my-curriculum.firebaseapp.com",
  projectId: "my-curriculum",
  storageBucket: "my-curriculum.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef"
};
*/
