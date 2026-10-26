// ============================================================================
// 영서중학교 교원학습공동체 발표회 & 연말 응원 포스트잇 코어 엔진 (postit_core.js)
// - 밸런스 게임과 동일한 Firebase DB (balance-efed2) 연동
// - 기존 배포된 보안 규칙(/rooms/{roomId}/votes/{voteId})과 100% 호환되는 경로 사용
// - Firestore onSnapshot + BroadcastChannel + localStorage 하이브리드 실시간 동기화
// ============================================================================

const POSTIT_DEFAULT_ROOM = "yeongseo_2026";
const POSTIT_STORAGE_KEY_PREFIX = "yeongseo_postits_";
const POSTIT_SESSION_KEY = "yeongseo_writer_session_id";
const GITHUB_PAGES_BASE_URL = "https://sjylim0829-commits.github.io/Community";

// 두 가지 포스트잇 주제 정의
const POSTIT_TOPICS = {
  1: {
    id: 1,
    badge: "주제 1 · 교원학습공동체 응원",
    shortTitle: "교원학습공동체 응원 한마디",
    title: "뜨거운 열정으로 연구에 참여해주신 교원학습공동체 참여 선생님들께 응원 한마디",
    subtitle: "2학기말 교원학습공동체 발표회를 빛내주신 선생님들께 따뜻한 격려와 응원의 마음을 남겨주세요!",
    icon: "🔥",
    placeholder: "예) 바쁜 2학기 일정 속에서도 열정적으로 연구하고 나눔해주신 선생님들 정말 멋지십니다! 덕분에 많은 영감을 얻었어요 👏",
    defaultColor: "yellow",
    quickChips: [
      "열정 가득한 연구와 나눔 정말 멋지십니다! 👏",
      "선생님들의 깊이 있는 발표 덕분에 많이 배웠어요 💡",
      "바쁜 학기 중에도 연구에 매진하신 노고에 박수를 보냅니다 ❤️",
      "함께 고민하고 성장하는 교원학습공동체 최고예요! ✨"
    ]
  },
  2: {
    id: 2,
    badge: "주제 2 · 영서중 동료선생님께",
    shortTitle: "영서중 동료선생님께 따뜻한 한마디",
    title: "연말을 향해 열심히 달려가고 있는 영서중 동료선생님들께 따뜻한 말 한마디",
    subtitle: "올 한 해도 우리 학교와 아이들을 위해 함께 애써주신 영서중학교 선생님들께 감사의 마음을 전해보세요!",
    icon: "💝",
    placeholder: "예) 늘 옆에서 따뜻하게 웃어주시고 힘이 되어주시는 영서중 선생님들! 올 한 해도 함께여서 든든했습니다. 연말까지 건강하게 화이팅해요 🥰",
    defaultColor: "pink",
    quickChips: [
      "올 한 해 선생님들과 함께여서 정말 든든하고 행복했습니다 🥰",
      "남은 2학기와 연말까지 모두 건강 챙기시며 화이팅해요! 🍀",
      "늘 따뜻한 미소로 배려해주시는 영서중 선생님들 감사합니다 🌸",
      "우리 영서중 선생님들 모두 올 한 해 정말 고생 많으셨습니다! 💖"
    ]
  }
};

// 포스트잇 6가지 파스텔 컬러 정의
const POSTIT_COLORS = [
  { id: "yellow", name: "노랑", hex: "#fef08a", border: "#facc15", className: "postit-yellow" },
  { id: "pink",   name: "핑크", hex: "#fecdd3", border: "#fb7185", className: "postit-pink" },
  { id: "mint",   name: "민트", hex: "#a7f3d0", border: "#34d399", className: "postit-mint" },
  { id: "blue",   name: "하늘", hex: "#bae6fd", border: "#38bdf8", className: "postit-blue" },
  { id: "purple", name: "라벤더", hex: "#e9d5ff", border: "#c084fc", className: "postit-purple" },
  { id: "orange", name: "피치", hex: "#fed7aa", border: "#fb923c", className: "postit-orange" }
];

const PIN_STYLES = ["tape", "pin-red", "pin-gold", "pin-blue", "pin-emerald"];

// 작성자 고유 세션 ID (로그인 없이 본인이 작성한 포스트잇 수정/식별용)
function getWriterSessionId() {
  let sid = localStorage.getItem(POSTIT_SESSION_KEY);
  if (!sid) {
    sid = "writer_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
    localStorage.setItem(POSTIT_SESSION_KEY, sid);
  }
  return sid;
}

// 현재 방 ID 추출 (?room= 파라미터 우선, 기본값: yeongseo_2026)
function getPostitRoomId() {
  const params = new URLSearchParams(window.location.search);
  const roomParam = params.get("room");
  if (roomParam && roomParam.trim()) {
    return roomParam.trim();
  }
  return POSTIT_DEFAULT_ROOM;
}

// 포스트잇 컬러 클래스 반환
function getColorClass(colorId) {
  const found = POSTIT_COLORS.find((c) => c.id === colorId);
  return found ? found.className : "postit-yellow";
}

// 시간 포맷 헬퍼 (예: 오후 2:35 / 방금 전)
function formatPostitTime(timestamp) {
  if (!timestamp) return "방금 전";
  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);
  if (diffSec < 45) return "방금 전";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}분 전`;

  try {
    const d = new Date(timestamp);
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    return "";
  }
}

// 자연스러운 회전 각도 생성 (포스트잇 ID 기반 결정론적 각도: -2.6deg ~ +2.6deg)
function getNoteRotation(noteId, savedRotation) {
  if (typeof savedRotation === "number" && !Number.isNaN(savedRotation)) {
    return savedRotation;
  }
  let hash = 0;
  const str = String(noteId || "note");
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const normalized = ((Math.abs(hash) % 52) - 26) / 10; // -2.6 ~ +2.5
  return normalized === 0 ? 0.8 : normalized;
}

// 포스트잇 상단 고정 장식 HTML 생성 (마스킹 테이프 또는 컬러 압정)
function renderPinOrTapeHtml(pinStyle, noteId) {
  let style = pinStyle;
  if (!style) {
    const idx = Math.abs(String(noteId || "").charCodeAt(noteId.length - 1) || 0) % PIN_STYLES.length;
    style = PIN_STYLES[idx];
  }
  if (style === "tape") {
    return `<div class="postit-tape"></div>`;
  }
  if (style === "pin-gold") {
    return `<div class="postit-pin pin-gold"></div>`;
  }
  if (style === "pin-blue") {
    return `<div class="postit-pin pin-blue"></div>`;
  }
  if (style === "pin-emerald") {
    return `<div class="postit-pin pin-emerald"></div>`;
  }
  return `<div class="postit-pin"></div>`;
}

// ============================================================================
// Web Audio API 효과음 합성기 (외부 음원 없이 브라우저 내장 사운드 제공)
// ============================================================================
const PostitSound = {
  ctx: null,
  enabled: true,

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  },

  // 포스트잇 붙일 때 경쾌한 퐁- 차임벨 효과음
  playStick() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [587.33, 880.0]; // D5 -> A5
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = now + idx * 0.08;
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.18, start);
        gain.gain.exponentialRampToValueAtTime(0.008, start + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + 0.25);
      });
    } catch (e) {}
  },

  // 전시 화면에 새 포스트잇이 도착했을 때 부드러운 알림 차임
  playNewArrival() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const start = now + idx * 0.075;
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.16, start);
        gain.gain.exponentialRampToValueAtTime(0.008, start + 0.32);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(start);
        osc.stop(start + 0.32);
      });
    } catch (e) {}
  },

  // 하트 공감 클릭 시 귀여운 팝 사운드
  playPop() {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(760, now + 0.09);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    } catch (e) {}
  }
};

// ============================================================================
// 로컬 스토리지 & BroadcastChannel 백업 매니저
// ============================================================================
function getLocalNotes(roomId) {
  try {
    const raw = localStorage.getItem(POSTIT_STORAGE_KEY_PREFIX + roomId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function setLocalNotes(roomId, notesArray) {
  try {
    localStorage.setItem(POSTIT_STORAGE_KEY_PREFIX + roomId, JSON.stringify(notesArray));
  } catch (e) {}
}

function upsertLocalNote(roomId, noteObj) {
  const list = getLocalNotes(roomId);
  const idx = list.findIndex((n) => n.id === noteObj.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...noteObj };
  } else {
    list.push(noteObj);
  }
  setLocalNotes(roomId, list);
  return list;
}

function removeLocalNote(roomId, noteId) {
  const list = getLocalNotes(roomId).filter((n) => n.id !== noteId);
  setLocalNotes(roomId, list);
  return list;
}

// ============================================================================
// 포스트잇 실시간 저장소 클래스 (Firestore + LocalBroadcast 통합)
// ============================================================================
class PostitStore {
  constructor(roomId) {
    this.roomId = roomId || getPostitRoomId();
    this.db = initFirebase();
    this.unsubscribe = null;
    this.notesMap = new Map(); // id -> noteObj
    this.listeners = [];
    this.statusListeners = [];
    this.isConnected = false;
    this.broadcast = null;

    this.initBroadcast();
  }

  initBroadcast() {
    if ("BroadcastChannel" in window) {
      try {
        this.broadcast = new BroadcastChannel("yeongseo_postit_channel_" + this.roomId);
        this.broadcast.onmessage = (event) => {
          const msg = event.data;
          if (!msg || !msg.type) return;
          if (msg.type === "UPSERT_NOTE" && msg.note) {
            this.notesMap.set(msg.note.id, msg.note);
            upsertLocalNote(this.roomId, msg.note);
            this.notifyListeners("upsert", msg.note);
          } else if (msg.type === "DELETE_NOTE" && msg.noteId) {
            this.notesMap.delete(msg.noteId);
            removeLocalNote(this.roomId, msg.noteId);
            this.notifyListeners("delete", { id: msg.noteId });
          } else if (msg.type === "CLEAR_TOPIC") {
            const topic = msg.topic;
            for (const [id, note] of this.notesMap.entries()) {
              if (!topic || Number(note.topic) === Number(topic)) {
                this.notesMap.delete(id);
              }
            }
            setLocalNotes(this.roomId, Array.from(this.notesMap.values()));
            this.notifyListeners("clear", { topic });
          }
        };
      } catch (e) {}
    }

    // 다른 탭에서 localStorage가 변경될 때도 감지
    window.addEventListener("storage", (e) => {
      if (e.key === POSTIT_STORAGE_KEY_PREFIX + this.roomId) {
        const localList = getLocalNotes(this.roomId);
        localList.forEach((n) => {
          if (n && n.id) this.notesMap.set(n.id, n);
        });
        this.notifyListeners("storage_sync");
      }
    });
  }

  // 컬렉션 참조 (기존 balance-efed2의 firestore.rules에서 allow read, write: if true가 보장된 경로)
  getCollectionRef() {
    if (!this.db) return null;
    return this.db.collection("rooms").doc(this.roomId).collection("votes");
  }

  // 실시간 구독 시작
  subscribe(onUpdate, onStatusChange) {
    if (onUpdate) this.listeners.push(onUpdate);
    if (onStatusChange) this.statusListeners.push(onStatusChange);

    // 1. 로컬 캐시 먼저 로드
    const cached = getLocalNotes(this.roomId);
    cached.forEach((n) => {
      if (n && n.id && (n.topic === 1 || n.topic === 2)) {
        this.notesMap.set(n.id, n);
      }
    });
    this.notifyListeners("initial_local");

    // 2. Firebase Firestore 실시간 onSnapshot 연결
    const colRef = this.getCollectionRef();
    if (!colRef) {
      this.updateStatus(false, "로컬 동기화 모드");
      return;
    }

    if (this.unsubscribe) {
      this.unsubscribe();
    }

    this.unsubscribe = colRef.onSnapshot(
      (snapshot) => {
        this.updateStatus(true, "실시간 연결됨");

        const remoteIds = new Set();
        let newlyAddedNote = null;

        snapshot.docChanges().forEach((change) => {
          const data = change.doc.data();
          const id = change.doc.id;
          if (!data || (Number(data.topic) !== 1 && Number(data.topic) !== 2)) return;

          const noteObj = {
            id: id,
            topic: Number(data.topic),
            content: data.content || "",
            author: data.author || "",
            color: data.color || (Number(data.topic) === 1 ? "yellow" : "pink"),
            pinStyle: data.pinStyle || "tape",
            rotation: getNoteRotation(id, data.rotation),
            likes: Number(data.likes || 0),
            createdAt: Number(data.createdAt || Date.now()),
            updatedAt: Number(data.updatedAt || Date.now()),
            writerSessionId: data.writerSessionId || ""
          };

          if (change.type === "added") {
            const existedBefore = this.notesMap.has(id);
            this.notesMap.set(id, noteObj);
            if (!existedBefore && Date.now() - noteObj.createdAt < 15000) {
              newlyAddedNote = noteObj;
            }
          } else if (change.type === "modified") {
            this.notesMap.set(id, noteObj);
          } else if (change.type === "removed") {
            this.notesMap.delete(id);
          }
        });

        snapshot.docs.forEach((doc) => {
          const d = doc.data();
          if (d && (Number(d.topic) === 1 || Number(d.topic) === 2)) {
            remoteIds.add(doc.id);
          }
        });

        // 원격에서 삭제된 항목 정리
        for (const existingId of Array.from(this.notesMap.keys())) {
          if (!remoteIds.has(existingId)) {
            this.notesMap.delete(existingId);
          }
        }

        // 로컬 스토리지 동기화
        setLocalNotes(this.roomId, this.getAllNotes());
        this.notifyListeners(newlyAddedNote ? "new_arrival" : "snapshot", newlyAddedNote);
      },
      (err) => {
        console.warn("Firestore onSnapshot 에러 (로컬 폴백 작동):", err);
        this.updateStatus(false, "로컬 모드");
      }
    );
  }

  updateStatus(connected, label) {
    this.isConnected = connected;
    this.statusListeners.forEach((fn) => {
      try {
        fn(connected, label);
      } catch (e) {}
    });
  }

  notifyListeners(eventType, payload = null) {
    const allNotes = this.getAllNotes();
    this.listeners.forEach((fn) => {
      try {
        fn(allNotes, eventType, payload);
      } catch (e) {
        console.error("Listener error:", e);
      }
    });
  }

  // 전체 포스트잇 목록 반환 (최신순 정렬)
  getAllNotes() {
    return Array.from(this.notesMap.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  // 특정 주제(1 또는 2) 포스트잇 목록 반환
  getNotesByTopic(topicNum) {
    return this.getAllNotes().filter((n) => Number(n.topic) === Number(topicNum));
  }

  // 포스트잇 저장 또는 수정
  async saveNote({ id, topic, content, author, color, pinStyle }) {
    const now = Date.now();
    const noteId = id || `note_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const existing = this.notesMap.get(noteId);

    const chosenPin =
      pinStyle ||
      (existing && existing.pinStyle) ||
      PIN_STYLES[Math.floor(Math.random() * PIN_STYLES.length)];

    const noteObj = {
      id: noteId,
      topic: Number(topic) === 2 ? 2 : 1,
      content: String(content || "").trim(),
      author: String(author || "").trim(),
      color: color || (Number(topic) === 2 ? "pink" : "yellow"),
      pinStyle: chosenPin,
      rotation: existing ? existing.rotation : getNoteRotation(noteId),
      likes: existing ? Number(existing.likes || 0) : 0,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
      writerSessionId: getWriterSessionId()
    };

    // 1. 메모리 & 로컬 즉시 반영
    this.notesMap.set(noteId, noteObj);
    upsertLocalNote(this.roomId, noteObj);
    if (this.broadcast) {
      this.broadcast.postMessage({ type: "UPSERT_NOTE", note: noteObj });
    }
    this.notifyListeners("upsert", noteObj);

    // 2. Firebase Firestore 저장
    const colRef = this.getCollectionRef();
    if (colRef) {
      try {
        await colRef.doc(noteId).set(noteObj, { merge: true });
      } catch (err) {
        console.error("Firestore 포스트잇 저장 오류:", err);
      }
    }

    return noteObj;
  }

  // 공감(하트) +1
  async likeNote(noteId) {
    const note = this.notesMap.get(noteId);
    if (!note) return null;

    const updated = {
      ...note,
      likes: Number(note.likes || 0) + 1,
      updatedAt: Date.now()
    };

    this.notesMap.set(noteId, updated);
    upsertLocalNote(this.roomId, updated);
    if (this.broadcast) {
      this.broadcast.postMessage({ type: "UPSERT_NOTE", note: updated });
    }
    this.notifyListeners("like", updated);

    const colRef = this.getCollectionRef();
    if (colRef) {
      try {
        if (window.firebase && window.firebase.firestore && window.firebase.firestore.FieldValue) {
          await colRef.doc(noteId).update({
            likes: window.firebase.firestore.FieldValue.increment(1),
            updatedAt: updated.updatedAt
          });
        } else {
          await colRef.doc(noteId).set(updated, { merge: true });
        }
      } catch (err) {
        console.warn("Firestore 공감 업데이트 오류:", err);
      }
    }
    return updated;
  }

  // 단일 포스트잇 삭제
  async deleteNote(noteId) {
    if (!noteId) return;
    this.notesMap.delete(noteId);
    removeLocalNote(this.roomId, noteId);
    if (this.broadcast) {
      this.broadcast.postMessage({ type: "DELETE_NOTE", noteId });
    }
    this.notifyListeners("delete", { id: noteId });

    const colRef = this.getCollectionRef();
    if (colRef) {
      try {
        await colRef.doc(noteId).delete();
      } catch (err) {
        console.warn("Firestore 포스트잇 삭제 오류:", err);
      }
    }
  }

  // 특정 주제(또는 전체) 포스트잇 일괄 삭제
  async clearNotes(topicNum = null) {
    const targets = this.getAllNotes().filter((n) => !topicNum || Number(n.topic) === Number(topicNum));

    targets.forEach((n) => this.notesMap.delete(n.id));
    setLocalNotes(this.roomId, this.getAllNotes());
    if (this.broadcast) {
      this.broadcast.postMessage({ type: "CLEAR_TOPIC", topic: topicNum });
    }
    this.notifyListeners("clear", { topic: topicNum });

    const colRef = this.getCollectionRef();
    if (colRef && targets.length > 0) {
      try {
        await Promise.all(targets.map((n) => colRef.doc(n.id).delete()));
      } catch (err) {
        console.warn("Firestore 일괄 삭제 오류:", err);
      }
    }
  }
}
