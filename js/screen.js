// ============================================================================
// 대형 스크린 / 프로젝터 전용 스크립트 (screen.js)
// 1. 문제 출제 및 대형 A vs B 선택지 & 실시간 카운트다운 타이머
// 2. 제한시간 종료 시 다수 의견 대형 팝업 모달
// 3. 게임 완료 시 1위~10위 명예의 전당 (Top 10 Leaderboard)
// 4. Firebase Firestore + BroadcastChannel 실시간 듀얼 동기화
// ============================================================================

let db = null;
let roomUnsubscribe = null;
let participantsUnsubscribe = null;
let votesUnsubscribe = null;
let localBroadcast = null;

// 대형 스크린 전역 상태
const screenState = {
  roomId: "default",
  currentView: "standby", // 'standby' | 'voting' | 'final'
  soundEnabled: true,
  currentRoundKey: "",
  timerInterval: null,
  duration: 15,
  startedAt: null,
  connectedParticipants: new Map(), // nickname -> { nickname, joinedAt }
  roundVotes: new Map(), // nickname -> { option, votedAt }
  historyRounds: [],
  lastResetAt: 0,
  currentQuestion: null
};

// Web Audio API 효과음 엔진 (외부 오디오 파일 없이 100% 브라우저 내장 합성)
const ScreenSound = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  },
  playTick(isUrgent = false) {
    if (!screenState.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      const freq = isUrgent ? 880 : 540;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.06);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.06);
    } catch (e) {}
  },
  playFanfare() {
    if (!screenState.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const startTime = this.ctx.currentTime + (idx * 0.1);
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.2, startTime);
        gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.35);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.35);
      });
    } catch (e) {}
  },
  playGrandVictory() {
    if (!screenState.soundEnabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const melody = [
        { f: 523.25, d: 0.15 }, // C5
        { f: 659.25, d: 0.15 }, // E5
        { f: 783.99, d: 0.15 }, // G5
        { f: 1046.50, d: 0.45 }, // C6
        { f: 880.00, d: 0.15 }, // A5
        { f: 1046.50, d: 0.70 }  // C6
      ];
      let t = this.ctx.currentTime;
      melody.forEach((note) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(note.f, t);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + note.d);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(t);
        osc.stop(t + note.d);
        t += note.d * 0.9;
      });
    } catch (e) {}
  }
};

// 페이지 초기화
window.addEventListener("DOMContentLoaded", () => {
  initScreenDashboard();
});

function initScreenDashboard() {
  // 1. 방 코드 추출 (URL 파라미터 우선 ?room=xxx)
  const urlParams = new URLSearchParams(window.location.search);
  const queryRoom = urlParams.get("room");
  if (queryRoom) {
    screenState.roomId = queryRoom.trim();
    localStorage.setItem("balance_room_id", screenState.roomId);
  } else {
    screenState.roomId = getRoomId();
  }

  // 상단 방 코드 표시
  const roomBadge = document.getElementById("screenRoomBadge");
  if (roomBadge) roomBadge.textContent = screenState.roomId;

  // 2. 대기 화면 정보(QR 코드 & 링크) 갱신
  updateStandbyInfo();

  // 3. Firebase 및 실시간 리스너 연결
  db = initFirebase();
  setupScreenRealtimeListeners();

  // 4. 로컬 BroadcastChannel 연결
  setupLocalBroadcast();

  // 5. 초기 화면은 대기 화면으로 설정
  switchView("standby");
}

// 대기 화면 QR 코드 및 참가자 링크 생성
function updateStandbyInfo() {
  const roomText = document.getElementById("standbyRoomCodeText");
  if (roomText) roomText.textContent = screenState.roomId;

  const roomBadge = document.getElementById("screenRoomBadge");
  if (roomBadge) roomBadge.textContent = screenState.roomId;

  // 참가자 페이지 URL 생성
  let currentOrigin = window.location.origin;
  if (!currentOrigin || currentOrigin === "null") {
    currentOrigin = window.location.href.split("/screen.html")[0];
  }
  let basePath = window.location.pathname.replace("screen.html", "index.html");
  if (!basePath.startsWith("/")) basePath = "/" + basePath;

  const participantUrl = `${currentOrigin}${basePath}?room=${encodeURIComponent(screenState.roomId)}`;

  const linkEl = document.getElementById("standbyLinkText");
  if (linkEl) linkEl.textContent = participantUrl;

  // QR 코드 이미지 설정 (QRServer API)
  const qrImg = document.getElementById("standbyQrImg");
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(participantUrl)}`;
    qrImg.onerror = () => {
      // 이미지 로드 실패 시 대체 텍스트 처리
      qrImg.style.display = "none";
      if (linkEl) linkEl.classList.add("bg-sky-50", "border-sky-300", "font-bold");
    };
  }
}

// 화면 전환 헬퍼 ('standby' | 'voting' | 'final')
function switchView(viewName) {
  screenState.currentView = viewName;

  const viewStandby = document.getElementById("viewStandby");
  const viewQuestion = document.getElementById("viewQuestion");
  const viewFinal = document.getElementById("viewFinal");

  if (viewStandby) viewStandby.classList.toggle("hidden", viewName !== "standby");
  if (viewQuestion) viewQuestion.classList.toggle("hidden", viewName !== "voting");
  if (viewFinal) viewFinal.classList.toggle("hidden", viewName !== "final");

  // 문제 출제 화면이 아니면 결과 모달 닫기
  if (viewName !== "voting") {
    closeMajorityModal();
  }
}

// ============================================================================
// 실시간 이벤트 리스너 (Firebase Firestore & BroadcastChannel)
// ============================================================================
function setupScreenRealtimeListeners() {
  if (!db) {
    const badge = document.getElementById("screenConnectionBadge");
    if (badge) {
      badge.className = "px-3 py-1.5 text-xs rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5 font-bold shadow-xs";
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>로컬 모드</span>`;
    }
    return;
  }

  try {
    if (roomUnsubscribe) roomUnsubscribe();
    if (participantsUnsubscribe) participantsUnsubscribe();
    if (votesUnsubscribe) votesUnsubscribe();

    const roomRef = db.collection("rooms").doc(screenState.roomId);

    // 1. 방 메인 문서 리스너
    roomUnsubscribe = roomRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const data = doc.data();
      handleRoomStateFromFirestore(data);
    }, (err) => console.warn("Screen room snapshot error:", err));

    // 2. 참가자 서브컬렉션 리스너 (대기실 명단 및 총 인원 수)
    participantsUnsubscribe = roomRef.collection("participants").onSnapshot((snapshot) => {
      screenState.connectedParticipants.clear();
      snapshot.forEach((d) => {
        const p = d.data();
        if (p && p.nickname && p.kicked !== true) {
          screenState.connectedParticipants.set(p.nickname, {
            nickname: p.nickname,
            joinedAt: p.lastActive || Date.now()
          });
        }
      });
      renderStandbyParticipants();
      updateLiveGauge();
    }, (err) => console.warn("Screen participants snapshot error:", err));

    // 3. 투표 서브컬렉션 리스너 (실시간 투표 완료 인원)
    votesUnsubscribe = roomRef.collection("votes").onSnapshot((snapshot) => {
      screenState.roundVotes.clear();
      snapshot.forEach((d) => {
        const v = d.data();
        if (v && v.nickname && v.option) {
          screenState.roundVotes.set(v.nickname, {
            option: v.option,
            votedAt: v.votedAt || Date.now()
          });
        }
      });
      updateLiveGauge();
    }, (err) => console.warn("Screen votes snapshot error:", err));

    // 연결 배지 초록색 갱신
    const badge = document.getElementById("screenConnectionBadge");
    if (badge) {
      badge.className = "px-3 py-1.5 text-xs rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 font-bold shadow-xs";
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>연결됨</span>`;
    }
  } catch (err) {
    console.error("Screen setup listeners error:", err);
  }
}

// 로컬 BroadcastChannel 설정
function setupLocalBroadcast() {
  try {
    if (window.BroadcastChannel) {
      localBroadcast = new BroadcastChannel("balance_game_channel");
      localBroadcast.onmessage = (e) => {
        const data = e.data;
        if (!data) return;
        const payload = data.payload || data;
        handleIncomingScreenEvent(payload);
      };
    }
  } catch (err) {
    console.warn("Screen BroadcastChannel warning:", err);
  }
}

// Firestore 데이터 수신 처리
function handleRoomStateFromFirestore(roomData) {
  if (!roomData || !roomData.status) return;

  // 방 코드 변경 이벤트
  if (roomData.status === "room_changed" && roomData.newRoom && roomData.newRoom !== screenState.roomId) {
    screenState.roomId = roomData.newRoom;
    localStorage.setItem("balance_room_id", roomData.newRoom);
    updateStandbyInfo();
    setupScreenRealtimeListeners();
    return;
  }

  // 호스트가 전체 초기화한 경우
  if (roomData.resetAt && roomData.resetAt > (screenState.lastResetAt || 0)) {
    screenState.lastResetAt = roomData.resetAt;
    onResetGameScreen();
    return;
  }

  if (roomData.status === "voting") {
    const roundKey = `${roomData.startedAt}_${roomData.currentQuestion ? roomData.currentQuestion.id : ""}`;
    if (screenState.currentRoundKey !== roundKey) {
      screenState.currentRoundKey = roundKey;
      closeMajorityModal();
      onRoundStarted({
        roundIndex: roomData.roundIndex || 1,
        totalRounds: roomData.totalRounds || 10,
        question: roomData.currentQuestion,
        duration: roomData.duration || 15,
        startedAt: roomData.startedAt || Date.now()
      });
    }
  } else if (roomData.status === "result") {
    if (roomData.resultSummary) {
      onResultsReceived(roomData.resultSummary);
    }
  } else if (roomData.status === "waiting") {
    closeMajorityModal();
    if (screenState.currentView !== "standby") {
      switchView("standby");
    }
  } else if (roomData.status === "final") {
    closeMajorityModal();
    if (roomData.finalSummary) {
      showFinalLeaderboard(roomData.finalSummary);
    }
  }
}

// 로컬 BroadcastChannel 이벤트 처리
function handleIncomingScreenEvent(payload) {
  if (!payload || !payload.event) return;

  if (payload.event === "ROOM_CODE_CHANGED" && payload.newRoom && payload.newRoom !== screenState.roomId) {
    screenState.roomId = payload.newRoom;
    localStorage.setItem("balance_room_id", payload.newRoom);
    updateStandbyInfo();
    setupScreenRealtimeListeners();
    return;
  }

  if (payload.event === "RESET_GAME") {
    onResetGameScreen();
    return;
  }

  if (payload.event === "START_ROUND") {
    closeMajorityModal();
    onRoundStarted(payload);
  } else if (payload.event === "SHOW_RESULTS") {
    onResultsReceived(payload);
  } else if (payload.event === "FINAL_RESULTS") {
    closeMajorityModal();
    showFinalLeaderboard(payload);
  } else if (payload.event === "RESET_ROUND") {
    closeMajorityModal();
    switchView("standby");
  } else if (payload.event === "JOIN" && payload.nickname) {
    screenState.connectedParticipants.set(payload.nickname, {
      nickname: payload.nickname,
      joinedAt: payload.timestamp || Date.now()
    });
    renderStandbyParticipants();
    updateLiveGauge();
  } else if (payload.event === "VOTE" && payload.nickname && payload.option) {
    screenState.roundVotes.set(payload.nickname, {
      option: payload.option,
      votedAt: payload.votedAt || Date.now()
    });
    updateLiveGauge();
  }
}

// 전체 초기화 처리
function onResetGameScreen() {
  if (screenState.timerInterval) {
    clearInterval(screenState.timerInterval);
    screenState.timerInterval = null;
  }
  screenState.connectedParticipants.clear();
  screenState.roundVotes.clear();
  screenState.historyRounds = [];
  closeMajorityModal();
  renderStandbyParticipants();
  updateLiveGauge();
  switchView("standby");
}

// 대기실 참가자 명단 렌더링
function renderStandbyParticipants() {
  const badge = document.getElementById("standbyParticipantCountBadge");
  const list = document.getElementById("standbyParticipantsList");
  if (!badge || !list) return;

  const count = screenState.connectedParticipants.size;
  badge.textContent = `총 ${count}명`;

  if (count === 0) {
    list.innerHTML = `<span class="text-xs text-slate-400 w-full text-center py-2">아직 접속한 참가자가 없습니다.</span>`;
    return;
  }

  list.innerHTML = "";
  screenState.connectedParticipants.forEach((p) => {
    const chip = document.createElement("span");
    chip.className = "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-white text-slate-800 border border-slate-200 shadow-xs";
    chip.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
      <span>${escapeHtml(p.nickname)}</span>
    `;
    list.appendChild(chip);
  });
}

// ============================================================================
// 1. 문제 출제 및 실시간 카운트다운 타이머
// ============================================================================
function onRoundStarted(data) {
  screenState.currentQuestion = data.question;
  screenState.duration = data.duration || 15;
  screenState.startedAt = data.startedAt || Date.now();
  screenState.roundVotes.clear();

  // 화면 전환
  switchView("voting");

  // 질문 번호 및 카테고리 갱신
  document.getElementById("qRoundNum").textContent = data.roundIndex || 1;
  document.getElementById("qTotalRounds").textContent = data.totalRounds || 10;
  
  const category = (data.question && data.question.category) ? data.question.category : "일반";
  document.getElementById("qCategoryBadge").textContent = category;

  // 질문 타이틀 및 선택지 A/B 갱신
  if (data.question) {
    document.getElementById("qTitleText").textContent = data.question.title || "질문";
    document.getElementById("qOptionAText").textContent = data.question.optionA || "선택 A";
    document.getElementById("qOptionBText").textContent = data.question.optionB || "선택 B";
  }

  // 투표 현황 제로화
  updateLiveGauge();

  // 카운트다운 타이머 시작
  startScreenCountdown();

  // 시작 효과음
  ScreenSound.playTick(false);
}

// 실시간 투표 게이지 갱신
function updateLiveGauge() {
  const total = screenState.connectedParticipants.size;
  const voted = screenState.roundVotes.size;
  const percent = total > 0 ? Math.min(100, Math.round((voted / total) * 100)) : 0;

  const votedEl = document.getElementById("qVotedCount");
  const totalEl = document.getElementById("qTotalCount");
  const progressEl = document.getElementById("qVoteProgressBar");

  if (votedEl) votedEl.textContent = voted;
  if (totalEl) totalEl.textContent = total;
  if (progressEl) progressEl.style.width = `${percent}%`;
}

// 카운트다운 타이머
function startScreenCountdown() {
  if (screenState.timerInterval) {
    clearInterval(screenState.timerInterval);
    screenState.timerInterval = null;
  }

  const timerText = document.getElementById("qTimerText");
  const timerBox = document.getElementById("qTimerContainer");

  const tick = () => {
    const elapsed = Math.floor((Date.now() - screenState.startedAt) / 1000);
    const remaining = Math.max(0, screenState.duration - elapsed);

    if (timerText) timerText.textContent = `${remaining}s`;

    // 5초 이하 시 경고 애니메이션 및 째깍 효과음
    if (remaining <= 5 && remaining > 0) {
      if (timerBox) {
        timerBox.className = "px-6 py-2 rounded-2xl bg-rose-100 border-2 border-rose-400 flex items-center gap-2 transition-all animate-pulse";
      }
      if (timerText) {
        timerText.className = "text-3xl md:text-4xl lg:text-5xl font-black font-mono text-rose-600";
      }
      ScreenSound.playTick(true);
    } else if (remaining === 0) {
      if (timerBox) {
        timerBox.className = "px-6 py-2 rounded-2xl bg-slate-200 border-2 border-slate-400 flex items-center gap-2 transition-all";
      }
      if (timerText) {
        timerText.className = "text-3xl md:text-4xl lg:text-5xl font-black font-mono text-slate-500";
        timerText.textContent = "0s (마감)";
      }
      clearInterval(screenState.timerInterval);
      screenState.timerInterval = null;
    } else {
      if (timerBox) {
        timerBox.className = "px-6 py-2 rounded-2xl bg-slate-100 border-2 border-slate-300 flex items-center gap-2 transition-all";
      }
      if (timerText) {
        timerText.className = "text-3xl md:text-4xl lg:text-5xl font-black font-mono text-slate-800";
      }
    }
  };

  tick();
  screenState.timerInterval = setInterval(tick, 250);
}

// ============================================================================
// 2. [요구사항 1] 제한시간 종료 시 다수 의견 대형 팝업 모달
// ============================================================================
function onResultsReceived(summary) {
  if (screenState.timerInterval) {
    clearInterval(screenState.timerInterval);
    screenState.timerInterval = null;
  }

  const modal = document.getElementById("screenMajorityModal");
  if (!modal) return;

  const roundIndexEl = document.getElementById("modalRoundIndex");
  if (roundIndexEl) roundIndexEl.textContent = summary.roundIndex || 1;

  const winnerCard = document.getElementById("modalWinnerCard");
  const winnerBadge = document.getElementById("modalWinnerBadge");
  const winnerContent = document.getElementById("modalWinnerContent");

  const textPercentA = document.getElementById("modalTextPercentA");
  const textCountA = document.getElementById("modalTextCountA");
  const textPercentB = document.getElementById("modalTextPercentB");
  const textCountB = document.getElementById("modalTextCountB");
  const totalVotesEl = document.getElementById("modalTotalVotes");
  const gaugeA = document.getElementById("modalGaugeA");
  const gaugeB = document.getElementById("modalGaugeB");

  // 득표 정보 갱신
  const pA = summary.percentA || 0;
  const pB = summary.percentB || 0;
  const cA = summary.countA || 0;
  const cB = summary.countB || 0;
  const tot = summary.totalVotes || (cA + cB);

  if (textPercentA) textPercentA.textContent = `${pA}%`;
  if (textCountA) textCountA.textContent = `(${cA}표)`;
  if (textPercentB) textPercentB.textContent = `${pB}%`;
  if (textCountB) textCountB.textContent = `(${cB}표)`;
  if (totalVotesEl) totalVotesEl.textContent = tot;

  if (gaugeA) gaugeA.style.width = `${pA}%`;
  if (gaugeB) gaugeB.style.width = `${pB}%`;

  // [핵심] 다수 의견 승리 선택지 결정 및 대형 강조
  if (summary.majorityOption === "A") {
    winnerCard.className = "p-8 md:p-10 rounded-3xl border-3 border-rose-400 bg-gradient-to-br from-rose-50 via-white to-rose-50 shadow-xl space-y-4 winner-pulse-a";
    winnerBadge.className = "px-6 py-2.5 rounded-2xl bg-rose-600 text-white font-black text-2xl md:text-3xl shadow-md";
    winnerBadge.textContent = "🏆 [A] 다수파 승리!";
    winnerContent.textContent = summary.optionA || (screenState.currentQuestion ? screenState.currentQuestion.optionA : "선택 A");
  } else if (summary.majorityOption === "B") {
    winnerCard.className = "p-8 md:p-10 rounded-3xl border-3 border-sky-400 bg-gradient-to-br from-sky-50 via-white to-sky-50 shadow-xl space-y-4 winner-pulse-b";
    winnerBadge.className = "px-6 py-2.5 rounded-2xl bg-sky-600 text-white font-black text-2xl md:text-3xl shadow-md";
    winnerBadge.textContent = "🏆 [B] 다수파 승리!";
    winnerContent.textContent = summary.optionB || (screenState.currentQuestion ? screenState.currentQuestion.optionB : "선택 B");
  } else {
    // 동점 (TIE) 또는 0표
    winnerCard.className = "p-8 md:p-10 rounded-3xl border-3 border-purple-400 bg-gradient-to-br from-purple-50 via-white to-purple-50 shadow-xl space-y-4";
    winnerBadge.className = "px-6 py-2.5 rounded-2xl bg-purple-600 text-white font-black text-2xl md:text-3xl shadow-md";
    winnerBadge.textContent = "🤝 50:50 황금 밸런스 (무승부)!";
    winnerContent.textContent = "A와 B의 표가 동일하여 모든 참가자가 다수파로 인정되었습니다!";
  }

  // 모달 표시
  modal.classList.remove("hidden");

  // 승리 팡파르 효과음 및 꽃가루 효과
  ScreenSound.playFanfare();
  triggerModalConfetti();
}

function closeMajorityModal() {
  const modal = document.getElementById("screenMajorityModal");
  if (modal) modal.classList.add("hidden");
}

// ============================================================================
// 3. [요구사항 반영] 문제 완료 시 일치율 상위 10명(좌측) & 하위 10명(우측) 발표
// ============================================================================
function showFinalLeaderboard(finalData) {
  switchView("final");

  // 참가자 전체 랭킹 데이터 확보
  let rankList = finalData.rankList;

  // 만약 payload에 rankList가 없다면 historyRounds로부터 자동 계산
  if (!rankList || !Array.isArray(rankList) || rankList.length === 0) {
    rankList = calculateRankingsFromHistory(finalData.historyRounds || screenState.historyRounds);
  }

  renderDualLeaderboard(rankList);

  // 최종 우승 그랜드 팡파르 효과음 및 대형 컨페티 발사
  ScreenSound.playGrandVictory();
  triggerGrandConfetti();
}

// 히스토리 기반 랭킹 계산
function calculateRankingsFromHistory(historyRounds) {
  const userStats = new Map();

  if (Array.isArray(historyRounds)) {
    historyRounds.forEach((r) => {
      if (Array.isArray(r.participantDetails)) {
        r.participantDetails.forEach((p) => {
          if (p.choice && p.choice !== "NONE") {
            if (!userStats.has(p.nickname)) {
              userStats.set(p.nickname, { total: 0, majorityWins: 0 });
            }
            const s = userStats.get(p.nickname);
            s.total += 1;
            if (p.isMajority) {
              s.majorityWins += 1;
            }
          }
        });
      }
    });
  }

  const list = Array.from(userStats.entries()).map(([nickname, s]) => {
    const rate = Math.round((s.majorityWins / s.total) * 100);
    return { nickname, total: s.total, wins: s.majorityWins, rate };
  });

  return list;
}

// 좌(상위 10명 - 높은순) & 우(하위 10명 - 낮은순) 렌더링
function renderDualLeaderboard(rankList) {
  const top10Container = document.getElementById("top10ListContainer");
  const bottom10Container = document.getElementById("bottom10ListContainer");

  if (!top10Container || !bottom10Container) return;

  if (!rankList || rankList.length === 0) {
    top10Container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">참여 데이터가 없습니다.</div>`;
    bottom10Container.innerHTML = `<div class="p-6 text-center text-slate-400 text-xs">참여 데이터가 없습니다.</div>`;
    return;
  }

  // 1. 일치율 상위 10명 (높은순: rate 내림차순, 동률 시 wins 내림차순)
  const sortedHigh = [...rankList].sort((a, b) => b.rate - a.rate || b.wins - a.wins);
  const top10 = sortedHigh.slice(0, 10);

  // 2. 일치율 하위 10명 (낮은순: rate 오름차순, 동률 시 wins 오름차순)
  const sortedLow = [...rankList].sort((a, b) => a.rate - b.rate || a.wins - b.wins);
  const bottom10 = sortedLow.slice(0, 10);

  // --- 좌측: 상위 10명 렌더링 ---
  top10Container.innerHTML = "";
  top10.forEach((item, idx) => {
    const rankNum = idx + 1;
    const card = document.createElement("div");

    if (rankNum === 1) {
      // 1위 하이라이트
      card.className = "flex items-center justify-between p-3.5 rounded-2xl bg-amber-50/90 border-2 border-amber-300 shadow-sm gold-glow";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-white font-black flex items-center justify-center text-xs shadow-xs shrink-0">
            🥇 1위
          </span>
          <div class="min-w-0 truncate">
            <span class="font-black text-slate-900 text-sm md:text-base">${escapeHtml(item.nickname)}</span>
            <span class="ml-1.5 text-[11px] font-bold text-amber-800 bg-amber-200/70 px-2 py-0.5 rounded-full inline-block">대세 챔피언</span>
          </div>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-lg md:text-xl font-black font-mono text-emerald-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-500 font-medium block">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    } else if (rankNum === 2) {
      // 2위
      card.className = "flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-7 h-7 rounded-lg bg-slate-300 text-slate-800 font-black flex items-center justify-center text-xs shrink-0">
            🥈 2위
          </span>
          <span class="font-bold text-slate-900 text-sm truncate">${escapeHtml(item.nickname)}</span>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-base font-black font-mono text-emerald-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-400 ml-1">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    } else if (rankNum === 3) {
      // 3위
      card.className = "flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-7 h-7 rounded-lg bg-amber-100 text-amber-900 font-black flex items-center justify-center text-xs shrink-0 border border-amber-300">
            🥉 3위
          </span>
          <span class="font-bold text-slate-900 text-sm truncate">${escapeHtml(item.nickname)}</span>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-base font-black font-mono text-emerald-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-400 ml-1">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    } else {
      // 4위 ~ 10위
      card.className = "flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 border border-slate-200/70";
      card.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-6 h-6 rounded-md bg-slate-200 text-slate-600 font-bold flex items-center justify-center text-[11px] shrink-0">
            ${rankNum}위
          </span>
          <span class="font-medium text-slate-800 text-sm truncate">${escapeHtml(item.nickname)}</span>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-sm font-bold font-mono text-emerald-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-400 ml-1">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    }
    top10Container.appendChild(card);
  });

  // --- 우측: 하위 10명 렌더링 (낮은순) ---
  bottom10Container.innerHTML = "";
  bottom10.forEach((item, idx) => {
    const rankNum = idx + 1;
    const card = document.createElement("div");

    if (rankNum === 1) {
      // 최저 일치율 1위 (독보적 개성왕)
      card.className = "flex items-center justify-between p-3.5 rounded-2xl bg-purple-50/90 border-2 border-purple-300 shadow-sm winner-pulse-b";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 text-white font-black flex items-center justify-center text-xs shadow-xs shrink-0">
            🦄 1위
          </span>
          <div class="min-w-0 truncate">
            <span class="font-black text-slate-900 text-sm md:text-base">${escapeHtml(item.nickname)}</span>
            <span class="ml-1.5 text-[11px] font-bold text-purple-800 bg-purple-200/70 px-2 py-0.5 rounded-full inline-block">독보적 개성왕</span>
          </div>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-lg md:text-xl font-black font-mono text-purple-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-500 font-medium block">(${item.wins}/${item.total}회 일치)</span>
        </div>
      `;
    } else if (rankNum === 2) {
      card.className = "flex items-center justify-between p-3 rounded-xl bg-purple-50/40 border border-purple-200";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-7 h-7 rounded-lg bg-purple-200 text-purple-900 font-black flex items-center justify-center text-xs shrink-0">
            ⚡ 2위
          </span>
          <span class="font-bold text-slate-900 text-sm truncate">${escapeHtml(item.nickname)}</span>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-base font-black font-mono text-purple-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-400 ml-1">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    } else if (rankNum === 3) {
      card.className = "flex items-center justify-between p-3 rounded-xl bg-purple-50/40 border border-purple-200";
      card.innerHTML = `
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-7 h-7 rounded-lg bg-purple-100 text-purple-800 font-black flex items-center justify-center text-xs shrink-0 border border-purple-300">
            ✨ 3위
          </span>
          <span class="font-bold text-slate-900 text-sm truncate">${escapeHtml(item.nickname)}</span>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-base font-black font-mono text-purple-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-400 ml-1">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    } else {
      card.className = "flex items-center justify-between p-2.5 rounded-xl bg-purple-50/20 border border-purple-100";
      card.innerHTML = `
        <div class="flex items-center gap-2.5 min-w-0">
          <span class="w-6 h-6 rounded-md bg-purple-100 text-purple-700 font-bold flex items-center justify-center text-[11px] shrink-0">
            ${rankNum}위
          </span>
          <span class="font-medium text-slate-800 text-sm truncate">${escapeHtml(item.nickname)}</span>
        </div>
        <div class="text-right shrink-0 ml-2">
          <span class="text-sm font-bold font-mono text-purple-700">${item.rate}%</span>
          <span class="text-[11px] text-slate-400 ml-1">(${item.wins}/${item.total}회)</span>
        </div>
      `;
    }
    bottom10Container.appendChild(card);
  });
}

// ============================================================================
// 효과 (컨페티 & 전체화면 & 사운드 토글)
// ============================================================================

// 결과 팝업 시 가벼운 꽃가루
function triggerModalConfetti() {
  if (window.confetti) {
    try {
      window.confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.6 }
      });
    } catch (e) {}
  }
}

// 최종 10문제 완료 시 그랜드 꽃가루 샤워
function triggerGrandConfetti() {
  if (window.confetti) {
    try {
      const duration = 3.5 * 1000;
      const end = Date.now() + duration;

      (function frame() {
        window.confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0 }
        });
        window.confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1 }
        });

        if (Date.now() < end) {
          requestAnimationFrame(frame);
        }
      })();
    } catch (e) {}
  }
}

// 전체화면 토글
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.warn("Fullscreen request error:", err);
    });
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
}

// 사운드 토글
function toggleScreenSound() {
  screenState.soundEnabled = !screenState.soundEnabled;
  const icon = document.getElementById("soundIcon");
  const text = document.getElementById("soundText");
  if (screenState.soundEnabled) {
    if (icon) icon.textContent = "🔊";
    if (text) text.textContent = "소리 켬";
    ScreenSound.playTick(false);
  } else {
    if (icon) icon.textContent = "🔇";
    if (text) text.textContent = "음소거";
  }
}
