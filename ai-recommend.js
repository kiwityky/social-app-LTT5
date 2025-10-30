import { GEMINI_API_URL, GEMINI_API_KEY, userExpertise, closeModal } from './config.js';

/**
 * Gọi API Gemini để lấy gợi ý nội dung video cá nhân hóa.
 * @param {object} DOM - Các phần tử DOM cần thiết
 * @param {function} getUserId - Hàm lấy ID người dùng
 */
const getAiRecommendations = async (DOM, getUserId) => {
    const userId = getUserId();
    if (!userId) {
        DOM.authMessageEl.textContent = "Vui lòng đăng nhập để sử dụng tính năng AI.";
        closeModal('recommend-modal');
        return;
    }
    
    const systemPrompt = `
        Bạn là một trợ lý AI sáng tạo, chuyên phân tích hồ sơ chuyên môn của người dùng để đưa ra các ý tưởng video ngắn (dạng Shorts) có tính giáo dục và hấp dẫn.
        Dựa trên hồ sơ sau: "${userExpertise}", hãy tạo ra 3 ý tưởng nội dung video ngắn.
        Mỗi ý tưởng phải bao gồm:
        1. Tiêu đề hấp dẫn (Tối đa 50 ký tự).
        2. Mô tả ngắn gọn về nội dung (Tối đa 100 ký tự).
        3. Liên quan rõ ràng đến 1 hoặc 2 lĩnh vực chuyên môn/sở thích của người dùng.
        4. Định dạng video: Phải là định dạng "Shorts" (ngắn, nhanh, hướng đến nội dung học tập giải trí).
        
        Định dạng đầu ra phải là một mảng JSON tuân thủ schema đã định.
    `;
    
    const userQuery = "Phân tích hồ sơ và đưa ra 3 ý tưởng video ngắn mới mẻ.";
    const apiKey = GEMINI_API_KEY; 
    const apiUrl = `${GEMINI_API_URL}${apiKey}`;

    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: {
            parts: [{ text: systemPrompt }]
        },
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: "ARRAY",
                items: {
                    type: "OBJECT",
                    properties: {
                        "title": { "type": "STRING", "description": "Tiêu đề hấp dẫn của video." },
                        "description": { "type": "STRING", "description": "Mô tả ngắn gọn nội dung." },
                        "fields": { "type": "ARRAY", "items": { "type": "STRING" }, "description": "Các lĩnh vực chuyên môn liên quan." }
                    },
                    "propertyOrdering": ["title", "description", "fields"]
                }
            }
        }
    };

    DOM.recommendLoading.classList.remove('hidden');
    DOM.recommendBtn.disabled = true;
    DOM.modalContent.innerHTML = `<p class="text-center text-gray-500"><div class="spinner mx-auto my-4 w-6 h-6 border-t-2"></div> AI đang phân tích...</p>`;

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const result = await response.json();
        const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!jsonText) {
             throw new Error("AI không trả về kết quả hợp lệ.");
        }
        
        const recommendations = JSON.parse(jsonText);
        
        let html = '<ul class="space-y-4">';
        recommendations.forEach((rec, index) => {
            html += `
                <li class="p-3 border rounded-lg shadow-sm bg-gray-50">
                    <h4 class="font-bold text-slate-800">Ý tưởng ${index + 1}: ${rec.title}</h4>
                    <p class="text-sm text-gray-600 mt-1">${rec.description}</p>
                    <p class="text-xs text-slate-500 mt-2">Lĩnh vực: ${rec.fields.join(', ')}</p>
                </li>
            `;
        });
        html += '</ul>';
        
        DOM.modalContent.innerHTML = html;

    } catch (error) {
        console.error("Lỗi gọi AI API:", error);
        DOM.modalContent.innerHTML = `<p class="text-center text-red-500">Lỗi: Không thể lấy ý tưởng từ AI. Vui lòng kiểm tra API Key hoặc console.</p>`;
    } finally {
        DOM.recommendLoading.classList.add('hidden');
        DOM.recommendBtn.disabled = false;
    }
};

/**
 * Thiết lập các listener liên quan đến tính năng AI.
 * @param {object} DOM - Các phần tử DOM
 * @param {function} getUserId - Hàm lấy ID người dùng
 */
export const setupAiListeners = (DOM, getUserId) => {
    DOM.recommendBtn.addEventListener('click', () => getAiRecommendations(DOM, getUserId));
    
    // Logic mở modal AI
    DOM.openRecommendModalBtn.addEventListener('click', () => {
         const userId = getUserId();
         if (userId) {
            DOM.recommendModal.classList.add('flex');
            DOM.recommendModal.classList.remove('hidden');
            DOM.modalContent.innerHTML = `<p class="text-center text-gray-500">Nhấn nút <b>Yêu Cầu Ý Tưởng</b> để AI phân tích hồ sơ của bạn.</p>`;
        } else {
            DOM.authMessageEl.textContent = "Vui lòng đăng nhập để sử dụng tính năng AI.";
        }
    });
};
