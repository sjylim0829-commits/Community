// ============================================================================
// 회의실 대형 모니터 전시용 보드 스크립트 (board.js)
// - [전시 페이지 1] 교원학습공동체 응원 한마디 / [전시 페이지 2] 영서중 동료선생님 따뜻한 한마디 분리 전시
// - 포스트잇 클릭 시 대형 확대 모달 열람 (이전/다음 포스트잇 연속 넘기기 지원)
// - 실시간 신규 포스트잇 도착 알림 및 사운드, QR 코드 모달, 랜덤 뽑기, CSV 다운로드
// ============================================================================

let boardStore = null;

const boardState = {
  currentTopic: 1, // 1: 교원학습공동체 응원 전시관 | 2: 동료선생님 따뜻한 한마디 전시관
  gridSize: "normal", // 'large' | 'normal' | 'compact'
  sortOrder: "newest", // 'newest' | 'oldest' | 'likes'
  zoomedNoteId: null, // 현재 확대 열람 중인 포스트잇 ID
  qrMode: "auto", // 'auto' | 'github' | 'current'
  miniQrCollapsed: false
};

window.addEventListener("DOMContentLoaded", () => {
  initExhibitionBoard();
});

function initExhibitionBoard() {
  const params = new URLSearchParams(window.location.search);
  const topicParam = Number(params.get("topic"));
  if (topicParam === 1 || topicParam === 2) {
    boardState.currentTopic = topicParam;
  }

  const roomId = getPostitRoomId();
  boardStore = new PostitStore(roomId);

  // 키보드 단축키 바인딩 (확대 모달 좌우 이동, ESC 닫기, 숫자 1/2 전시관 전환)
  window.addEventListener("keydown", handleBoardKeydown);

  // QR 코드 URL 계산 및 렌더링
  updateQrCodeDisplay();

  // 초기 테마 및 헤더 렌더링
  applyTopicTheme(boardState.currentTopic);

  const previewParam = params.get("preview");

  // 실시간 데이터 구독
  boardStore.subscribe(
    (allNotes, eventType, payload) => {
      if (previewParam === "1" || previewParam === "zoom") {
        seedPreviewNotes();
      }
      renderBoardCounts();
      renderPostitWall(eventType, payload);

      // 현재 확대 모달이 열려 있다면 내용 갱신
      if (boardState.zoomedNoteId) {
        const stillExists = boardStore.notesMap.get(boardState.zoomedNoteId);
        if (stillExists) {
          populateZoomModal(stillExists);
        } else {
          closeZoomModal();
        }
      }

      // 실시간 새 포스트잇이 도착했을 때 사운드 및 토스트 알림
      if (eventType === "new_arrival" && payload) {
        PostitSound.playNewArrival();
        const authorLabel = payload.author || "영서중 동료선생님";
        const topicBadge = Number(payload.topic) === 1 ? "1번 전시관(교학공 응원)" : "2번 전시관(동료교사 한마디)";
        showBoardToast(`✨ [${topicBadge}] ${authorLabel}님의 새 포스트잇이 도착했습니다!`);
      }
    },
    (connected, label) => {
      const badge = document.getElementById("boardConnectionBadge");
      if (!badge) return;
      if (connected) {
        badge.className =
          "px-3 py-1.5 text-xs rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 font-bold shadow-2xs";
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>실시간 연결됨</span>`;
      } else {
        badge.className =
          "px-3 py-1.5 text-xs rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5 font-bold shadow-2xs";
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>${escapeHtml(label)}</span>`;
      }
    }
  );

  // 미리보기/스크린샷 모드 (?preview=1 또는 ?preview=zoom)
  if (previewParam === "1" || previewParam === "zoom") {
    seedPreviewNotes();
    renderBoardCounts();
    renderPostitWall("preview");
    if (previewParam === "zoom") {
      const firstNote = getSortedCurrentTopicNotes()[0];
      if (firstNote) openZoomModal(firstNote.id);
    }
  }
}

function seedPreviewNotes() {
  const now = Date.now();
  const sampleNotes = [
    {
      id: "sample_1_1",
      topic: 1,
      content: "바쁜 2학기 일정 속에서도 열정적으로 연구하고 수업 나눔해주신 교원학습공동체 선생님들 정말 멋지십니다! 덕분에 많은 배움과 영감을 얻어갑니다 👏✨",
      author: "1학년부 동료교사",
      color: "yellow",
      pinStyle: "tape",
      rotation: -1.8,
      likes: 12,
      createdAt: now - 120000
    },
    {
      id: "sample_1_2",
      topic: 1,
      content: "선생님들의 깊이 있는 고민과 에듀테크·수업 혁신 사례 발표가 정말 인상 깊었습니다! 우리 학교의 자랑이에요 ❤️",
      author: "교무기획부",
      color: "pink",
      pinStyle: "pin-red",
      rotation: 1.5,
      likes: 9,
      createdAt: now - 240000
    },
    {
      id: "sample_1_3",
      topic: 1,
      content: "한 학기 동안 함께 모여 연구하고 실천하신 결과물을 보니 감동입니다. 교원학습공동체 선생님들 모두 고생 많으셨어요! 👍",
      author: "3학년부 교사",
      color: "mint",
      pinStyle: "pin-emerald",
      rotation: -1.2,
      likes: 8,
      createdAt: now - 360000
    },
    {
      id: "sample_1_4",
      topic: 1,
      content: "아이들의 배움을 위해 끊임없이 연구하시는 선생님들의 뜨거운 열정에 큰 박수를 보냅니다! 내년에도 함께해요 🌱",
      author: "영서중 동료선생님",
      color: "blue",
      pinStyle: "tape",
      rotation: 2.1,
      likes: 7,
      createdAt: now - 480000
    },
    {
      id: "sample_1_5",
      topic: 1,
      content: "발표 자료 하나하나에 정성과 고민이 가득 담겨 있어서 시간 가는 줄 모르고 들었습니다. 정말 수고 많으셨습니다! 💡",
      author: "2학년부 교사",
      color: "purple",
      pinStyle: "pin-gold",
      rotation: -2.0,
      likes: 11,
      createdAt: now - 540000
    },
    {
      id: "sample_2_1",
      topic: 2,
      content: "늘 옆에서 따뜻하게 웃어주시고 든든한 버팀목이 되어주시는 영서중 선생님들! 올 한 해도 선생님들과 함께여서 정말 행복했습니다 🥰",
      author: "2학년부 동료교사",
      color: "pink",
      pinStyle: "tape",
      rotation: -1.5,
      likes: 15,
      createdAt: now - 100000
    },
    {
      id: "sample_2_2",
      topic: 2,
      content: "추워지는 날씨에 감기 조심하시고, 남은 2학기 학기말 업무와 연말까지 우리 모두 건강 챙기며 힘내요! 영서중 화이팅 🍀",
      author: "생활안전부",
      color: "yellow",
      pinStyle: "pin-gold",
      rotation: 1.7,
      likes: 10,
      createdAt: now - 220000
    },
    {
      id: "sample_2_3",
      topic: 2,
      content: "힘들 때마다 따뜻한 커피 한 잔과 격려를 건네주신 동료 선생님들 덕분에 무사히 한 해를 달려올 수 있었습니다. 늘 감사합니다 🌸",
      author: "신규교사 드림",
      color: "mint",
      pinStyle: "pin-emerald",
      rotation: -2.1,
      likes: 14,
      createdAt: now - 310000
    },
    {
      id: "sample_2_4",
      topic: 2,
      content: "서로 배려하고 응원하는 우리 영서중학교 최고예요! 연말 따뜻하고 행복하게 보내시길 진심으로 바랍니다 💖",
      author: "영서중 동료선생님",
      color: "orange",
      pinStyle: "pin-red",
      rotation: 1.4,
      likes: 9,
      createdAt: now - 420000
    },
    {
      id: "sample_2_5",
      topic: 2,
      content: "올 한 해 아이들을 위해 애쓰신 모든 영서중 선생님들께 존경과 감사의 마음을 전합니다. 모두 고생 많으셨습니다! ✨",
      author: "교육연구부",
      color: "purple",
      pinStyle: "tape",
      rotation: -1.1,
      likes: 13,
      createdAt: now - 500000
    }
  ];
  sampleNotes.forEach((n) => boardStore.notesMap.set(n.id, n));
}

// ============================================================================
// 전시관 전환 (1번 전시 페이지 <-> 2번 전시 페이지)
// ============================================================================
function switchExhibitionTopic(topicNum) {
  const target = Number(topicNum) === 2 ? 2 : 1;
  boardState.currentTopic = target;

  // 주소창 쿼리 파라미터도 깔끔하게 업데이트 (새로고침이나 링크 공유 시 현재 전시관 유지)
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("topic", String(target));
    window.history.replaceState({}, "", url.toString());
  } catch (e) {}

  applyTopicTheme(target);
  renderBoardCounts();
  renderPostitWall("switch_topic");
}

function applyTopicTheme(topicNum) {
  const body = document.body;
  const topicInfo = POSTIT_TOPICS[topicNum];

  // 배경 코르크/펠트 테마 전환
  body.classList.remove("board-theme-1", "board-theme-2");
  body.classList.add(topicNum === 1 ? "board-theme-1" : "board-theme-2");

  // 상단 전시관 선택 탭 스타일 업데이트
  const tab1 = document.getElementById("exhibitTab1");
  const tab2 = document.getElementById("exhibitTab2");

  if (tab1 && tab2) {
    if (topicNum === 1) {
      tab1.className =
        "px-4 lg:px-6 py-2.5 rounded-2xl font-black text-sm lg:text-base bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20 flex items-center gap-2 transition transform scale-[1.02] cursor-pointer";
      tab2.className =
        "px-4 lg:px-6 py-2.5 rounded-2xl font-bold text-sm lg:text-base bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 flex items-center gap-2 transition cursor-pointer";
    } else {
      tab1.className =
        "px-4 lg:px-6 py-2.5 rounded-2xl font-bold text-sm lg:text-base bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 flex items-center gap-2 transition cursor-pointer";
      tab2.className =
        "px-4 lg:px-6 py-2.5 rounded-2xl font-black text-sm lg:text-base bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-md shadow-rose-500/20 flex items-center gap-2 transition transform scale-[1.02] cursor-pointer";
    }
  }

  // 상단 배너 타이틀 & 서브타이틀 업데이트
  const bannerBox = document.getElementById("exhibitBannerBox");
  const bannerBadge = document.getElementById("exhibitBannerBadge");
  const bannerTitle = document.getElementById("exhibitBannerTitle");
  const bannerSubtitle = document.getElementById("exhibitBannerSubtitle");

  if (bannerBox) {
    bannerBox.className =
      topicNum === 1
        ? "w-full rounded-3xl bg-gradient-to-r from-amber-50/95 via-white/95 to-orange-50/95 border-2 border-amber-200/90 shadow-md px-6 py-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 backdrop-blur-md"
        : "w-full rounded-3xl bg-gradient-to-r from-rose-50/95 via-white/95 to-teal-50/95 border-2 border-rose-200/90 shadow-md px-6 py-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 backdrop-blur-md";
  }

  if (bannerBadge) {
    bannerBadge.className =
      topicNum === 1
        ? "inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-black bg-amber-500 text-white shadow-2xs"
        : "inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full text-xs font-black bg-rose-500 text-white shadow-2xs";
    bannerBadge.textContent =
      topicNum === 1 ? "🔥 전시 페이지 1 · 교원학습공동체 응원 보드" : "💝 전시 페이지 2 · 영서중 동료선생님 따뜻한 한마디 보드";
  }

  if (bannerTitle) {
    bannerTitle.textContent = `${topicNum}. ${topicInfo.title}`;
  }
  if (bannerSubtitle) {
    bannerSubtitle.textContent = topicInfo.subtitle;
  }
}

// 각 전시관 포스트잇 개수 배지 갱신
function renderBoardCounts() {
  if (!boardStore) return;
  const count1 = boardStore.getNotesByTopic(1).length;
  const count2 = boardStore.getNotesByTopic(2).length;

  const badge1 = document.getElementById("tabCountBadge1");
  const badge2 = document.getElementById("tabCountBadge2");
  const currentTotalEl = document.getElementById("currentTopicCountText");

  if (badge1) badge1.textContent = `${count1}`;
  if (badge2) badge2.textContent = `${count2}`;
  if (currentTotalEl) {
    currentTotalEl.textContent = `${boardState.currentTopic === 1 ? count1 : count2}장`;
  }
}

// ============================================================================
// 포스트잇 보드 그리드 렌더링
// ============================================================================
function renderPostitWall(eventType = "", highlightedNote = null) {
  if (!boardStore) return;

  const gridEl = document.getElementById("postitWallGrid");
  const emptyEl = document.getElementById("boardEmptyState");
  if (!gridEl || !emptyEl) return;

  let notes = boardStore.getNotesByTopic(boardState.currentTopic);

  // 정렬 적용
  if (boardState.sortOrder === "oldest") {
    notes = [...notes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  } else if (boardState.sortOrder === "likes") {
    notes = [...notes].sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  } else {
    notes = [...notes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  if (notes.length === 0) {
    gridEl.classList.add("hidden");
    emptyEl.classList.remove("hidden");
    const emptyTitle = document.getElementById("emptyStateTopicTitle");
    if (emptyTitle) {
      emptyTitle.textContent =
        boardState.currentTopic === 1
          ? "아직 1번 전시관(교원학습공동체 응원)에 붙은 포스트잇이 없습니다."
          : "아직 2번 전시관(영서중 동료선생님께 따뜻한 한마디)에 붙은 포스트잇이 없습니다.";
    }
    return;
  }

  emptyEl.classList.add("hidden");
  gridEl.classList.remove("hidden");

  // 그리드 크기 모드 적용
  gridEl.className = `postit-wall-grid size-${boardState.gridSize}`;

  const now = Date.now();

  gridEl.innerHTML = notes
    .map((note) => {
      const colorClass = getColorClass(note.color);
      const rot = getNoteRotation(note.id, note.rotation);
      const isNew = now - (note.createdAt || 0) < 60000;
      const isJustArrived = highlightedNote && highlightedNote.id === note.id;
      const pinHtml = renderPinOrTapeHtml(note.pinStyle, note.id);
      const authorText = note.author && note.author.trim() ? note.author.trim() : "영서중 동료선생님";
      const timeText = formatPostitTime(note.createdAt);

      return `
        <article
          onclick="openZoomModal('${escapeHtml(note.id)}')"
          style="--note-rot: ${rot}deg;"
          class="postit-card ${colorClass} ${isJustArrived ? "animate-stick-in" : ""} group"
          title="클릭하면 크게 확대하여 볼 수 있습니다"
        >
          ${pinHtml}

          <!-- 상단 메타 바 (NEW 배지 & 확대 아이콘) -->
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-1.5">
              ${
                isNew
                  ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-2xs animate-pulse">NEW ✨</span>`
                  : `<span class="text-[11px] font-bold opacity-55">${escapeHtml(timeText)}</span>`
              }
            </div>
            <span class="text-xs font-bold opacity-0 group-hover:opacity-80 transition bg-black/10 px-2 py-0.5 rounded-md">
              🔍 클릭하여 확대
            </span>
          </div>

          <!-- 포스트잇 본문 -->
          <div class="flex-1 flex items-center my-1">
            <p class="postit-body-text postit-clamp w-full font-medium whitespace-pre-wrap">${escapeHtml(note.content)}</p>
          </div>

          <!-- 하단 작성자 & 공감 하트 -->
          <div class="mt-4 pt-2.5 border-t border-black/10 flex items-center justify-between gap-2">
            <span class="text-xs sm:text-sm font-black opacity-85 truncate max-w-[70%]">
              From. ${escapeHtml(authorText)}
            </span>

            <button
              type="button"
              onclick="handleQuickLike(event, '${escapeHtml(note.id)}')"
              class="px-2.5 py-1 rounded-full bg-white/55 hover:bg-white/90 border border-black/10 text-xs font-black flex items-center gap-1 transition active:scale-110 cursor-pointer shrink-0"
              title="공감 하트 보내기"
            >
              <span>❤️</span>
              <span>${Number(note.likes || 0)}</span>
            </button>
          </div>
        </article>
      `;
    })
    .join("");
}

// 카드 크기 조절 ('large' | 'normal' | 'compact')
function setGridSize(sizeMode) {
  boardState.gridSize = sizeMode;
  ["large", "normal", "compact"].forEach((mode) => {
    const btn = document.getElementById(`btnSize_${mode}`);
    if (btn) {
      btn.className =
        mode === sizeMode
          ? "px-2.5 py-1 rounded-lg bg-slate-900 text-white text-xs font-bold transition cursor-pointer"
          : "px-2.5 py-1 rounded-lg bg-transparent hover:bg-slate-200 text-slate-600 text-xs font-bold transition cursor-pointer";
    }
  });
  renderPostitWall("resize");
}

// 정렬 순서 변경
function handleSortChange(selectEl) {
  if (!selectEl) return;
  boardState.sortOrder = selectEl.value;
  renderPostitWall("sort");
}

// 보드 카드에서 바로 공감 하트 클릭 (모달 열림 방지)
function handleQuickLike(event, noteId) {
  if (event) {
    event.stopPropagation();
  }
  if (!boardStore || !noteId) return;
  PostitSound.playPop();
  boardStore.likeNote(noteId);
}

// ============================================================================
// 포스트잇 클릭 시 대형 확대 열람 모달 (Zoom Inspection Modal)
// ============================================================================
function getSortedCurrentTopicNotes() {
  if (!boardStore) return [];
  let notes = boardStore.getNotesByTopic(boardState.currentTopic);
  if (boardState.sortOrder === "oldest") {
    return [...notes].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }
  if (boardState.sortOrder === "likes") {
    return [...notes].sort((a, b) => (b.likes || 0) - (a.likes || 0) || (b.createdAt || 0) - (a.createdAt || 0));
  }
  return [...notes].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function openZoomModal(noteId) {
  if (!boardStore) return;
  const note = boardStore.notesMap.get(noteId);
  if (!note) return;

  boardState.zoomedNoteId = noteId;
  populateZoomModal(note);

  const modal = document.getElementById("zoomPostitModal");
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function populateZoomModal(note) {
  const card = document.getElementById("zoomPostitCard");
  if (!card) return;

  // 포스트잇 배경 컬러 적용
  POSTIT_COLORS.forEach((c) => card.classList.remove(c.className));
  card.classList.add(getColorClass(note.color));

  // 상단 핀/테이프 장식
  const pinContainer = document.getElementById("zoomPinDecor");
  if (pinContainer) {
    pinContainer.innerHTML = renderPinOrTapeHtml(note.pinStyle, note.id);
  }

  // 주제 배지
  const topicInfo = POSTIT_TOPICS[note.topic] || POSTIT_TOPICS[1];
  const topicBadge = document.getElementById("zoomTopicBadge");
  if (topicBadge) {
    topicBadge.textContent = `${topicInfo.icon} ${topicInfo.badge}`;
  }

  // 작성 시각
  const timeEl = document.getElementById("zoomTimeText");
  if (timeEl) {
    timeEl.textContent = formatPostitTime(note.createdAt);
  }

  // 본문 내용 (글자 길이에 따라 폰트 크기 자동 최적화)
  const contentEl = document.getElementById("zoomContentText");
  if (contentEl) {
    const len = (note.content || "").length;
    if (len < 60) {
      contentEl.className = "text-2xl sm:text-3xl md:text-4xl font-bold leading-relaxed whitespace-pre-wrap break-words my-6";
    } else if (len < 140) {
      contentEl.className = "text-xl sm:text-2xl md:text-3xl font-bold leading-relaxed whitespace-pre-wrap break-words my-5";
    } else {
      contentEl.className = "text-lg sm:text-xl md:text-2xl font-medium leading-relaxed whitespace-pre-wrap break-words my-4";
    }
    contentEl.textContent = note.content || "";
  }

  // 작성자
  const authorEl = document.getElementById("zoomAuthorText");
  if (authorEl) {
    authorEl.textContent = `From. ${note.author && note.author.trim() ? note.author.trim() : "영서중 동료선생님"}`;
  }

  // 공감 수
  const likeCountEl = document.getElementById("zoomLikeCount");
  if (likeCountEl) {
    likeCountEl.textContent = String(note.likes || 0);
  }

  // 현재 순서 표시 (예: 3 / 18)
  const list = getSortedCurrentTopicNotes();
  const idx = list.findIndex((n) => n.id === note.id);
  const posEl = document.getElementById("zoomPositionIndicator");
  if (posEl) {
    posEl.textContent = idx >= 0 ? `${idx + 1} / ${list.length}` : `1 / 1`;
  }
}

function closeZoomModal() {
  boardState.zoomedNoteId = null;
  const modal = document.getElementById("zoomPostitModal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

// 확대 모달에서 이전/다음 포스트잇으로 넘기기
function navigateZoomedNote(direction) {
  const list = getSortedCurrentTopicNotes();
  if (list.length === 0) return;

  const currentIdx = list.findIndex((n) => n.id === boardState.zoomedNoteId);
  let nextIdx = 0;
  if (currentIdx >= 0) {
    nextIdx = (currentIdx + direction + list.length) % list.length;
  }

  const targetNote = list[nextIdx];
  if (targetNote) {
    boardState.zoomedNoteId = targetNote.id;
    populateZoomModal(targetNote);
  }
}

// 확대 모달에서 공감 하트 누르기
function handleZoomModalLike() {
  if (!boardState.zoomedNoteId || !boardStore) return;
  PostitSound.playPop();
  boardStore.likeNote(boardState.zoomedNoteId);
  if (typeof confetti === "function") {
    confetti({
      particleCount: 35,
      spread: 55,
      origin: { y: 0.7 }
    });
  }
}

// 확대 모달에서 현재 포스트잇 삭제
async function handleDeleteCurrentZoomedNote() {
  if (!boardState.zoomedNoteId || !boardStore) return;
  const ok = confirm("이 포스트잇을 전시 보드에서 삭제하시겠습니까?");
  if (!ok) return;

  const targetId = boardState.zoomedNoteId;
  closeZoomModal();
  await boardStore.deleteNote(targetId);
  showBoardToast("포스트잇이 삭제되었습니다.");
}

// 랜덤 포스트잇 뽑아서 확대 열람하기
function pickRandomPostit() {
  const list = getSortedCurrentTopicNotes();
  if (list.length === 0) {
    showBoardToast("현재 전시관에 등록된 포스트잇이 없습니다!");
    return;
  }
  const randomNote = list[Math.floor(Math.random() * list.length)];
  PostitSound.playNewArrival();
  openZoomModal(randomNote.id);
  if (typeof confetti === "function") {
    confetti({
      particleCount: 55,
      spread: 65,
      origin: { y: 0.55 }
    });
  }
}

// 키보드 단축키 핸들러
function handleBoardKeydown(e) {
  // 입력창 포커스 중에는 단축키 무시
  if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
    return;
  }

  if (boardState.zoomedNoteId) {
    if (e.key === "Escape") {
      closeZoomModal();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigateZoomedNote(-1);
    } else if (e.key === "ArrowRight" || e.key === " ") {
      e.preventDefault();
      navigateZoomedNote(1);
    }
    return;
  }

  if (e.key === "Escape") {
    closeQrModal();
    closeQuickWriteModal();
    closeAdminModal();
  } else if (e.key === "1") {
    switchExhibitionTopic(1);
  } else if (e.key === "2") {
    switchExhibitionTopic(2);
  }
}

// ============================================================================
// QR 코드 생성 및 모달 제어 (스마트폰 접속 주소 자동 처리)
// ============================================================================
function getWritePageUrl() {
  const roomId = getPostitRoomId();
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.protocol === "file:";

  // 로컬에서 실행 중이더라도 스마트폰 QR 스캔 시 접속 가능하도록 기본값을 GitHub Pages 배포 주소로 제공 (전환 가능)
  const useGithubUrl = boardState.qrMode === "github" || (boardState.qrMode === "auto" && isLocalhost);

  let baseWriteUrl = "";
  if (useGithubUrl) {
    baseWriteUrl = `${GITHUB_PAGES_BASE_URL}/write.html`;
  } else {
    let origin = window.location.origin;
    if (!origin || origin === "null") {
      origin = window.location.href.split("/board.html")[0];
    }
    let path = window.location.pathname.replace("board.html", "write.html");
    if (!path.endsWith("write.html")) {
      path = path.replace(/\/[^/]*$/, "/write.html");
    }
    baseWriteUrl = `${origin}${path}`;
  }

  if (roomId && roomId !== POSTIT_DEFAULT_ROOM) {
    return `${baseWriteUrl}?room=${encodeURIComponent(roomId)}`;
  }
  return baseWriteUrl;
}

function updateQrCodeDisplay() {
  const writeUrl = getWritePageUrl();
  const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=8&data=${encodeURIComponent(writeUrl)}`;

  const miniQrImg = document.getElementById("miniQrImg");
  const modalQrImg = document.getElementById("modalQrImg");
  const emptyQrImg = document.getElementById("emptyQrImg");
  const qrUrlText = document.getElementById("modalQrUrlText");

  if (miniQrImg) miniQrImg.src = qrApiUrl;
  if (modalQrImg) modalQrImg.src = qrApiUrl;
  if (emptyQrImg) emptyQrImg.src = qrApiUrl;
  if (qrUrlText) qrUrlText.textContent = writeUrl;
}

function setQrUrlMode(mode) {
  boardState.qrMode = mode;
  updateQrCodeDisplay();
}

function openQrModal() {
  updateQrCodeDisplay();
  const modal = document.getElementById("qrCodeModal");
  if (modal) modal.classList.remove("hidden");
}

function closeQrModal() {
  const modal = document.getElementById("qrCodeModal");
  if (modal) modal.classList.add("hidden");
}

function toggleMiniQrWidget() {
  boardState.miniQrCollapsed = !boardState.miniQrCollapsed;
  const body = document.getElementById("miniQrWidgetBody");
  const toggleBtn = document.getElementById("miniQrToggleText");
  if (body) {
    body.classList.toggle("hidden", boardState.miniQrCollapsed);
  }
  if (toggleBtn) {
    toggleBtn.textContent = boardState.miniQrCollapsed ? "QR 펴기 ▲" : "접기 ▼";
  }
}

// ============================================================================
// 전시 화면에서 바로 포스트잇 작성 모달 (Quick Write on Board)
// ============================================================================
let quickWriteColor = "yellow";

function openQuickWriteModal() {
  const modal = document.getElementById("quickWriteModal");
  if (!modal) return;

  const topicSelect = document.getElementById("quickWriteTopicSelect");
  if (topicSelect) {
    topicSelect.value = String(boardState.currentTopic);
  }

  quickWriteColor = boardState.currentTopic === 1 ? "yellow" : "pink";
  renderQuickWriteColors();

  modal.classList.remove("hidden");
  const input = document.getElementById("quickWriteContent");
  if (input) input.focus();
}

function closeQuickWriteModal() {
  const modal = document.getElementById("quickWriteModal");
  if (modal) modal.classList.add("hidden");
}

function renderQuickWriteColors() {
  const container = document.getElementById("quickWriteColorSwatches");
  if (!container) return;
  container.innerHTML = POSTIT_COLORS.map((c) => {
    const active = c.id === quickWriteColor;
    return `
      <button
        type="button"
        onclick="selectQuickWriteColor('${c.id}')"
        class="color-swatch ${active ? "active" : ""}"
        style="background-color: ${c.hex}; border-color: ${active ? "#0f172a" : c.border}; width: 32px; height: 32px;"
      >
        ${active ? '<span class="text-xs font-black">✓</span>' : ""}
      </button>
    `;
  }).join("");
}

function selectQuickWriteColor(colorId) {
  quickWriteColor = colorId;
  renderQuickWriteColors();
}

async function handleQuickWriteSubmit(event) {
  if (event) event.preventDefault();
  if (!boardStore) return;

  const topicEl = document.getElementById("quickWriteTopicSelect");
  const contentEl = document.getElementById("quickWriteContent");
  const authorEl = document.getElementById("quickWriteAuthor");

  const topic = Number(topicEl?.value || boardState.currentTopic);
  const content = (contentEl?.value || "").trim();
  const author = (authorEl?.value || "").trim() || "영서중 동료선생님";

  if (!content) {
    alert("응원 메시지 내용을 입력해 주세요.");
    return;
  }

  await boardStore.saveNote({
    topic,
    content,
    author,
    color: quickWriteColor
  });

  PostitSound.playStick();
  if (contentEl) contentEl.value = "";
  closeQuickWriteModal();

  if (boardState.currentTopic !== topic) {
    switchExhibitionTopic(topic);
  }
  showBoardToast("새 포스트잇이 보드에 부착되었습니다! 📌");
}

// ============================================================================
// 사운드 토글 / 전체화면 / 관리 & CSV 내보내기
// ============================================================================
function toggleBoardSound() {
  PostitSound.enabled = !PostitSound.enabled;
  const icon = document.getElementById("boardSoundIcon");
  const text = document.getElementById("boardSoundText");
  if (icon) icon.textContent = PostitSound.enabled ? "🔊" : "🔇";
  if (text) text.textContent = PostitSound.enabled ? "소리 켬" : "소리 끔";
  if (PostitSound.enabled) PostitSound.playPop();
}

function toggleBoardFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}

function openAdminModal() {
  const modal = document.getElementById("adminModal");
  if (modal) modal.classList.remove("hidden");
}

function closeAdminModal() {
  const modal = document.getElementById("adminModal");
  if (modal) modal.classList.add("hidden");
}

// 엑셀 호환 CSV 다운로드
function exportPostitsToCsv() {
  if (!boardStore) return;
  const allNotes = boardStore.getAllNotes();
  if (allNotes.length === 0) {
    alert("저장된 포스트잇 메시지가 없습니다.");
    return;
  }

  const headers = ["전시관 번호", "주제", "작성자(From)", "포스트잇 메시지", "공감(하트)", "작성 시각"];
  const rows = allNotes.map((n) => {
    const topicTitle = Number(n.topic) === 1 ? "교원학습공동체 응원 한마디" : "영서중 동료선생님께 따뜻한 한마디";
    const dateStr = n.createdAt ? new Date(n.createdAt).toLocaleString("ko-KR") : "";
    const safeAuthor = `"${String(n.author || "영서중 동료선생님").replace(/"/g, '""')}"`;
    const safeContent = `"${String(n.content || "").replace(/"/g, '""')}"`;
    return [n.topic, `"${topicTitle}"`, safeAuthor, safeContent, n.likes || 0, `"${dateStr}"`].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = `영서중_교원학습공동체_및_연말응원_포스트잇_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// 현재 전시관 또는 전체 포스트잇 초기화
async function handleClearNotes(topicTarget) {
  if (!boardStore) return;
  const label =
    topicTarget === 1
      ? "1번 전시관(교원학습공동체 응원)"
      : topicTarget === 2
      ? "2번 전시관(동료선생님 한마디)"
      : "1번·2번 전체 전시관";

  const ok = confirm(`정말로 [${label}]의 모든 포스트잇을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`);
  if (!ok) return;

  await boardStore.clearNotes(topicTarget);
  closeAdminModal();
  showBoardToast(`${label} 포스트잇이 초기화되었습니다.`);
}

// 1번 전시관 / 2번 전시관을 각각 별도 창으로 띄우기 도우미
function openSeparateTopicWindow(topicNum) {
  const url = new URL(window.location.href);
  url.searchParams.set("topic", String(topicNum));
  window.open(url.toString(), `_blank`);
}

// 상단 토스트 알림
function showBoardToast(message) {
  const toast = document.getElementById("boardToast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(window.__boardToastTimer);
  window.__boardToastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3600);
}
