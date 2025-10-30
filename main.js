// Import Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// Import các module tùy chỉnh
import { firebaseConfig, getDOMElements } from './config.js';
import { setupAuthListeners, getUserId } from './auth.js';
import { loadPosts, setupVideoListeners } from './video-feed.js';
import { setupAiListeners } from './ai-recommend.js';


let app, db, auth, storage;
const DOM = getDOMElements(); // Lấy tất cả các phần tử DOM

// Hàm lấy tham chiếu collection cho video công khai
const getPostsCollectionRef = () => collection(db, `artifacts/${firebaseConfig.projectId}/public/data/videos`);


try {
    // 1. Khởi tạo Firebase
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    storage = getStorage(app); 
    
    DOM.authStatusEl.textContent = "Đang tải...";

    // 2. Thiết lập Listener cho Auth
    setupAuthListeners(auth, DOM, (userId) => {
        // Callback này được gọi khi người dùng đăng nhập
        loadPosts(db, DOM, getPostsCollectionRef);
    });

    // 3. Thiết lập Listener cho Video/Post
    const videoDependencies = {
        db, 
        storage, 
        getPostsCollectionRef,
        getUserId: getUserId,
    };
    setupVideoListeners(DOM, videoDependencies);
    
    // 4. Thiết lập Listener cho AI
    setupAiListeners(DOM, getUserId);

} catch (error) {
    console.error("Lỗi khởi tạo ứng dụng:", error);
    DOM.authStatusEl.textContent = "Lỗi khởi tạo. Kiểm tra console.";
}
