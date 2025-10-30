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
      window.location.href = 'game.html';
    });
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