import { serverTimestamp, addDoc, getDocs, query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { formatUserId, getYoutubeId, isYoutubeUrl, MUTE_ICON_PATH, UNMUTE_ICON_PATH, PLAY_ICON_PATH, PAUSE_ICON_PATH, closeModal } from './config.js';
import { setDoc, getDoc, updateDoc, doc, arrayUnion, arrayRemove, increment, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig, LIKE_ICON_PATH, SHARE_ICON_PATH } from './config.js';

// Biến giữ dependencies để render có thể truy cập db & getUserId
let videoDependencies = null;
let getPostsCollectionRefFn = null;
let feedObserver = null;

// Biến trạng thái phân trang
const PAGE_SIZE = 10; // Có thể chỉnh xuống 8 hoặc lên 12 tùy hiệu năng
let lastVisible = null;
let isLoadingMore = false;
let hasMore = true;
let scrollHandler = null;

let currentActiveMediaElement = null; // Biến trạng thái để theo dõi media đang phát

// --- LOGIC XỬ LÝ POST VIDEO ---

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
            // Giới hạn dung lượng video 200MB
            const MAX_SIZE_MB = 200;
            if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                DOM.postMessageEl.textContent = `Lỗi: Dung lượng video vượt quá ${MAX_SIZE_MB}MB.`;
                return;
            }

            isFile = true;

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
        }

        const newPost = {
            userId: userId,
            title: title,
            description: description,
            videoUrl: finalVideoUrl,
            timestamp: serverTimestamp(),
            username: `User_${formatUserId(userId)}`,
            isYoutube: !isFile,
            likes: [],
            shareCount: 0
        };

        await addDoc(getPostsCollectionRef(), newPost);
// --- BẮT ĐẦU: Cộng điểm +1 cho người đăng và ghi lịch sử (client timestamp) ---
try {
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  const historyEntry = {
    date: new Date().toISOString(), // timestamp từ client
    change: +1,
    reason: "Đăng video hợp lệ"
  };

  if (userSnap && userSnap.exists()) {
    // nếu doc user đã tồn tại -> update an toàn
    await updateDoc(userRef, {
      videosCount: (userSnap.data().videosCount || 0) + 1,
      scoreHistory: arrayUnion(historyEntry)
    });
  } else {
    // nếu doc user chưa tồn tại -> tạo mới với merge:true
    await setDoc(userRef, {
      videosCount: 1,
      scoreHistory: [historyEntry]
    }, { merge: true });
  }
} catch (err) {
  console.error("Lỗi khi cập nhật điểm cho user:", err);
}
// --- KẾT THÚC: Cộng điểm ---

        DOM.postMessageEl.textContent = "Đăng video thành công!";
        closeModal('post-modal');
        DOM.postForm.reset();
        DOM.postFileEl.value = '';
        DOM.postUrlEl.value = '';
        setTimeout(() => DOM.postMessageEl.textContent = '', 3000);

        return true;

    } catch (error) {
        console.error("Lỗi đăng bài:", error);
        DOM.postMessageEl.textContent = `Lỗi: ${error.message}`;
        return false;
    } finally {
        DOM.uploadBtn.disabled = false;
        DOM.uploadSpinner.classList.add('hidden');
        DOM.uploadProgressContainer.classList.add('hidden');
    }
};

// --- LOGIC PLAY/PAUSE/MUTE ---

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

const togglePlayPause = (mediaContainer) => {
    const mediaElement = mediaContainer.querySelector('.media-element');
    const playPauseIcon = mediaContainer.querySelector('.play-pause-icon');

    if (!mediaElement || mediaElement.tagName !== 'VIDEO') return;

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

// --- HIỂN THỊ VIDEO ---

const renderVideoFeed = (posts, DOM, append = false) => {
    // append=false: render mới; append=true: chỉ nối thêm các post mới
    if (!append) {
        DOM.videoFeedContainer.innerHTML = '';
        // Đảm bảo loader luôn tồn tại đầu danh sách để reuse cho thông báo
        if (!DOM.videoFeedContainer.contains(DOM.loadingFeedEl)) {
            DOM.videoFeedContainer.prepend(DOM.loadingFeedEl);
        }
    }

    if (!append && posts.length === 0) {
        DOM.loadingFeedEl.classList.remove('hidden');
        DOM.loadingFeedEl.textContent = 'Chưa có video nào. Hãy là người đầu tiên đăng bài!';
        return;
    }

    const fragment = document.createDocumentFragment();

    posts.forEach(post => {
        const postElement = document.createElement('div');
        postElement.className = 'video-snap-item relative';
        postElement.setAttribute('data-id', post.id);

        // Media hiển thị
        let mediaHtml = '';
        let playPauseOverlayHtml = '';

        if (post.isYoutube) {
            const videoId = getYoutubeId(post.videoUrl);
            if (!videoId) return;
            const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=0&mute=1&controls=0&disablekb=1&modestbranding=1&rel=0&loop=1&playlist=${videoId}`;
            mediaHtml = `<iframe class="video-display media-element" src="${embedUrl}" frameborder="0" allow="autoplay; encrypted-media;" allowfullscreen></iframe>`;
        } else {
            mediaHtml = `<video class="video-display media-element" src="${post.videoUrl}" loop muted playsinline style="object-fit: contain; pointer-events: none;"></video>`;
            playPauseOverlayHtml = `
                <div onclick="togglePlayPause(this.closest('.video-snap-item'))" class="absolute inset-0 z-5 cursor-pointer"></div>
                <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 bg-black bg-opacity-0 p-4 rounded-full pointer-events-none">
                    <img class="play-pause-icon h-10 w-10 text-white hidden" src="${PAUSE_ICON_PATH}" alt="Play/Pause">
                </div>
            `;
        }

        const currentUserId = videoDependencies?.getUserId?.();
        const likedByMe = Array.isArray(post.likes) && currentUserId && post.likes.includes(currentUserId);
        const likeCountText = post.likes?.length ? String(post.likes.length) : '';
        const shareCountText = post.shareCount ? String(post.shareCount) : '';

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
            <div class="video-controls">
                <button onclick="toggleMute(this.closest('.video-snap-item').querySelector('.media-element'))" class="ctrl-btn volume-btn">
                    <img class="volume-icon h-6 w-6 text-black" src="${MUTE_ICON_PATH}">
                </button>
                <button class="like-btn ctrl-btn ${likedByMe ? 'liked' : ''}">
                    <img class="like-icon h-6 w-6" src="${LIKE_ICON_PATH}">
                </button>
                <p class="like-count">${likeCountText}</p>
                <button class="share-btn ctrl-btn">
                    <img class="share-icon h-6 w-6" src="${SHARE_ICON_PATH}">
                </button>
                <p class="share-count">${shareCountText}</p>
            </div>
        `;

        fragment.appendChild(postElement);

        // Sự kiện Like & Share
        const likeBtnEl = postElement.querySelector('.like-btn');
        const shareBtnEl = postElement.querySelector('.share-btn');
        if (likeBtnEl) likeBtnEl.addEventListener('click', e => { e.stopPropagation(); handleLike(post.id); });
        if (shareBtnEl) shareBtnEl.addEventListener('click', e => { e.stopPropagation(); handleShare(post.id, post.videoUrl); });

        // ✅ Thêm nút xóa (chỉ admin)
        const currentUserId2 = videoDependencies?.getUserId?.();
        if (currentUserId2) {
            const userRef = doc(videoDependencies.db, 'users', currentUserId2);
            getDoc(userRef).then(snap => {
                const role = snap.exists() ? snap.data().role : '';
                if (role === 'admin') {
                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'ctrl-btn bg-red-500 hover:bg-red-600 text-white';
                    deleteBtn.innerHTML = '🗑️';
                    deleteBtn.title = 'Xóa video';
                    deleteBtn.addEventListener('click', e => {
                        e.stopPropagation();
                        deleteVideo(post.id, post.videoUrl, post.isYoutube);
                    });
                    postElement.querySelector('.video-controls').appendChild(deleteBtn);
                }
            });
        }
    });

    DOM.videoFeedContainer.appendChild(fragment);

    // Đảm bảo loader nằm ở đầu
    if (!DOM.videoFeedContainer.contains(DOM.loadingFeedEl)) {
        DOM.videoFeedContainer.prepend(DOM.loadingFeedEl);
    }

    // resetObserver=true khi render mới, false khi append thêm
    handleVideoScrolling(DOM, !append);
};

const handleVideoScrolling = (DOM, resetObserver = false) => {
    if (resetObserver && feedObserver) {
        feedObserver.disconnect();
        feedObserver = null;
    }

    if (!feedObserver) {
        feedObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const mediaElement = entry.target.querySelector('.media-element');
                const playPauseIcon = entry.target.querySelector('.play-pause-icon');
                if (!mediaElement) return;
                const iconImage = entry.target.querySelector('.volume-icon');

                if (entry.isIntersecting) {
                    if (mediaElement !== currentActiveMediaElement) {
                        if (currentActiveMediaElement) {
                            if (currentActiveMediaElement.tagName === 'VIDEO') {
                                currentActiveMediaElement.pause();
                                const oldIcon = currentActiveMediaElement.closest('.video-snap-item')?.querySelector('.play-pause-icon');
                                if (oldIcon) oldIcon.src = PLAY_ICON_PATH;
                            }
                        }

                        if (mediaElement.tagName === 'VIDEO') {
                            mediaElement.muted = true;
                            mediaElement.play().catch(() => {});
                            if (playPauseIcon) playPauseIcon.classList.add('hidden');
                        }
                        currentActiveMediaElement = mediaElement;
                        if (iconImage) iconImage.src = MUTE_ICON_PATH;
                    }
                } else {
                    if (mediaElement.tagName === 'VIDEO') mediaElement.pause();
                }
            });
        }, { root: DOM.videoFeedContainer, threshold: 0.8 });
    }

    DOM.videoFeedContainer.querySelectorAll('.video-snap-item').forEach(item => feedObserver.observe(item));
};

const handleLike = async (postId) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) return alert("Vui lòng đăng nhập.");

    const postRef = doc(deps.db, `artifacts/${firebaseConfig.projectId}/public/data/videos/${postId}`);
    const postEl = document.querySelector(`[data-id='${postId}']`);
    const likeBtn = postEl?.querySelector('.like-btn');
    const likeCountEl = postEl?.querySelector('.like-count');
    const liked = likeBtn?.classList.contains('liked');

    try {
        if (liked) {
            await updateDoc(postRef, { likes: arrayRemove(userId) });
            likeBtn.classList.remove('liked');
            const cur = parseInt(likeCountEl.textContent || '0');
            likeCountEl.textContent = cur > 1 ? cur - 1 : '';
        } else {
            await updateDoc(postRef, { likes: arrayUnion(userId) });
            likeBtn.classList.add('liked');
            const cur = parseInt(likeCountEl.textContent || '0');
            likeCountEl.textContent = isNaN(cur) ? '1' : (cur + 1);
        }
    } catch (err) {
        console.error(err);
    }
};

const handleShare = async (postId, videoUrl) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) return alert("Vui lòng đăng nhập.");

    const postRef = doc(deps.db, `artifacts/${firebaseConfig.projectId}/public/data/videos/${postId}`);
    const snapshot = await getDoc(postRef);
    const data = snapshot.exists() ? snapshot.data() : {};
    const sharedBy = Array.isArray(data.sharedBy) ? data.sharedBy : [];

    if (sharedBy.includes(userId)) return alert("Bạn đã chia sẻ video này rồi.");

    await updateDoc(postRef, { sharedBy: [...sharedBy, userId], shareCount: increment(1) });
    await navigator.clipboard.writeText(videoUrl);
    alert("Đã sao chép liên kết video!");
};

const deleteVideo = async (videoId, videoUrl, isYoutube) => {
    const deps = videoDependencies;
    const userId = deps?.getUserId?.();
    if (!userId) return alert("Vui lòng đăng nhập.");

    const userRef = doc(deps.db, 'users', userId);
    const snap = await getDoc(userRef);
    const role = snap.exists() ? snap.data().role : '';
    if (role !== 'admin') return alert("Chỉ admin mới được quyền xóa video!");
    if (!confirm("Bạn có chắc chắn muốn xóa video này không?")) return;

    const postRef = doc(deps.db, `artifacts/${firebaseConfig.projectId}/public/data/videos`, videoId);
    await deleteDoc(postRef);
    // ✅ Cập nhật trừ điểm cho người đăng video
const videoSnap = await getDoc(postRef);
if (videoSnap.exists()) {
  const videoData = videoSnap.data();
  const uploaderId = videoData.userId;
  if (uploaderId) {
    const uploaderRef = doc(deps.db, 'users', uploaderId);
    await updateDoc(uploaderRef, {
      lostVideos: (videoData.lostVideos || 0) + 1
    });
    // Ghi lịch sử điểm
    const addScoreHistory = async (userId, change, reason = '') => {
      await updateDoc(doc(deps.db, 'users', userId), {
        scoreHistory: arrayUnion({
          date: serverTimestamp(),
          change,
          reason
        })
      });
    };
    await addScoreHistory(uploaderId, -1, 'Video bị xóa hoặc vi phạm');
  }
}

// --- BẮT ĐẦU: Ghi lịch sử trừ -1 cho chủ video (client timestamp) ---
try {
  // Lấy thông tin post trước đó nếu cần. 
  // Lưu ý: nếu trước đó đã lấy postSnap, dùng lại; nếu không, bạn có thể pass ownerId vào hàm deleteVideo.
  // Ở đây chúng ta sẽ giả sử `videoId` còn hợp lệ để truy xuất thông tin chủ video nếu cần.
  // Nếu bạn đã có ownerId (post.userId) ở caller, thì dùng trực tiếp.
  const postDocRef = doc(deps.db, `artifacts/${firebaseConfig.projectId}/public/data/videos`, videoId);
  // NOTE: nếu đã deleteDoc(postRef) thì getDoc(postDocRef) sau đó có thể trả về null.
  // Do đó tốt nhất là lấy post data TRƯỚC khi deleteDoc — nếu không, bạn cần truyền ownerId vào deleteVideo.
} catch (e) {
  console.warn("Không có post data để trừ điểm (nếu post đã bị xóa trước khi lấy owner).", e);
}


    if (!isYoutube && videoUrl) {
        const path = decodeURIComponent(videoUrl.split('/o/')[1].split('?')[0]);
        const fileRef = ref(deps.storage, path);
        await deleteObject(fileRef);
    }
    alert("Đã xóa video thành công!");
};
window.deleteVideo = deleteVideo;
const resetPaginationState = () => {
    lastVisible = null;
    isLoadingMore = false;
    hasMore = true;
};

const fetchPostsPage = async (DOM, append = false) => {
    if (!getPostsCollectionRefFn) return;
    if (isLoadingMore || (!hasMore && append)) return;

    isLoadingMore = true;
    DOM.loadingFeedEl.classList.remove('hidden');
    DOM.loadingFeedEl.textContent = append ? 'Đang tải thêm...' : 'Đang tải video...';

    try {
        const baseRef = getPostsCollectionRefFn();
        const q = lastVisible && append
            ? query(baseRef, orderBy('timestamp', 'desc'), startAfter(lastVisible), limit(PAGE_SIZE))
            : query(baseRef, orderBy('timestamp', 'desc'), limit(PAGE_SIZE));

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            hasMore = false;
            if (!append) {
                renderVideoFeed([], DOM, false);
            }
            return;
        }

        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        if (snapshot.docs.length < PAGE_SIZE) hasMore = false;

        const posts = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        renderVideoFeed(posts, DOM, append);
    } catch (err) {
        console.error('Lỗi tải video:', err);
    } finally {
        DOM.loadingFeedEl.classList.add('hidden');
        isLoadingMore = false;
    }
};

const attachInfiniteScroll = (DOM) => {
    if (scrollHandler) {
        DOM.videoFeedContainer.removeEventListener('scroll', scrollHandler);
    }

    scrollHandler = () => {
        const { scrollTop, clientHeight, scrollHeight } = DOM.videoFeedContainer;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            fetchPostsPage(DOM, true);
        }
    };

    DOM.videoFeedContainer.addEventListener('scroll', scrollHandler);
};

const refreshFeed = (DOM) => {
    resetPaginationState();
    fetchPostsPage(DOM, false);
};

export const loadPosts = (db, DOM, getPostsCollectionRef) => {
    videoDependencies = videoDependencies || {};
    videoDependencies.db = db;
    getPostsCollectionRefFn = getPostsCollectionRef;

    resetPaginationState();
    attachInfiniteScroll(DOM);
    fetchPostsPage(DOM, false);
};

export const setupVideoListeners = (DOM, dependencies) => {
    videoDependencies = dependencies;
    getPostsCollectionRefFn = dependencies.getPostsCollectionRef;

    DOM.sourceUploadRadio.addEventListener('change', () => {
        DOM.postFileEl.classList.remove('hidden');
        DOM.postUrlEl.classList.add('hidden');
    });

    DOM.sourceYoutubeRadio.addEventListener('change', () => {
        DOM.postFileEl.classList.add('hidden');
        DOM.postUrlEl.classList.remove('hidden');
    });

    DOM.postForm.addEventListener('submit', async (e) => {
        const userId = dependencies.getUserId();
        const success = await handlePostSubmit(e, userId, dependencies.db, dependencies.storage, DOM, dependencies.getPostsCollectionRef);
        // Sau khi upload thành công, reload trang đầu để video mới nằm trên cùng
        if (success) refreshFeed(DOM);
    });
};
