// main.js — phiên bản hoàn chỉnh hiển thị ngày rõ ràng cho lịch sử điểm

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { 
  getAuth, 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

import { firebaseConfig, getDOMElements, GEMINI_API_KEY, GEMINI_API_URL } from './config.js';
import { setupAuthListeners, getUserId } from './auth.js';
import { loadPosts, setupVideoListeners } from './video-feed.js';

const DOM = getDOMElements();

let app, db, auth, storage;

let currentUserId = null;
let habitChart = null;
let habitState = { habits: [], logs: [], stats: null };

const HABIT_CHART_DAYS = 7;

const getHabitsCollectionRef = () => collection(db, `artifacts/${firebaseConfig.projectId}/public/data/habits`);
const getHabitLogsCollectionRef = () => collection(db, `artifacts/${firebaseConfig.projectId}/public/data/habitLogs`);

const resetHabitSection = () => {
  habitState = { habits: [], logs: [], stats: null };
  if (habitChart) {
    habitChart.destroy();
    habitChart = null;
  }
  if (DOM.habitSummaryEl) DOM.habitSummaryEl.innerHTML = '';
  if (DOM.habitDefinitionsEl) DOM.habitDefinitionsEl.innerHTML = '';
  if (DOM.habitLogListEl) DOM.habitLogListEl.innerHTML = '';
  DOM.habitEmptyEl?.classList.add('hidden');
  DOM.habitDefinitionEmptyEl?.classList.add('hidden');
  if (DOM.habitAiMessageEl) {
    DOM.habitAiMessageEl.classList.add('hidden');
    DOM.habitAiMessageEl.textContent = '';
  }
};

const updateHabitStatus = (text, isError = false) => {
  if (!DOM.habitStatusEl) return;
  DOM.habitStatusEl.textContent = text;
  DOM.habitStatusEl.classList.toggle('text-rose-600', isError);
  DOM.habitStatusEl.classList.toggle('text-slate-500', !isError);
};

const toggleHabitSection = (shouldShow, statusMessage = '') => {
  if (!DOM.habitSection) return;
  if (shouldShow) {
    DOM.habitSection.classList.remove('hidden');
  } else {
    DOM.habitSection.classList.add('hidden');
    resetHabitSection();
  }
  if (statusMessage || !shouldShow) {
    updateHabitStatus(statusMessage, false);
  }
};

const setHabitRefreshLoading = (isLoading) => {
  if (!DOM.habitRefreshBtn) return;
  DOM.habitRefreshBtn.disabled = isLoading;
  DOM.habitRefreshBtn.classList.toggle('opacity-60', isLoading);
  DOM.habitRefreshBtn.classList.toggle('cursor-not-allowed', isLoading);
};

const formatDateKey = (date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatShortDate = (date) => new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit'
}).format(date);

const formatFullDate = (date) => new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit',
  minute: '2-digit',
  day: '2-digit',
  month: '2-digit'
}).format(date);

const getDateFromLog = (log) => {
  const ts = log?.timestamp || log?.time;
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts === 'number') return new Date(ts);
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return new Date(parsed);
  }
  return null;
};

const calculateHabitStreak = (byDateMap) => {
  let streak = 0;
  const cursor = new Date();
  while (streak <= 365) {
    const key = formatDateKey(cursor);
    if (byDateMap.has(key)) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
};

const computeHabitStats = (habits, logs) => {
  const byDate = new Map();
  const perHabit = new Map();
  const todayKey = formatDateKey(new Date());
  let latestTimestamp = null;

  logs.forEach((log) => {
    const date = getDateFromLog(log);
    if (!date) return;
    const key = formatDateKey(date);
    byDate.set(key, (byDate.get(key) || 0) + 1);

    const habitId = log.habitId || log.habit || log.id || 'unknown';
    const counts = perHabit.get(habitId) || { today: 0, total: 0 };
    counts.total += 1;
    if (key === todayKey) counts.today += 1;
    perHabit.set(habitId, counts);

    if (!latestTimestamp || date > latestTimestamp) {
      latestTimestamp = date;
    }
  });

  let topHabitId = null;
  let topHabitTotal = 0;
  perHabit.forEach((counts, habitId) => {
    if (counts.total > topHabitTotal) {
      topHabitTotal = counts.total;
      topHabitId = habitId;
    }
  });

  return {
    todayCount: byDate.get(todayKey) || 0,
    totalCount: logs.length,
    habitsTracked: habits.length || perHabit.size,
    streak: calculateHabitStreak(byDate),
    byDate,
    perHabit,
    latestTimestamp,
    topHabitId,
    topHabitTotal
  };
};

const buildChartDataset = (byDate) => {
  const labels = [];
  const values = [];
  const base = new Date();
  for (let offset = HABIT_CHART_DAYS - 1; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(base.getDate() - offset);
    labels.push(formatShortDate(day));
    const key = formatDateKey(day);
    values.push(byDate.get(key) || 0);
  }
  return { labels, values };
};

const renderHabitSummary = (stats) => {
  if (!DOM.habitSummaryEl) return;
  const summaryItems = [
    {
      title: 'Hoàn thành hôm nay',
      value: stats.todayCount,
      caption: 'Số lần bật công tắc trong ngày',
      style: 'bg-gradient-to-br from-sky-500 to-sky-600 text-white'
    },
    {
      title: 'Chuỗi ngày duy trì',
      value: stats.streak,
      caption: 'Số ngày liên tục có ít nhất một lượt',
      style: 'bg-gradient-to-br from-emerald-500 to-emerald-600 text-white'
    },
    {
      title: 'Nhật ký đã lưu',
      value: stats.totalCount,
      caption: 'Tổng lượt hoàn thành được ghi nhận',
      style: 'bg-slate-900 text-white'
    },
    {
      title: 'Thói quen theo dõi',
      value: stats.habitsTracked,
      caption: 'Được cấu hình trong Firestore',
      style: 'bg-slate-100 text-slate-800 border border-slate-200'
    }
  ];

  DOM.habitSummaryEl.innerHTML = summaryItems.map((item) => `
    <div class="rounded-2xl ${item.style} p-4 shadow-md">
      <p class="text-xs uppercase tracking-wide opacity-80">${item.title}</p>
      <p class="text-3xl font-extrabold mt-2">${item.value}</p>
      <p class="text-xs mt-2 opacity-90">${item.caption}</p>
    </div>
  `).join('');
};

const renderHabitDefinitions = (habits, stats) => {
  if (!DOM.habitDefinitionsEl || !DOM.habitDefinitionEmptyEl) return;

  if (!habits.length) {
    DOM.habitDefinitionsEl.innerHTML = '';
    DOM.habitDefinitionEmptyEl.classList.remove('hidden');
    return;
  }

  DOM.habitDefinitionEmptyEl.classList.add('hidden');
  DOM.habitDefinitionsEl.innerHTML = habits.map((habit) => {
    const habitId = habit.id;
    const counts = stats.perHabit.get(habitId) || { today: 0, total: 0 };
    const goal = typeof habit.dailyGoal === 'number' && habit.dailyGoal > 0
      ? `${counts.today}/${habit.dailyGoal} lần hôm nay`
      : `${counts.today} lần hôm nay`;
    const description = habit.description || habit.note || '';
    const name = habit.name || habit.title || habitId || 'Thói quen';

    return `
      <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition">
        <div class="flex items-start justify-between gap-2">
          <h4 class="text-base font-semibold text-slate-800">${name}</h4>
          <span class="text-xs font-semibold px-2 py-1 bg-slate-100 text-slate-600 rounded-full">Tổng: ${counts.total}</span>
        </div>
        ${description ? `<p class="text-sm text-slate-500 mt-2">${description}</p>` : ''}
        <p class="text-sm font-medium text-slate-700 mt-3">${goal}</p>
      </div>
    `;
  }).join('');
};

const renderHabitLogs = (logs, habits) => {
  if (!DOM.habitLogListEl || !DOM.habitEmptyEl) return;

  if (!logs.length) {
    DOM.habitLogListEl.innerHTML = '';
    DOM.habitEmptyEl.classList.remove('hidden');
    return;
  }

  DOM.habitEmptyEl.classList.add('hidden');
  const habitMap = new Map(habits.map((habit) => [habit.id, habit]));

  DOM.habitLogListEl.innerHTML = logs.slice(0, 12).map((log) => {
    const habitId = log.habitId || log.habit || log.id;
    const habitInfo = habitMap.get(habitId) || {};
    const name = habitInfo.name || habitInfo.title || log.habitName || habitId || 'Không rõ thói quen';
    const note = log.note || habitInfo.reminder || '';
    const date = getDateFromLog(log);
    const timeLabel = date ? formatFullDate(date) : 'Không rõ thời gian';

    return `
      <li class="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-sm font-semibold text-slate-800">${name}</p>
            ${note ? `<p class="text-xs text-slate-500 mt-1">${note}</p>` : ''}
          </div>
          <span class="text-xs font-medium text-slate-500 whitespace-nowrap">${timeLabel}</span>
        </div>
      </li>
    `;
  }).join('');
};

const updateHabitChart = (stats) => {
  if (!DOM.habitChartCanvas || typeof Chart === 'undefined') return;
  const { labels, values } = buildChartDataset(stats.byDate);
  const ctx = DOM.habitChartCanvas.getContext('2d');

  if (!habitChart) {
    habitChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Lượt hoàn thành',
          data: values,
          backgroundColor: '#0ea5e9',
          borderRadius: 12
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        },
        plugins: {
          legend: { display: false }
        }
      }
    });
  } else {
    habitChart.data.labels = labels;
    habitChart.data.datasets[0].data = values;
    habitChart.update();
  }
};

const renderHabitTracker = (habits, logs) => {
  habitState = { habits, logs, stats: computeHabitStats(habits, logs) };
  const { stats } = habitState;

  toggleHabitSection(true);

  const statusMessage = stats.latestTimestamp
    ? `Cập nhật lần cuối: ${formatFullDate(stats.latestTimestamp)}`
    : 'Chưa có nhật ký nào từ bảng công tắc.';
  updateHabitStatus(statusMessage, false);

  renderHabitSummary(stats);
  renderHabitDefinitions(habits, stats);
  renderHabitLogs(logs, habits);
  updateHabitChart(stats);
};

const fetchHabitCollections = async (userId) => {
  const [habitsSnapshot, logsSnapshot] = await Promise.all([
    getDocs(getHabitsCollectionRef()),
    getDocs(query(getHabitLogsCollectionRef(), where('userId', '==', userId)))
  ]);

  const habits = habitsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  const logs = logsSnapshot.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .sort((a, b) => {
      const timeA = getDateFromLog(a)?.getTime() || 0;
      const timeB = getDateFromLog(b)?.getTime() || 0;
      return timeB - timeA;
    });

  return { habits, logs };
};

const refreshHabitTracker = async (userId) => {
  if (!userId) {
    toggleHabitSection(false, 'Vui lòng đăng nhập để xem nhật ký thói quen.');
    return;
  }

  setHabitRefreshLoading(true);
  updateHabitStatus('Đang tải dữ liệu thói quen...', false);

  try {
    const { habits, logs } = await fetchHabitCollections(userId);
    renderHabitTracker(habits, logs);
  } catch (error) {
    console.error('Lỗi tải dữ liệu Habit Tracker:', error);
    updateHabitStatus('Không thể tải dữ liệu thói quen. Vui lòng thử lại.', true);
  } finally {
    setHabitRefreshLoading(false);
  }
};

const escapeHtml = (unsafe) => unsafe
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const displayHabitAiMessage = (text) => {
  if (!DOM.habitAiMessageEl) return;
  DOM.habitAiMessageEl.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  DOM.habitAiMessageEl.classList.remove('hidden');
};

const buildHabitDetailsForPrompt = (habits, stats) => {
  if (!stats.perHabit || stats.perHabit.size === 0) return 'Chưa có thói quen nào được ghi nhận.';
  const habitMap = new Map(habits.map((habit) => [habit.id, habit]));
  const lines = [];
  stats.perHabit.forEach((counts, habitId) => {
    const habit = habitMap.get(habitId) || {};
    const name = habit.name || habit.title || habitId;
    const goal = typeof habit.dailyGoal === 'number' && habit.dailyGoal > 0
      ? `${counts.today}/${habit.dailyGoal} lần hôm nay`
      : `${counts.today} lần hôm nay`;
    lines.push(`${name}: ${goal}, tổng cộng ${counts.total} lần.`);
  });
  return lines.join('\n- ');
};

const requestHabitMotivation = async () => {
  if (!habitState.stats) {
    throw new Error('Chưa có thống kê thói quen.');
  }

  const stats = habitState.stats;
  const detailLines = buildHabitDetailsForPrompt(habitState.habits, stats);
  const prompt = `Bạn là trợ lý truyền cảm hứng cho học sinh lớp 9 đang rèn luyện thói quen học tập bằng bảng công tắc ESP32-C3.`
    + ` Dựa trên dữ liệu:\n- Lần hoàn thành hôm nay: ${stats.todayCount}\n- Chuỗi ngày duy trì: ${stats.streak}\n- Tổng lượt ghi nhận: ${stats.totalCount}`
    + `\n- Chi tiết từng thói quen:\n- ${detailLines}\n\nHãy viết một đoạn động viên ngắn (2-3 câu) bằng tiếng Việt, thân thiện, tập trung vào việc duy trì và cải thiện thói quen.`;

  const response = await fetch(GEMINI_API_URL + GEMINI_API_KEY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API trả về mã ${response.status}`);
  }

  const data = await response.json();
  const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!answer) {
    throw new Error('Không nhận được phản hồi hợp lệ từ Gemini.');
  }
  return answer;
};

try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);

  DOM.authStatusEl.textContent = "Đang tải...";

  const getPostsCollectionRef = () => collection(db, `artifacts/${firebaseConfig.projectId}/public/data/videos`);
  toggleHabitSection(false, 'Vui lòng đăng nhập để xem nhật ký thói quen.');

  const handleUserLogin = async (userId) => {
    currentUserId = userId;
    loadPosts(db, DOM, getPostsCollectionRef);
    await refreshHabitTracker(userId);
  };

  const handleUserLogout = () => {
    currentUserId = null;
    toggleHabitSection(false, 'Vui lòng đăng nhập để xem nhật ký thói quen.');
  };

  setupAuthListeners(auth, DOM, handleUserLogin, handleUserLogout);
  setupVideoListeners(DOM, { db, storage, getPostsCollectionRef, getUserId });

  if (DOM.habitRefreshBtn) {
    DOM.habitRefreshBtn.addEventListener('click', () => {
      if (!currentUserId) {
        toggleHabitSection(false, 'Vui lòng đăng nhập để xem nhật ký thói quen.');
        return;
      }
      refreshHabitTracker(currentUserId);
    });
  }

  if (DOM.habitAiBtn) {
    DOM.habitAiBtn.addEventListener('click', async () => {
      if (!habitState.stats || habitState.stats.totalCount === 0) {
        displayHabitAiMessage('Chưa có dữ liệu thói quen để trợ lý AI phân tích. Hãy bật công tắc ít nhất một lần nhé!');
        return;
      }

      DOM.habitAiBtn.disabled = true;
      DOM.habitAiBtn.classList.add('opacity-60', 'cursor-not-allowed');
      displayHabitAiMessage('Đang tạo gợi ý động lực...');

      try {
        const answer = await requestHabitMotivation();
        displayHabitAiMessage(answer);
      } catch (error) {
        console.error('Lỗi gọi Gemini cho Habit Tracker:', error);
        displayHabitAiMessage('Không thể kết nối tới trợ lý AI lúc này. Bạn hãy thử lại sau nhé.');
      } finally {
        DOM.habitAiBtn.disabled = false;
        DOM.habitAiBtn.classList.remove('opacity-60', 'cursor-not-allowed');
      }
    });
  }
// =============================== NÚT THÊM VIDEO ===============================
const openPostBtn = document.getElementById('open-post-modal-btn');
const postModal = document.getElementById('post-modal');

if (openPostBtn && postModal) {
  openPostBtn.addEventListener('click', () => {
    const user = auth.currentUser;
    if (!user) {
      alert("Vui lòng đăng nhập trước khi đăng video.");
      return;
    }
    postModal.classList.remove('hidden');
    postModal.classList.add('flex');
  });
}

  // ========================= PROFILE =========================
  const profileBtn = document.getElementById('open-profile-btn');
  const profileModal = document.getElementById('profile-modal');
  const profileForm = document.getElementById('profile-form');
  const avatarUpload = document.getElementById('avatar-upload');
  const avatarImg = document.getElementById('profile-avatar');

  function showProfileMessage(text, isSuccess = true) {
    let toast = document.getElementById('center-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'center-toast';
      toast.className = `
        fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 
        px-6 py-3 rounded-xl text-white text-lg font-semibold 
        shadow-2xl z-[9999] transition-opacity duration-500
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    toast.style.backgroundColor = isSuccess ? '#16a34a' : '#dc2626';
    toast.style.opacity = '1';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
  }

  if (profileBtn) {
    profileBtn.addEventListener('click', async () => {
      const user = auth.currentUser;
      if (!user) return alert("Vui lòng đăng nhập trước.");
      profileModal?.classList.remove('hidden');
      profileModal?.classList.add('flex');

      try {
        const refUser = doc(db, 'users', user.uid);
        const snap = await getDoc(refUser);
        const nameEl = document.getElementById('profile-name');
        const emailEl = document.getElementById('profile-email');
        const nameInput = document.getElementById('profile-name-input');
        const emailInput = document.getElementById('profile-email-input');

        if (snap.exists()) {
          const data = snap.data();
          nameEl.textContent = data.name || user.email || "";
          emailEl.textContent = data.email || user.email || "";
          nameInput.value = data.name || "";
          emailInput.value = data.email || user.email || "";
          document.getElementById('profile-dob').value = data.dob || '';
          document.getElementById('profile-gender').value = data.gender || '';
          document.getElementById('profile-school').value = data.school || '';
          document.getElementById('profile-class').value = data.class || '';
          avatarImg.src = data.photoUrl || "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
        } else {
          nameEl.textContent = user.email || "Chưa có thông tin";
          emailEl.textContent = user.email || "";
          avatarImg.src = "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
        }
      } catch (err) {
        console.error("Lỗi tải profile:", err);
        showProfileMessage("Không thể tải hồ sơ.", false);
      }
    });
  }

  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);

      const name = document.getElementById('profile-name-input').value.trim();
      const email = document.getElementById('profile-email-input').value.trim();
      const dob = document.getElementById('profile-dob').value.trim();
      const gender = document.getElementById('profile-gender').value;
      const school = document.getElementById('profile-school').value.trim();
      const className = document.getElementById('profile-class').value.trim();

      try {
        await setDoc(doc(db, 'users', user.uid), {
          name, email, dob, gender, school, class: className
        }, { merge: true });
        showProfileMessage("Đã lưu thông tin thành công!");
        document.getElementById('profile-name').textContent = name;
        document.getElementById('profile-email').textContent = email;
      } catch (err) {
        console.error("Lỗi lưu profile:", err);
        showProfileMessage("Không thể lưu. Thử lại.", false);
      }
    });
  }

  const changePassBtn = document.getElementById('change-password-btn');
  if (changePassBtn) {
    changePassBtn.addEventListener('click', async () => {
      const newPassEl = document.getElementById('profile-new-password');
      const newPass = newPassEl.value.trim();
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);
      if (newPass.length < 6) return showProfileMessage("Mật khẩu phải từ 6 ký tự.", false);

      try {
        const oldPass = prompt("Nhập lại mật khẩu hiện tại để xác nhận:");
        if (!oldPass) throw new Error("Chưa nhập mật khẩu hiện tại.");
        const credential = EmailAuthProvider.credential(user.email, oldPass);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPass);
        newPassEl.value = '';
        showProfileMessage("Đã đổi mật khẩu thành công!");
      } catch (err) {
        console.error("Lỗi đổi mật khẩu:", err);
        showProfileMessage("Không thể đổi mật khẩu.", false);
      }
    });
  }

  if (avatarUpload) {
    avatarUpload.addEventListener('change', async (e) => {
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const storageRef = ref(storage, `avatars/${user.uid}/${Date.now()}_${file.name}`);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);
        avatarImg.src = url;
        await setDoc(doc(db, 'users', user.uid), { photoUrl: url }, { merge: true });
        showProfileMessage("Đã cập nhật ảnh đại diện!");
      } catch (err) {
        console.error("Lỗi upload avatar:", err);
        showProfileMessage("Không thể tải ảnh.", false);
      }
    });
  }

} catch (error) {
  console.error("Lỗi khởi tạo ứng dụng:", error);
}

// =============================== GAME CENTER ===============================
const gameBtn = document.getElementById('open-game-btn');
if (gameBtn) {
  gameBtn.addEventListener('click', async () => {
    const modal = document.getElementById('game-center-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    await loadUserLeaderboard();
  });
}

// Hàm tính điểm
function calculateDailyScore(data) {
  const usageMinutes = data.usageMinutesToday || 0;
  const videosCount = data.videosCount || 0;
  const lostVideos = data.lostVideos || 0;
  let score = data.baseScore || 0;
  if (usageMinutes <= 45) score += 1; else score -= 1;
  score += videosCount;
  score -= lostVideos;
  return score;
}

// Hàm format ngày chuẩn
function formatHistoryDate(d) {
  if (!d) return 'Không rõ ngày';
  if (typeof d.toDate === 'function') return d.toDate().toLocaleString('vi-VN');
  if (d.seconds) return new Date(d.seconds * 1000).toLocaleString('vi-VN');
  if (typeof d === 'string') return d;
  try { return String(d); } catch { return 'Không rõ ngày'; }
}

// Ghi lịch sử điểm mới
async function addScoreHistory(userId, change, reason = '') {
  if (!userId) return;
  const userRef = doc(db, 'users', userId);
  try {
    await updateDoc(userRef, {
      scoreHistory: arrayUnion({
        date: serverTimestamp(),
        change,
        reason
      })
    });
  } catch (err) {
    console.error("Lỗi addScoreHistory:", err);
  }
}

// Bảng xếp hạng người dùng
async function loadUserLeaderboard() {
  const listEl = document.getElementById('user-leaderboard');
  listEl.innerHTML = `<li class="text-center text-gray-500 py-2">Đang tính điểm...</li>`;
  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    const leaderboard = [];
    snapshot.forEach(docSnap => {
      const data = docSnap.data();
      const score = calculateDailyScore(data);
      leaderboard.push({
        name: data.name || 'Người dùng ẩn danh',
        score,
        history: data.scoreHistory || []
      });
    });
    leaderboard.sort((a, b) => b.score - a.score);
    listEl.innerHTML = '';
    leaderboard.forEach((u, i) => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center py-2 px-2 hover:bg-gray-100 rounded cursor-pointer';
      li.innerHTML = `<span class="font-semibold">${i + 1}. ${u.name}</span>
                      <span class="text-blue-600 font-bold">${u.score} điểm</span>`;
      //li.addEventListener('click', () => showScoreHistory(u));
      listEl.appendChild(li);
    });
  } catch (err) {
    console.error("Lỗi BXH:", err);
  }
}

// Hiển thị lịch sử điểm
function showScoreHistory(user) {
  const history = user.history || [];
  const details = history.length
    ? history.map(h => {
        const date = formatHistoryDate(h?.date);
        const change = (typeof h?.change === 'number' ? (h.change > 0 ? '+' : '') + h.change : '0');
        const reason = h?.reason || 'Không rõ lý do';
        return `<li>${date}: ${change} (${reason})</li>`;
      }).join('')
    : '<li>Chưa có lịch sử điểm.</li>';

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white text-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 relative">
      <button onclick="this.parentElement.parentElement.remove()" 
              class="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-2xl font-bold">&times;</button>
      <h3 class="text-xl font-bold mb-3 text-center text-blue-700">📊 Lịch sử điểm của ${user.name}</h3>
      <ul class="list-disc pl-5 text-gray-700 space-y-1">${details}</ul>
    </div>
  `;
  document.body.appendChild(modal);
}

// =============================== CHATBOX GEMINI ===============================
const logoEl = document.getElementById('sunflower-btn');
const chatbox = document.getElementById('ai-chatbox');
const aiInput = document.getElementById('ai-input');
const aiSend = document.getElementById('ai-send');
const aiMessages = document.getElementById('ai-messages');
const aiClose = document.getElementById('close-ai-chat');

if (logoEl) logoEl.addEventListener('click', () => chatbox.classList.toggle('hidden'));
if (aiClose) aiClose.addEventListener('click', () => chatbox.classList.add('hidden'));

if (aiSend) {
  aiSend.addEventListener('click', async () => {
    const question = aiInput.value.trim();
    if (!question) return;
    appendMessage('user', question);
    aiInput.value = '';
    appendMessage('bot', 'Đang xử lý...');
    try {
      const response = await fetch(GEMINI_API_URL + GEMINI_API_KEY, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: question }] }] })
      });
      const data = await response.json();
      const answer = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Xin lỗi, tôi chưa có câu trả lời cho điều đó.";
      updateLastBotMessage(answer);
    } catch (err) {
      console.error(err);
      updateLastBotMessage("Lỗi khi gọi API Gemini.");
    }
  });
}

function appendMessage(sender, text) {
  const msg = document.createElement('div');
  msg.className = sender === 'user'
    ? 'bg-sky-100 text-gray-800 self-end p-2 rounded-lg max-w-[85%] ml-auto'
    : 'bg-gray-200 text-gray-900 p-2 rounded-lg max-w-[85%]';
  msg.textContent = text;
  aiMessages.appendChild(msg);
  aiMessages.scrollTop = aiMessages.scrollHeight;
}

function updateLastBotMessage(newText) {
  const last = aiMessages.querySelector('.bg-gray-200:last-child');
  if (last) last.textContent = newText;
}
// =============================== TÌM KIẾM VIDEO ===============================
const searchBtn = document.getElementById('search-btn');
const searchBox = document.getElementById('search-box');
const searchInput = document.getElementById('search-input');
const searchSubmit = document.getElementById('search-submit');

// Khi bấm vào nút tìm kiếm — ẩn/hiện khung
if (searchBtn && searchBox) {
  searchBtn.addEventListener('click', () => {
    searchBox.classList.toggle('hidden');
    if (!searchBox.classList.contains('hidden')) {
      searchInput.focus();
    }
  });
}

// Khi bấm nút TÌM
if (searchSubmit) {
  searchSubmit.addEventListener('click', () => {
    const keyword = searchInput.value.trim().toLowerCase();
    if (!keyword) return;

    const videos = document.querySelectorAll('.video-snap-item');
    let found = false;
    videos.forEach(video => {
      const title = video.querySelector('h4')?.textContent.toLowerCase() || '';
      const desc = video.querySelector('p')?.textContent.toLowerCase() || '';
      if (title.includes(keyword) || desc.includes(keyword)) {
        video.scrollIntoView({ behavior: 'smooth', block: 'center' });
        video.classList.add('ring', 'ring-4', 'ring-blue-400');
        setTimeout(() => video.classList.remove('ring', 'ring-4', 'ring-blue-400'), 2000);
        found = true;
      }
    });

    if (!found) alert('Không tìm thấy video nào phù hợp.');
  });
}
