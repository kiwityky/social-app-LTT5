import { serverTimestamp, addDoc, onSnapshot, query } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { formatUserId, getYoutubeId, isYoutubeUrl, MUTE_ICON_PATH, UNMUTE_ICON_PATH, PLAY_ICON_PATH, PAUSE_ICON_PATH, closeModal } from './config.js';
import {getDoc, updateDoc, doc, arrayUnion, arrayRemove, increment } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig,LIKE_ICON_PATH, SHARE_ICON_PATH } from './config.js';

// Biến giữ dependencies để render có thể truy cập db & getUserId
let videoDependencies = null;

let currentActiveMediaElement = null; // Biến trạng thái để theo dõi media đang phát

// --- LOGIC XỬ LÝ POST VIDEO ---

/**
 * Xử lý đăng video mới (file upload hoặc YouTube URL)
 */
const handlePostSubmit = async (e, userId, db, storage, DOM, getPostsCollectionRef) => {
    e.preventDefault();
    if (!userId) {
        DOM.postMessageEl.textContent = "Lỗi: Vui lòng đăng nhập.";
        return;
    }

    const title = DOM.postTitleEl.value.trim();
    const description = DOM.postDescriptionEl.value.trim();
    const selectedSource = document.querySelector('input[name="video_source"]:checked').value;
    let finalVideoUrl = null;
    let isFile = false;

    try {
        if (selectedSource === 'upload') {
            const file = DOM.postFileEl.files[0];
            if (!file || !file.type.startsWith('video/')) {
                DOM.postMessageEl.textContent = "Lỗi: Vui lòng chọn một file video hợp lệ.";
                return;
            }
            isFile = true;
            
            // Logic Tải file lên Firebase Storage
            DOM.uploadBtn.disabled = true;
            DOM.uploadSpinner.classList.remove('hidden');
            DOM.uploadProgressContainer.classList.remove('hidden');
            DOM.postMessageEl.textContent = "Đang tải lên...";
            DOM.uploadProgressEl.style.width = '0%';

            const storageRef = ref(storage, `videos/${userId}/${Date.now()}_${file.name}`);
            const uploadTask = uploadBytesResumable(storageRef, file);

            finalVideoUrl = await new Promise((resolve, reject) => {
                uploadTask.on('state_changed', 
                    (snapshot) => {
                        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                        DOM.uploadProgressEl.style.width = progress + '%';
                        DOM.postMessageEl.textContent = `Đang tải lên: ${Math.round(progress)}%`;
                    }, 
                    (error) => reject(new Error(`Tải lên thất bại: ${error.message}`)),
                    async () => resolve(await getDownloadURL(uploadTask.snapshot.ref))
                );
            });

        } else if (selectedSource === 'youtube') {
            const url = DOM.postUrlEl.value.trim();
            if (!isYoutubeUrl(url)) {
                DOM.postMessageEl.textContent = "Lỗi: URL phải là một video YouTube hợp lệ.";
                return;
            }
            finalVideoUrl = url;
            isFile = false;
        }
        
        // GHI THÔNG TIN VÀO FIRESTORE
        const newPost = {
            userId: userId,
            title: title,
            description: description,
            videoUrl: finalVideoUrl,
            timestamp: serverTimestamp(),
            username: `User_${formatUserId(userId)}`,
            isYoutube: !isFile,
            // MỚI: khởi tạo cho Like & Share
            likes: [],
            shareCount: 0
        };

        // Lỗi đã được sửa: Đã import addDoc
        await addDoc(getPostsCollectionRef(), newPost); 

        DOM.postMessageEl.textContent = "Đăng video thành công!";
        closeModal('post-modal');
        DOM.postForm.reset();
        DOM.postFileEl.value = ''; 
        DOM.postUrlEl.value = ''; 
        setTimeout(() => DOM.postMessageEl.textContent = '', 3000);

    } catch (error) {
        console.error("Lỗi đăng bài:", error);
        DOM.postMessageEl.textContent = `Lỗi: ${error.message}`;
    } finally {
        DOM.uploadBtn.disabled = false;
        DOM.uploadSpinner.classList.add('hidden');
        DOM.uploadProgressContainer.classList.add('hidden');
    }
};

// --- LOGIC PLAY/PAUSE/MUTE ---

/**
 * Xử lý bật/tắt âm thanh (Đã export ra global scope trong config.js)
 */
const toggleMute = (element) => {
    let isMuted = false;
    const iconImage = element.closest('.video-snap-item').querySelector('.volume-icon');

    if (element.tagName === 'VIDEO') {
        element.muted = !element.muted;
        isMuted = element.muted;
    } else if (element.tagName === 'IFRAME') {
        const currentSrc = element.src;
        if (currentSrc.includes('mute=1')) {
            element.src = currentSrc.replace('mute=1', 'mute=0');
            isMuted = false;
        } else if (currentSrc.includes('mute=0')) {
             element.src = currentSrc.replace('mute=0', 'mute=1');
             isMuted = true;
        } else {
             const separator = currentSrc.includes('?') ? '&' : '?';
             element.src = currentSrc + `${separator}mute=0`;
             isMuted = false;
        }
    }
    
    if (iconImage) {
        iconImage.src = isMuted ? MUTE_ICON_PATH : UNMUTE_ICON_PATH;
        iconImage.classList.remove('text-white');
        iconImage.classList.add('text-black');
    }
};
window.toggleMute = toggleMute;


/**
 * Xử lý sự kiện nhấp vào video để Play/Pause
 */
const togglePlayPause = (mediaContainer) => {
    const mediaElement = mediaContainer.querySelector('.media-element');
    const playPauseIcon = mediaContainer.querySelector('.play-pause-icon');
    
    if (!mediaElement || mediaElement.tagName !== 'VIDEO') {
        return; 
    }

    if (mediaElement.paused) {
        mediaElement.play().catch(e => console.log("Play failed:", e));
        playPauseIcon.classList.add('hidden');
    } else {
        mediaElement.pause();
        playPauseIcon.src = PLAY_ICON_PATH; 
        playPauseIcon.classList.remove('hidden'); 
    }
    
    currentActiveMediaElement = mediaElement;
};
window.togglePlayPause = togglePlayPause;


// --- LOGIC HIỂN THỊ VÀ CUỘN VIDEO ---

const renderVideoFeed = (posts, DOM) => {
    DOM.videoFeedContainer.innerHTML = '';
    if (posts.length === 0) {
        DOM.videoFeedContainer.appendChild(DOM.loadingFeedEl);
        DOM.loadingFeedEl.classList.remove('hidden');
        DOM.loadingFeedEl.textContent = 'Chưa có video nào. Hãy là người đầu tiên đăng bài!';
        return;
    }

    posts.forEach(post => {
        const postElement = document.createElement('div');
        postElement.className = 'video-snap-item relative';
        postElement.setAttribute('data-id', post.id);

        // === Media hiển thị ===
        let mediaHtml = '';
        let playPauseOverlayHtml = '';

        if (post.isYoutube) {
            const videoId = getYoutubeId(post.videoUrl);
            if (!videoId) return;
            const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${videoId}`;
            mediaHtml = `
                <iframe class="video-display media-element"
                        src="${embedUrl}"
                        frameborder="0"
                        allow="autoplay; encrypted-media; gyroscope; picture-in-picture"
                        allowfullscreen>
                </iframe>
            `;
        } else {
            mediaHtml = `
                <video class="video-display media-element"
                       src="${post.videoUrl}"
                       loop
                       muted
                       playsinline
                       style="object-fit: contain; pointer-events: none;">
                    Trình duyệt của bạn không hỗ trợ thẻ video.
                </video>
            `;
            playPauseOverlayHtml = `
                <div onclick="togglePlayPause(this.closest('.video-snap-item'))"
                     class="absolute inset-0 z-5 cursor-pointer"></div>
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-black bg-opacity-0 p-4 rounded-full pointer-events-none">
                    <img class="play-pause-icon h-10 w-10 text-white hidden" src="${PAUSE_ICON_PATH}" alt="Play/Pause">
                </div>
            `;
        }

        // === Chuẩn bị dữ liệu like/share ===
        const currentUserId = videoDependencies?.getUserId?.();
        const likedByMe = Array.isArray(post.likes) && currentUserId && post.likes.includes(currentUserId);
        const likeCountText = post.likes?.length ? String(post.likes.length) : '';
        const shareCountText = post.shareCount ? String(post.shareCount) : '';

        // === Nội dung hiển thị bài ===
        postElement.innerHTML = `
            ${mediaHtml}
            ${playPauseOverlayHtml}

            <div class="absolute bottom-16 left-0 right-0 p-4 text-white z-10">
                <div class="bg-black bg-opacity-0 p-3 rounded-lg">
                    <h4 class="font-bold text-lg">${post.title}</h4>
                    <p class="text-sm mt-1">${post.description}</p>
                    <p class="text-xs text-gray-300 mt-2">@${post.username || formatUserId(post.userId)} - Nguồn: ${post.isYoutube ? 'YouTube' : 'Upload'}</p>
                </div>
            </div>

            <!-- CỤM ĐIỀU KHIỂN CHUNG -->
            <div class="video-controls">
                <button onclick="toggleMute(this.closest('.video-snap-item').querySelector('.media-element'))"
                        class="ctrl-btn volume-btn">
                    <img class="volume-icon h-6 w-6 text-black" src="${MUTE_ICON_PATH}" alt="Volume">
                </button>

                <button class="like-btn ctrl-btn ${likedByMe ? 'liked' : ''}" title="Thích">
    <img class="like-icon h-6 w-6" src="${LIKE_ICON_PATH}" alt="Like">
</button>
<p class="like-count">${likeCountText}</p>

<button class="share-btn ctrl-btn" title="Chia sẻ">
    <img class="share-icon h-6 w-6" src="${SHARE_ICON_PATH}" alt="Share">
</button>
<p class="share-count">${shareCountText}</p>

            </div>
        `;

        // === Gắn vào container ===
        DOM.videoFeedContainer.appendChild(postElement);

        // === Gắn sự kiện ===
        const likeBtnEl = postElement.querySelector('.like-btn');
        const shareBtnEl = postElement.querySelector('.share-btn');
        if (likeBtnEl) likeBtnEl.addEventListener('click', e => { e.stopPropagation(); handleLike(post.id); });
        if (shareBtnEl) shareBtnEl.addEventListener('click', e => { e.stopPropagation(); handleShare(post.id, post.videoUrl); });
    });

    DOM.videoFeedContainer.prepend(DOM.loadingFeedEl);
    handleVideoScrolling(DOM);
};



const handleVideoScrolling = (DOM) => {
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const mediaElement = entry.target.querySelector('.media-element');
            const playPauseIcon = entry.target.querySelector('.play-pause-icon');
            if (!mediaElement) return;
            const iconImage = entry.target.querySelector('.volume-icon');

            if (entry.isIntersecting) {
                if (mediaElement !== currentActiveMediaElement) {
                    if (currentActiveMediaElement) {
                        // Tạm dừng/reset media cũ
                        if (currentActiveMediaElement.tagName === 'VIDEO') {
                            currentActiveMediaElement.pause();
                            const oldPlayPauseIcon = currentActiveMediaElement.closest('.video-snap-item')?.querySelector('.play-pause-icon');
                            if (oldPlayPauseIcon) {
                                oldPlayPauseIcon.src = PLAY_ICON_PATH;
                                oldPlayPauseIcon.classList.remove('hidden');
                            }
                        } else if (currentActiveMediaElement.tagName === 'IFRAME') {
                             const oldId = getYoutubeId(currentActiveMediaElement.src);
                             if(oldId) currentActiveMediaElement.src = `https://www.youtube.com/embed/${oldId}?autoplay=0&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${oldId}`;
                        }
                        
                        // Phát media mới (luôn ở trạng thái MUTE)
                        if (mediaElement.tagName === 'VIDEO') {
                            mediaElement.muted = true; 
                            mediaElement.play().catch(e => {
                                console.log("Video play failed:", e);
                                if(playPauseIcon) playPauseIcon.classList.remove('hidden'); 
                            });
                            if (playPauseIcon) playPauseIcon.classList.add('hidden');

                        } else if (mediaElement.tagName === 'IFRAME') {
                            const videoId = getYoutubeId(mediaElement.src);
                            if(videoId) mediaElement.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${videoId}`;
                        }
                        
                        currentActiveMediaElement = mediaElement;
                        if(iconImage) iconImage.src = MUTE_ICON_PATH;
                    }
                }
            } else {
                if (mediaElement.tagName === 'VIDEO') {
                    mediaElement.pause();
                }
            }
        });
    }, {
        root: DOM.videoFeedContainer,
        threshold: 0.8 
    });
    
    const videoItems = DOM.videoFeedContainer.querySelectorAll('.video-snap-item');
    videoItems.forEach(item => observer.observe(item));

    // Xử lý phát video đầu tiên ngay lập tức
    if(videoItems.length > 0) {
         const firstMedia = videoItems[0].querySelector('.media-element');
         const firstIcon = videoItems[0].querySelector('.volume-icon');
         const firstPlayPauseIcon = videoItems[0].querySelector('.play-pause-icon');

         if(firstMedia) {
             if(firstMedia.tagName === 'VIDEO') {
                firstMedia.play().catch(e => console.log("First video play failed:", e));
             } else if (firstMedia.tagName === 'IFRAME') {
                 const videoId = getYoutubeId(firstMedia.src);
                 if(videoId) firstMedia.src = `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${videoId}`;
             }
             currentActiveMediaElement = firstMedia;
             if(firstIcon) firstIcon.src = MUTE_ICON_PATH;
             if(firstPlayPauseIcon) firstPlayPauseIcon.classList.add('hidden');
         }
    }
};
/**
 * Xử lý Like: cập nhật Firestore (thêm/xóa UID trong mảng likes).
 * Cập nhật UI tối ưu hoá ngay lập tức (optimistic).
 */
const handleLike = async (postId) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) {
        return alert("Vui lòng đăng nhập để thích video.");
    }
    if (!deps || !deps.db) {
        console.error("DB không khả dụng.");
        return;
    }

    // Tham chiếu tới document bài đăng
    const postRef = doc(deps.db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'videos', postId);

    // UI element tham chiếu
    const postEl = document.querySelector(`[data-id='${postId}']`);
    if (!postEl) {
        // fallback: chỉ update Firestore
        try {
            await updateDoc(postRef, { likes: arrayUnion(userId) });
        } catch (e) { console.error(e); }
        return;
    }

    const likeBtn = postEl.querySelector('.like-btn');
    const likeCountEl = postEl.querySelector('.like-count');
    const currentlyLiked = likeBtn.classList.contains('liked'); // class 'liked' ta dùng để biết trạng thái

    try {
        if (currentlyLiked) {
            // undo like
            await updateDoc(postRef, { likes: arrayRemove(userId) });
            likeBtn.classList.remove('liked');
            // cập nhật số (nếu có)
            const cur = parseInt(likeCountEl.textContent || '0');
            likeCountEl.textContent = cur > 1 ? (cur - 1) : '';
        } else {
            // add like
            await updateDoc(postRef, { likes: arrayUnion(userId) });
            likeBtn.classList.add('liked');
            const cur = parseInt(likeCountEl.textContent || '0');
            likeCountEl.textContent = (isNaN(cur) ? 1 : cur + 1);
        }
    } catch (error) {
        console.error("Lỗi khi cập nhật like:", error);
        alert("Không thể cập nhật like. Vui lòng thử lại.");
    }
};

/**
 * Xử lý Share: mỗi người chỉ được chia sẻ 1 lần / video.
 */
const handleShare = async (postId, videoUrl) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) {
        return alert("Vui lòng đăng nhập để chia sẻ video.");
    }
    if (!deps || !deps.db) {
        console.error("DB không khả dụng.");
        return;
    }

    const postRef = doc(deps.db, 'artifacts', firebaseConfig.projectId, 'public', 'data', 'videos', postId);
    const postEl = document.querySelector(`[data-id='${postId}']`);
    const shareCountEl = postEl?.querySelector('.share-count');

    try {
        // Lấy dữ liệu hiện tại (an toàn)
        const snapshot = await getDoc(postRef);
        const postData = snapshot.exists() ? snapshot.data() : {};
        const sharedBy = Array.isArray(postData.sharedBy) ? postData.sharedBy : [];

        // Nếu user đã chia sẻ
        if (sharedBy.includes(userId)) {
            alert("Bạn đã chia sẻ video này rồi.");
            return;
        }

        // Nếu chưa có trường sharedBy, khởi tạo mảng mới
        const newSharedBy = [...sharedBy, userId];

        // Cập nhật Firestore: lưu cả mảng sharedBy mới + tăng shareCount
        await updateDoc(postRef, {
            sharedBy: newSharedBy,
            shareCount: increment(1)
        });

        // Cập nhật UI
        const cur = parseInt(shareCountEl?.textContent || '0');
        if (shareCountEl) shareCountEl.textContent = isNaN(cur) ? '1' : (cur + 1).toString();

        // Copy link video
        const textToCopy = videoUrl || window.location.href;
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(textToCopy);
            alert("Đã sao chép liên kết video vào clipboard.");
        } else {
            prompt("Sao chép liên kết video:", textToCopy);
        }

    } catch (error) {
        console.error("Lỗi khi chia sẻ:", error);
        alert("Không thể chia sẻ. Vui lòng thử lại.");
    }
};




/**
 * Tải danh sách bài đăng từ Firestore và hiển thị.
 * @param {object} db - Firestore instance
 * @param {object} DOM - Các phần tử DOM
 * @param {function} getPostsCollectionRef - Hàm lấy tham chiếu collection
 */
export const loadPosts = (db, DOM, getPostsCollectionRef) => {
    const postsQuery = query(getPostsCollectionRef());
    DOM.loadingFeedEl.classList.remove('hidden');
    DOM.loadingFeedEl.textContent = 'Đang tải video...';

    onSnapshot(postsQuery, (snapshot) => {
        let currentPosts = [];
        snapshot.forEach(doc => {
            currentPosts.push({ id: doc.id, ...doc.data() });
        });
        currentPosts.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));

        // KIỂM TRA QUAN TRỌNG: Kiểm tra xem đã có video nào trong Firestore chưa
        if (currentPosts.length > 0) {
            console.log(`Đã tìm thấy ${currentPosts.length} video.`);
        } else {
             console.log("Không tìm thấy video nào trong Firestore. Hãy đăng thử một video YouTube.");
        }
        
        renderVideoFeed(currentPosts, DOM);
        DOM.loadingFeedEl.classList.add('hidden');
    }, (error) => {
        DOM.loadingFeedEl.textContent = "Lỗi khi tải nội dung.";
        console.error("Lỗi Firestore:", error);
    });
};

/**
 * Thiết lập các listener liên quan đến video và form đăng bài.
 * @param {object} DOM - Các phần tử DOM
 * @param {object} dependencies - Các dependencies cần thiết (db, storage, collectionRef)
 */
export const setupVideoListeners = (DOM, dependencies) => {
    // Lưu dependencies để renderVideoFeed và handler khác sử dụng
    videoDependencies = dependencies;
    // Xử lý chuyển đổi input File/URL
    DOM.sourceUploadRadio.addEventListener('change', () => {
        DOM.postFileEl.classList.remove('hidden');
        DOM.postUrlEl.classList.add('hidden');
        DOM.postFileEl.setAttribute('required', 'required');
        DOM.postUrlEl.removeAttribute('required');
    });

    DOM.sourceYoutubeRadio.addEventListener('change', () => {
        DOM.postFileEl.classList.add('hidden');
        DOM.postUrlEl.classList.remove('hidden');
        DOM.postUrlEl.setAttribute('required', 'required');
        DOM.postFileEl.removeAttribute('required');
    });
    
    // Gắn sự kiện cho form đăng bài
    DOM.postForm.addEventListener('submit', (e) => {
        const userId = dependencies.getUserId();
        handlePostSubmit(e, userId, dependencies.db, dependencies.storage, DOM, dependencies.getPostsCollectionRef);
    });
    
    // Logic mở modal Đăng bài
    DOM.openPostModalBtn.addEventListener('click', () => {
         const userId = dependencies.getUserId();
         if (userId) {
            document.getElementById('post-modal').classList.add('flex');
            document.getElementById('post-modal').classList.remove('hidden');
            DOM.postMessageEl.textContent = ''; 
        } else {
            DOM.authMessageEl.textContent = "Vui lòng đăng nhập để đăng video.";
        }
    });
};
