// ============================================================================
// 개별 선생님용 포스트잇 순차 작성 스크립트 (write.js)
// - 별도 로그인 없이 QR 접속 즉시 [1번 포스트잇] -> [2번 포스트잇] 순차 작성
// - 작성 즉시 Firebase Firestore (balance-efed2) 실시간 반영
// ============================================================================

let postitStore = null;

const writeState = {
  currentStep: 1, // 1: 주제1 작성 | 2: 주제2 작성 | 3: 작성 완료
  authorName: "", // 선택 입력 (1번에서 적으면 2번에도 자동 연결)
  notes: {
    1: {
      id: null,
      content: "",
      color: "yellow",
      pinStyle: "tape",
      saved: false
    },
    2: {
      id: null,
      content: "",
      color: "pink",
      pinStyle: "pin-red",
      saved: false
    }
  },
  isSubmitting: false
};

window.addEventListener("DOMContentLoaded", () => {
  initWritePage();
});

function initWritePage() {
  const roomId = getPostitRoomId();
  postitStore = new PostitStore(roomId);

  // 실시간 연결 상태 배지 업데이트
  postitStore.subscribe(
    () => {},
    (connected, label) => {
      const badge = document.getElementById("writeConnectionBadge");
      if (!badge) return;
      if (connected) {
        badge.className =
          "px-2.5 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 font-bold shadow-xs";
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>실시간 연결됨</span>`;
      } else {
        badge.className =
          "px-2.5 py-1 text-xs rounded-full bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5 font-bold shadow-xs";
        badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span><span>${escapeHtml(label)}</span>`;
      }
    }
  );

  // URL 파라미터로 특정 단계 지정 시 (?step=2, ?preview=1)
  const params = new URLSearchParams(window.location.search);
  const stepParam = Number(params.get("step"));
  if (stepParam === 1 || stepParam === 2 || stepParam === 3) {
    writeState.currentStep = stepParam;
  }

  if (params.get("preview") === "1") {
    writeState.authorName = "2학년부 동료교사";
    writeState.notes[1].content =
      "바쁜 2학기 일정 속에서도 열정적으로 연구하고 깊이 있는 나눔을 해주신 교원학습공동체 선생님들 정말 멋지십니다! 발표 들으며 많은 영감을 얻었어요 👏❤️";
    writeState.notes[1].saved = writeState.currentStep >= 2;
    writeState.notes[2].content =
      "늘 옆에서 따뜻하게 웃어주시고 든든한 힘이 되어주시는 영서중 선생님들! 올 한 해도 선생님들과 함께여서 행복했습니다. 연말까지 건강하게 화이팅해요 🥰🍀";
    writeState.notes[2].saved = writeState.currentStep === 3;
  }

  renderColorPalette();
  renderCurrentStep();
}

// 6가지 포스트잇 색상 팔레트 렌더링
function renderColorPalette() {
  const container = document.getElementById("colorSwatchContainer");
  if (!container) return;

  const step = writeState.currentStep === 2 ? 2 : 1;
  const activeColor = writeState.notes[step].color;

  container.innerHTML = POSTIT_COLORS.map((c) => {
    const isActive = c.id === activeColor;
    return `
      <button
        type="button"
        onclick="selectPostitColor('${c.id}')"
        class="color-swatch ${isActive ? "active" : ""}"
        style="background-color: ${c.hex}; border-color: ${isActive ? "#0f172a" : c.border};"
        title="${c.name} 포스트잇"
        aria-label="${c.name} 포스트잇"
      >
        ${isActive ? '<span class="text-xs font-black text-slate-900">✓</span>' : ""}
      </button>
    `;
  }).join("");
}

// 포스트잇 색상 변경
function selectPostitColor(colorId) {
  const step = writeState.currentStep === 2 ? 2 : 1;
  writeState.notes[step].color = colorId;

  const editorCard = document.getElementById("postitEditorCard");
  if (editorCard) {
    POSTIT_COLORS.forEach((c) => editorCard.classList.remove(c.className));
    editorCard.classList.add(getColorClass(colorId));
  }

  renderColorPalette();
}

// 현재 입력 중인 내용을 상태에 동기화
function syncInputsToState() {
  if (writeState.currentStep !== 1 && writeState.currentStep !== 2) return;
  const step = writeState.currentStep;

  const textarea = document.getElementById("postitContentInput");
  const authorInput = document.getElementById("postitAuthorInput");

  if (textarea) {
    writeState.notes[step].content = textarea.value;
  }
  if (authorInput) {
    writeState.authorName = authorInput.value;
  }
}

// 글자수 카운터 갱신
function handleTextareaInput() {
  const textarea = document.getElementById("postitContentInput");
  const counter = document.getElementById("charCountText");
  if (!textarea || !counter) return;

  const len = textarea.value.length;
  counter.textContent = `${len} / 300자`;

  if (writeState.currentStep === 1 || writeState.currentStep === 2) {
    writeState.notes[writeState.currentStep].content = textarea.value;
  }
}

// 빠른 문구 칩 클릭 시 텍스트 영역에 추가
function insertQuickChip(chipText) {
  const textarea = document.getElementById("postitContentInput");
  if (!textarea) return;

  const current = textarea.value.trim();
  if (!current) {
    textarea.value = chipText;
  } else if (!current.includes(chipText)) {
    textarea.value = current + "\n" + chipText;
  }
  textarea.focus();
  handleTextareaInput();
}

// 단계(Step 1, Step 2, Step 3 완료) 화면 전환 및 렌더링
function renderCurrentStep() {
  const step = writeState.currentStep;

  const editorSection = document.getElementById("sectionEditor");
  const completeSection = document.getElementById("sectionComplete");

  // 상단 단계 탭 상태 업데이트
  const step1Tab = document.getElementById("stepTab1");
  const step2Tab = document.getElementById("stepTab2");

  if (step1Tab && step2Tab) {
    if (step === 1) {
      step1Tab.className =
        "flex-1 py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm bg-amber-500 text-white shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer";
      step2Tab.className =
        "flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm bg-white/80 text-slate-600 border border-slate-200 hover:bg-slate-100 transition flex items-center justify-center gap-1.5 cursor-pointer";
    } else if (step === 2) {
      step1Tab.className =
        "flex-1 py-2.5 px-3 rounded-xl font-bold text-xs sm:text-sm bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100 transition flex items-center justify-center gap-1.5 cursor-pointer";
      step2Tab.className =
        "flex-1 py-2.5 px-3 rounded-xl font-black text-xs sm:text-sm bg-rose-500 text-white shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer";
    }
  }

  const check1 = document.getElementById("step1SavedCheck");
  const check2 = document.getElementById("step2SavedCheck");
  if (check1) check1.classList.toggle("hidden", !writeState.notes[1].saved);
  if (check2) check2.classList.toggle("hidden", !writeState.notes[2].saved);

  // 완료 화면인 경우
  if (step === 3) {
    if (editorSection) editorSection.classList.add("hidden");
    if (completeSection) completeSection.classList.remove("hidden");
    renderCompletionSummary();
    return;
  }

  if (editorSection) editorSection.classList.remove("hidden");
  if (completeSection) completeSection.classList.add("hidden");

  const topicInfo = POSTIT_TOPICS[step];
  const noteState = writeState.notes[step];

  // 배지 및 타이틀 업데이트
  const stepBadge = document.getElementById("topicStepBadge");
  const titleEl = document.getElementById("topicTitleText");
  const subtitleEl = document.getElementById("topicSubtitleText");

  if (stepBadge) {
    if (step === 1) {
      stepBadge.className =
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-amber-100 text-amber-900 border border-amber-300";
      stepBadge.innerHTML = `<span>🔥 첫 번째 포스트잇 (1/2)</span>`;
    } else {
      stepBadge.className =
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black bg-rose-100 text-rose-900 border border-rose-300";
      stepBadge.innerHTML = `<span>💝 두 번째 포스트잇 (2/2)</span>`;
    }
  }

  if (titleEl) {
    titleEl.textContent = `${step}. ${topicInfo.title}`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = topicInfo.subtitle;
  }

  // 포스트잇 카드 색상 및 상단 장식 반영
  const editorCard = document.getElementById("postitEditorCard");
  if (editorCard) {
    POSTIT_COLORS.forEach((c) => editorCard.classList.remove(c.className));
    editorCard.classList.add(getColorClass(noteState.color));
  }

  const pinDecor = document.getElementById("editorPinDecor");
  if (pinDecor) {
    pinDecor.innerHTML =
      step === 1 ? `<div class="postit-tape"></div>` : `<div class="postit-pin"></div>`;
  }

  // 포스트잇 내부 라벨
  const innerTopicLabel = document.getElementById("innerPostitTopicLabel");
  if (innerTopicLabel) {
    innerTopicLabel.textContent =
      step === 1
        ? "TO. 뜨거운 열정의 교원학습공동체 선생님들께"
        : "TO. 소중한 영서중학교 동료 선생님들께";
  }

  // 텍스트 영역 & 작성자 입력란 값 채우기
  const textarea = document.getElementById("postitContentInput");
  if (textarea) {
    textarea.placeholder = topicInfo.placeholder;
    textarea.value = noteState.content || "";
  }

  const authorInput = document.getElementById("postitAuthorInput");
  if (authorInput) {
    authorInput.value = writeState.authorName || "";
  }

  handleTextareaInput();
  renderColorPalette();

  // 빠른 예시 문구 칩 렌더링
  const chipsContainer = document.getElementById("quickChipsContainer");
  if (chipsContainer) {
    chipsContainer.innerHTML = topicInfo.quickChips
      .map(
        (chip) => `
        <button
          type="button"
          onclick="insertQuickChip('${escapeHtml(chip)}')"
          class="text-left text-xs px-3 py-1.5 rounded-xl bg-white/90 hover:bg-white text-slate-700 border border-slate-200/90 shadow-2xs transition active:scale-95 cursor-pointer"
        >
          💬 ${escapeHtml(chip)}
        </button>
      `
      )
      .join("");
  }

  // 하단 버튼 영역 구성
  const btnPrevStep = document.getElementById("btnPrevStep");
  const btnPrimarySubmit = document.getElementById("btnPrimarySubmit");
  const btnSkipStep = document.getElementById("btnSkipStep");

  if (step === 1) {
    if (btnPrevStep) btnPrevStep.classList.add("hidden");
    if (btnPrimarySubmit) {
      btnPrimarySubmit.className =
        "w-full py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-black text-base sm:text-lg shadow-lg shadow-amber-500/20 transition transform active:scale-98 flex items-center justify-center gap-2 cursor-pointer";
      btnPrimarySubmit.innerHTML = writeState.notes[1].saved
        ? `<span>1번 포스트잇 수정 저장 후 2번으로 👉</span>`
        : `<span>📌 1번 포스트잇 붙이고 다음(2번)으로 👉</span>`;
    }
    if (btnSkipStep) {
      btnSkipStep.classList.remove("hidden");
      btnSkipStep.textContent = "2번 포스트잇(동료 선생님께 한마디) 먼저 작성하기 →";
    }
  } else {
    if (btnPrevStep) btnPrevStep.classList.remove("hidden");
    if (btnPrimarySubmit) {
      btnPrimarySubmit.className =
        "flex-1 py-4 px-6 rounded-2xl bg-gradient-to-r from-rose-500 via-pink-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white font-black text-base sm:text-lg shadow-lg shadow-rose-500/20 transition transform active:scale-98 flex items-center justify-center gap-2 cursor-pointer";
      btnPrimarySubmit.innerHTML = writeState.notes[2].saved
        ? `<span>✨ 2번 포스트잇 수정 완료하기!</span>`
        : `<span>✨ 2번 포스트잇까지 붙이기 완료!</span>`;
    }
    if (btnSkipStep) {
      if (writeState.notes[1].saved) {
        btnSkipStep.classList.remove("hidden");
        btnSkipStep.textContent = "1번 포스트잇만 붙이고 완료 화면으로 가기 →";
      } else {
        btnSkipStep.classList.add("hidden");
      }
    }
  }
}

// 상단 탭으로 직접 단계 이동
function goToStep(stepNum) {
  syncInputsToState();
  writeState.currentStep = stepNum;
  renderCurrentStep();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 건너뛰기 버튼 처리
function handleSkipStep() {
  syncInputsToState();
  if (writeState.currentStep === 1) {
    writeState.currentStep = 2;
    renderCurrentStep();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (writeState.currentStep === 2 && writeState.notes[1].saved) {
    writeState.currentStep = 3;
    renderCurrentStep();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

// 메인 제출 버튼 처리 (Step 1 저장 후 Step 2 이동 / Step 2 저장 후 완료)
async function handleSubmitCurrentStep(event) {
  if (event) event.preventDefault();
  if (writeState.isSubmitting) return;

  syncInputsToState();
  const step = writeState.currentStep;
  const noteData = writeState.notes[step];
  const trimmedContent = (noteData.content || "").trim();

  if (!trimmedContent) {
    showWriteToast("포스트잇에 따뜻한 한마디를 적어주세요! ✍️", "amber");
    const textarea = document.getElementById("postitContentInput");
    if (textarea) textarea.focus();
    return;
  }

  writeState.isSubmitting = true;
  const btn = document.getElementById("btnPrimarySubmit");
  const originalBtnHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<span>⏳ 포스트잇을 보드에 붙이는 중...</span>`;
  }

  try {
    const savedNote = await postitStore.saveNote({
      id: noteData.id,
      topic: step,
      content: trimmedContent,
      author: writeState.authorName.trim() || "영서중 동료선생님",
      color: noteData.color,
      pinStyle: noteData.pinStyle
    });

    writeState.notes[step].id = savedNote.id;
    writeState.notes[step].saved = true;

    PostitSound.playStick();

    if (step === 1) {
      showWriteToast("1번 포스트잇이 보드에 부착되었습니다! 이제 2번 포스트잇을 적어보세요 📌", "emerald");
      writeState.currentStep = 2;
      renderCurrentStep();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // 2번까지 완료! 꽃가루 효과
      if (typeof confetti === "function") {
        confetti({
          particleCount: 70,
          spread: 65,
          origin: { y: 0.6 }
        });
      }
      writeState.currentStep = 3;
      renderCurrentStep();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  } catch (err) {
    console.error("포스트잇 저장 실패:", err);
    showWriteToast("저장 중 문제가 발생했습니다. 다시 시도해 주세요.", "rose");
  } finally {
    writeState.isSubmitting = false;
    if (btn) {
      btn.disabled = false;
      if (writeState.currentStep !== 3) {
        renderCurrentStep();
      } else {
        btn.innerHTML = originalBtnHtml;
      }
    }
  }
}

// 완료 화면(Step 3) 요약 렌더링
function renderCompletionSummary() {
  const container = document.getElementById("completedNotesPreview");
  if (!container) return;

  const cardsHtml = [1, 2]
    .map((topicNum) => {
      const n = writeState.notes[topicNum];
      const topicInfo = POSTIT_TOPICS[topicNum];
      if (!n.saved || !n.content.trim()) {
        return `
          <div class="p-5 rounded-2xl border-2 border-dashed border-slate-300 bg-white/60 text-center space-y-2">
            <span class="text-xs font-bold text-slate-500">${topicInfo.badge}</span>
            <p class="text-sm text-slate-500">아직 작성하지 않은 포스트잇입니다.</p>
            <button
              type="button"
              onclick="goToStep(${topicNum})"
              class="px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition cursor-pointer"
            >
              ✍️ ${topicNum}번 포스트잇 작성하러 가기
            </button>
          </div>
        `;
      }

      return `
        <div class="postit-editor-card ${getColorClass(n.color)} p-5 text-left space-y-3">
          ${topicNum === 1 ? '<div class="postit-tape"></div>' : '<div class="postit-pin"></div>'}
          <div class="flex justify-between items-center border-b border-black/10 pb-2">
            <span class="text-xs font-black opacity-80">${topicInfo.icon} ${topicInfo.shortTitle}</span>
            <button
              type="button"
              onclick="goToStep(${topicNum})"
              class="px-2.5 py-1 rounded-lg bg-black/10 hover:bg-black/20 text-xs font-bold transition cursor-pointer"
            >
              ✏️ 수정
            </button>
          </div>
          <p class="text-base leading-relaxed whitespace-pre-wrap break-words font-medium">${escapeHtml(n.content)}</p>
          <div class="text-right text-xs font-bold opacity-75 pt-1">
            From. ${escapeHtml(writeState.authorName.trim() || "영서중 동료선생님")}
          </div>
        </div>
      `;
    })
    .join("");

  container.innerHTML = cardsHtml;
}

// 새로운 포스트잇 한 세트 더 작성하기
function startNewPostitSet() {
  writeState.notes = {
    1: {
      id: null,
      content: "",
      color: POSTIT_COLORS[Math.floor(Math.random() * POSTIT_COLORS.length)].id,
      pinStyle: "tape",
      saved: false
    },
    2: {
      id: null,
      content: "",
      color: POSTIT_COLORS[Math.floor(Math.random() * POSTIT_COLORS.length)].id,
      pinStyle: "pin-red",
      saved: false
    }
  };
  writeState.currentStep = 1;
  renderCurrentStep();
  showWriteToast("새 포스트잇이 준비되었습니다! ✍️", "emerald");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 토스트 알림창 표시
function showWriteToast(message, tone = "emerald") {
  const toast = document.getElementById("writeToast");
  if (!toast) return;

  const toneClasses = {
    emerald: "bg-emerald-900/95 text-white border-emerald-700",
    amber: "bg-amber-900/95 text-white border-amber-700",
    rose: "bg-rose-900/95 text-white border-rose-700"
  };

  toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl border shadow-xl text-xs sm:text-sm font-bold transition-all duration-300 ${
    toneClasses[tone] || toneClasses.emerald
  }`;
  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(window.__writeToastTimer);
  window.__writeToastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}
