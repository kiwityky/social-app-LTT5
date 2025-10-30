// main.js — phiên bản hoàn chỉnh mới nhất (Firebase v11 chuẩn)
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
  setDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
  getStorage, 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

import { firebaseConfig, getDOMElements } from './config.js';
import { setupAuthListeners, getUserId } from './auth.js';
import { loadPosts, setupVideoListeners } from './video-feed.js';

const DOM = getDOMElements();

let app, db, auth, storage;

try {
  // ===== KHỞI TẠO FIREBASE =====
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);

  DOM.authStatusEl.textContent = "Đang tải...";

  // ===== KHAI BÁO COLLECTION VIDEO =====
  const getPostsCollectionRef = () => collection(db, `artifacts/${firebaseConfig.projectId}/public/data/videos`);

  // ===== THIẾT LẬP LISTENER CHÍNH =====
  setupAuthListeners(auth, DOM, (userId) => loadPosts(db, DOM, getPostsCollectionRef));
  setupVideoListeners(DOM, { db, storage, getPostsCollectionRef, getUserId });

  // ===== NÚT BẬT GESTURE CONTROL (NẾU CÓ) =====
  const gestureBtn = document.getElementById('toggle-gesture-btn');
  if (gestureBtn) {
    let gestureEnabled = false;
    gestureBtn.addEventListener('click', async () => {
      if (!gestureEnabled) {
        gestureBtn.textContent = "🖐️ Đang bật điều khiển cử chỉ...";
        gestureBtn.disabled = true;
        if (typeof initGestureControl !== 'undefined') {
          try { await initGestureControl(DOM.videoFeedContainer); }
          catch(e) { console.warn("initGestureControl lỗi:", e); }
        }
        gestureBtn.textContent = "🖐️ Tắt điều khiển cử chỉ";
        gestureBtn.disabled = false;
        gestureEnabled = true;
      } else {
        location.reload();
      }
    });
  }

  // =============================
  // ===== PROFILE NGƯỜI DÙNG ====
  // =============================
  const profileBtn = document.getElementById('open-profile-btn');
  const profileModal = document.getElementById('profile-modal');
  const profileForm = document.getElementById('profile-form');
  const avatarUpload = document.getElementById('avatar-upload');
  const avatarImg = document.getElementById('profile-avatar');

  // ===== THÔNG BÁO GIỮA MÀN HÌNH =====
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

  // ===== MỞ MODAL HỒ SƠ =====
  if (profileBtn) {
    profileBtn.addEventListener('click', async () => {
      const user = auth.currentUser;
      if (!user) {
        alert("Vui lòng đăng nhập trước.");
        return;
      }

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
          if (nameEl) nameEl.textContent = data.name || user.email || "";
          if (emailEl) emailEl.textContent = data.email || user.email || "";
          if (nameInput) nameInput.value = data.name || "";
          if (emailInput) emailInput.value = data.email || user.email || "";
          if (document.getElementById('profile-dob')) document.getElementById('profile-dob').value = data.dob || '';
          if (document.getElementById('profile-gender')) document.getElementById('profile-gender').value = data.gender || '';
          if (document.getElementById('profile-school')) document.getElementById('profile-school').value = data.school || '';
          if (document.getElementById('profile-class')) document.getElementById('profile-class').value = data.class || '';
          if (avatarImg) avatarImg.src = data.photoUrl || "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
        } else {
          if (nameEl) nameEl.textContent = user.email || "Chưa có thông tin";
          if (emailEl) emailEl.textContent = user.email || "";
          if (avatarImg) avatarImg.src = "https://cdn-icons-png.flaticon.com/512/3135/3135715.png";
        }
      } catch (err) {
        console.error("Lỗi tải profile:", err);
        showProfileMessage("Không thể tải hồ sơ.", false);
      }
    });
  }

  // ===== LƯU HỒ SƠ =====
  if (profileForm) {
    profileForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);

      const data = {};
      const dobEl = document.getElementById('profile-dob');
      if (dobEl?.value.trim()) data.dob = dobEl.value.trim();

      const genderEl = document.getElementById('profile-gender');
      if (genderEl?.value) data.gender = genderEl.value;

      const schoolEl = document.getElementById('profile-school');
      if (schoolEl?.value.trim()) data.school = schoolEl.value.trim();

      const classEl = document.getElementById('profile-class');
      if (classEl?.value.trim()) data.class = classEl.value.trim();

      const nameInput = document.getElementById('profile-name-input');
      if (nameInput?.value.trim()) data.name = nameInput.value.trim();

      const emailInput = document.getElementById('profile-email-input');
      if (emailInput?.value.trim()) data.email = emailInput.value.trim(); // chỉ lưu hiển thị

      try {
        await setDoc(doc(db, 'users', user.uid), data, { merge: true });
        showProfileMessage("Đã lưu thông tin thành công!");
        // Cập nhật UI ngay
        const nameDisplay = document.getElementById('profile-name');
        const emailDisplay = document.getElementById('profile-email');
        if (nameDisplay && data.name) nameDisplay.textContent = data.name;
        if (emailDisplay && data.email) emailDisplay.textContent = data.email;
      } catch (err) {
        console.error("Lỗi lưu profile:", err);
        showProfileMessage("Không thể lưu. Thử lại.", false);
      }
    });
  }

  // ===== ĐỔI MẬT KHẨU =====
  const changePassBtn = document.getElementById('change-password-btn');
  if (changePassBtn) {
    changePassBtn.addEventListener('click', async () => {
      const newPassEl = document.getElementById('profile-new-password');
      const newPass = newPassEl?.value.trim();
      const user = auth.currentUser;
      if (!user) return showProfileMessage("Vui lòng đăng nhập.", false);
      if (!newPass || newPass.length < 6) return showProfileMessage("Mật khẩu phải từ 6 ký tự.", false);

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
        showProfileMessage("Không thể đổi mật khẩu. Vui lòng nhập đúng mật khẩu hiện tại.", false);
      }
    });
  }

  // ===== UPLOAD AVATAR =====
  if (avatarUpload && avatarImg) {
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
        showProfileMessage("Không thể tải ảnh. Thử lại.", false);
      }
    });
  }

} catch (error) {
  console.error("Lỗi khởi tạo ứng dụng:", error);
  try { if (DOM && DOM.authStatusEl) DOM.authStatusEl.textContent = "Lỗi khởi tạo. Kiểm tra console."; } catch(e){}
}
  // ===== NÚT GAME =====
  const gameBtn = document.getElementById('open-game-btn');
  if (gameBtn) {
    gameBtn.addEventListener('click', () => {
      //window.location.href = 'game.html';
    });
  }
// ===============================
// MỞ MODAL TRUNG TÂM TRÒ CHƠI
// ===============================
if (gameBtn) {
  gameBtn.addEventListener('click', async () => {
    const modal = document.getElementById('game-center-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    await loadUserLeaderboard();
  });
}

// ===============================
// TÍNH VÀ TẢI BẢNG XẾP HẠNG
// ===============================
async function loadUserLeaderboard() {
  const listEl = document.getElementById('user-leaderboard');
  listEl.innerHTML = `<li class="text-center text-gray-500 py-2">Đang tính điểm...</li>`;

  try {
    const usersRef = collection(db, 'users');
    const snapshot = await getDocs(usersRef);
    let leaderboard = [];

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
      li.innerHTML = `
        <span class="font-semibold">${i + 1}. ${u.name}</span>
        <span class="text-blue-600 font-bold">${u.score} điểm</span>
      `;
      li.addEventListener('click', () => showScoreHistory(u));
      listEl.appendChild(li);
    });

    if (leaderboard.length === 0) {
      listEl.innerHTML = `<li class="text-center text-gray-500 py-2">Chưa có dữ liệu người dùng.</li>`;
    }
  } catch (err) {
    console.error("Lỗi tải BXH:", err);
    listEl.innerHTML = `<li class="text-center text-red-500 py-2">Lỗi khi tải dữ liệu.</li>`;
  }
}

// ===============================
// HÀM TÍNH ĐIỂM TỔNG
// ===============================
function calculateDailyScore(data) {
  const usageMinutes = data.usageMinutesToday || 0;
  const videosCount = data.videosCount || 0;
  const lostVideos = data.lostVideos || 0;
  let score = data.baseScore || 0;

  // Quy tắc: dưới 45' +1, trên 45' -1
  if (usageMinutes <= 45) score += 1; else score -= 1;

  // Mỗi video hợp lệ +1, mất video trừ tương ứng
  score += videosCount;
  score -= lostVideos;

  // Lưu lại vào lịch sử (có thể lưu Firestore riêng)
  return score;
}

// ===============================
// HIỂN THỊ LỊCH SỬ ĐIỂM
// ===============================
function showScoreHistory(user) {
  const history = user.history || [];
  const details = history.length
    ? history.map(h => `<li>${h.date}: ${h.change > 0 ? '+' : ''}${h.change} (${h.reason})</li>`).join('')
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

  // ===== NÚT TÌM KIẾM =====
  const searchBtn = document.getElementById('search-btn');
  const searchBox = document.getElementById('search-box');
  const searchInput = document.getElementById('search-input');
  const searchSubmit = document.getElementById('search-submit');

  if (searchBtn && searchBox) {
    searchBtn.addEventListener('click', () => {
      searchBox.classList.toggle('hidden');
      searchInput.focus();
    });
  }

  if (searchSubmit) {
    searchSubmit.addEventListener('click', () => {
      const keyword = searchInput.value.trim().toLowerCase();
      if (!keyword) return alert("Nhập từ khóa để tìm kiếm video.");
      const posts = Array.from(document.querySelectorAll('.video-snap-item'));
      posts.forEach(p => {
        const title = p.querySelector('h4')?.textContent.toLowerCase() || "";
        const desc = p.querySelector('p')?.textContent.toLowerCase() || "";
        p.style.display = (title.includes(keyword) || desc.includes(keyword)) ? '' : 'none';
      });
    });
  }
  import { GEMINI_API_KEY, GEMINI_API_URL } from './config.js';

// ===== CHATBOX AI GEMINI =====
const logoEl = document.getElementById('sunflower-btn');
const chatbox = document.getElementById('ai-chatbox');
const aiInput = document.getElementById('ai-input');
const aiSend = document.getElementById('ai-send');
const aiMessages = document.getElementById('ai-messages');
const aiClose = document.getElementById('close-ai-chat');

// Mở chatbox khi nhấp logo hoa hướng dương
if (logoEl) {
  logoEl.addEventListener('click', () => {
    chatbox.classList.toggle('hidden');
  });
}

// Đóng chatbox
if (aiClose) aiClose.addEventListener('click', () => chatbox.classList.add('hidden'));

// Gửi câu hỏi
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
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: question }] }]
        })
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
