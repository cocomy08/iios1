/**
 * 小世界 (Little World) 功能模块
 * 包含：动态(Moments) 和 言外之意(Subtext)
 * 触发阈值：动态=5条，言外之意=2条 (测试用)
 * 
 * 智能计数机制：首次安装时记录当前消息数为baseCount，
 * 之后只统计增量，避免老用户一上线就触发大量内容
 */

(function () {
    'use strict';

    // ========== 配置常量 ==========
    const CONFIG = {
        MOMENTS_THRESHOLD: 100,   // 动态触发阈值（每100条消息生成一条动态）
        SUBTEXT_THRESHOLD: 50,    // 言外之意触发阈值（每50条消息生成一条言外之意）
        DB_STORE_NAME: 'settingsStore'  // 使用已存在的settingsStore
    };

    // ========== 状态管理 ==========
    let currentContactId = null;
    let littleWorldData = null;

    // ========== 工具函数 ==========
    function generateUUID() {
        return 'lw_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    function formatTime(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        if (diff < 60000) return '刚刚';
        if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
        if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
        const date = new Date(timestamp);
        return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function showLWToast(message) {
        let toast = document.getElementById('lw-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'lw-toast';
            toast.className = 'lw-toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    }

    // ========== 数据存储（使用appSettings store）==========
    async function loadLittleWorldData(contactId) {
        if (!window.dbHelper) {
            console.warn('[LittleWorld] dbHelper未就绪');
            return null;
        }
        try {
            const data = await window.dbHelper.loadData(CONFIG.DB_STORE_NAME, `littleWorld_${contactId}`);
            return data ? data.value : null;
        } catch (e) {
            console.error('[LittleWorld] 加载数据失败:', e);
            return null;
        }
    }

    async function saveLittleWorldData(contactId, data) {
        if (!window.dbHelper || !contactId) return;
        try {
            await window.dbHelper.saveData(CONFIG.DB_STORE_NAME, `littleWorld_${contactId}`, data);
        } catch (e) {
            console.error('[LittleWorld] 保存数据失败:', e);
        }
    }

    function getDefaultData(baseCount = 0) {
        return {
            baseCount: baseCount,          // 首次安装时的历史消息数
            incrementCount: 0,             // 安装后新增的消息数
            moments: [],
            subtexts: [],
            lastMomentTrigger: 0,
            lastSubtextTrigger: 0,
            installedAt: Date.now()
        };
    }

    // ========== 缓存清理 ==========
    function clearLittleWorldCache() {
        littleWorldData = null;
        currentContactId = null;
        const momentsContainer = document.getElementById('lw-moments-list');
        const subtextsContainer = document.getElementById('lw-subtexts-list');
        if (momentsContainer) momentsContainer.innerHTML = '';
        if (subtextsContainer) subtextsContainer.innerHTML = '';
        console.log('[LittleWorld] 缓存已清理');
    }

    // ========== 初始化小世界 ==========
    async function initLittleWorld(contact) {
        if (!contact || !contact.id) {
            console.error('[LittleWorld] 无效的联系人');
            return;
        }

        // 清理旧缓存
        clearLittleWorldCache();

        currentContactId = contact.id;

        // 获取当前历史消息数
        const historyCount = contact.history ? contact.history.length : 0;

        // 加载数据
        let data = await loadLittleWorldData(contact.id);

        if (!data) {
            // 首次安装：记录当前历史消息数作为baseCount
            data = getDefaultData(historyCount);
            console.log('[LittleWorld] 首次安装，baseCount:', historyCount);
            await saveLittleWorldData(contact.id, data);
        } else {
            // 已安装：计算增量 = 当前历史数 - baseCount
            // 确保增量不会因为删除消息而变成负数
            const calculatedIncrement = Math.max(0, historyCount - data.baseCount);

            // 如果实际历史数比记录的增量还多，说明有新消息
            if (calculatedIncrement > data.incrementCount) {
                data.incrementCount = calculatedIncrement;
                await saveLittleWorldData(contact.id, data);
            }
        }

        littleWorldData = data;

        // 更新UI
        updateLittleWorldUI(contact);

        console.log('[LittleWorld] 初始化完成，消息数:', historyCount, 'baseCount:', data.baseCount, 'increment:', data.incrementCount);

        // 检查是否需要触发生成新内容
        await checkAndTrigger(contact);

        // 重新渲染UI（因为可能有新内容生成）
        updateLittleWorldUI(contact);
    }

    // ========== UI渲染 ==========
    function updateLittleWorldUI(contact) {
        renderMoments(contact);
        renderSubtexts(contact);
    }

    function renderMoments(contact) {
        const container = document.getElementById('lw-moments-list');
        if (!container) return;

        container.innerHTML = '';

        // 空值保护
        if (!littleWorldData) {
            container.innerHTML = '<div class="lw-empty-state"><h3>加载中...</h3></div>';
            return;
        }

        if (!littleWorldData.moments || littleWorldData.moments.length === 0) {
            const remaining = CONFIG.MOMENTS_THRESHOLD - ((littleWorldData.incrementCount || 0) % CONFIG.MOMENTS_THRESHOLD);
            container.innerHTML = `
                <div class="lw-empty-state">
                    <svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path></svg>
                    <h3>暂无动态</h3>
                    <p>再聊 ${remaining} 条消息<br>解锁新动态</p>
                </div>
            `;
            return;
        }

        littleWorldData.moments.forEach((moment, idx) => {
            const card = createMomentCard(moment, contact, idx);
            container.appendChild(card);
        });
    }

    function createMomentCard(moment, contact, index) {
        const div = document.createElement('div');
        div.className = 'lw-moment-card';
        div.dataset.momentId = moment.id;

        const tapeClass = index % 2 === 0 ? '' : 'purple';
        const avatar = contact.ai?.avatar || 'https://api.dicebear.com/7.x/notionists/svg?seed=AI';
        const name = contact.ai?.name || 'AI';

        div.innerHTML = `
            <div class="lw-washi-tape ${tapeClass}"></div>
            <div class="lw-user-header">
                <div class="lw-avatar" style="background-image: url('${avatar}')"></div>
                <div class="lw-user-meta">
                    <h3>${name}</h3>
                    <p>${formatTime(moment.timestamp)}</p>
                </div>
            </div>
            <div class="lw-moment-content">${moment.content}</div>
            <div class="lw-action-row">
                <button class="lw-action-btn ${moment.liked ? 'active' : ''}" data-action="like">
                    <svg viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                    <span>${moment.likeCount || 0}</span>
                </button>
                <button class="lw-action-btn" data-action="comment">
                    <svg viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
                    <span>${moment.comments?.length || 0} 条回复</span>
                </button>
            </div>
        `;

        // 点击打开详情
        div.addEventListener('click', (e) => {
            if (!e.target.closest('.lw-action-btn')) {
                openMomentDetail(moment, contact);
            }
        });

        // 点赞
        const likeBtn = div.querySelector('[data-action="like"]');
        likeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLike(moment);
            likeBtn.classList.toggle('active');
            likeBtn.querySelector('span').textContent = moment.likeCount || 0;
        });

        return div;
    }

    function openMomentDetail(moment, contact) {
        const overlay = document.getElementById('lw-detail-overlay');
        const content = document.getElementById('lw-detail-content');
        if (!overlay || !content) return;

        const avatar = contact.ai?.avatar || '';
        const name = contact.ai?.name || 'AI';
        const userAvatar = contact.user?.avatar || '';

        content.innerHTML = `
            <div class="lw-moment-card" style="margin-bottom:0; box-shadow:none; border:1px solid #F0F0F0;">
                <div class="lw-user-header">
                    <div class="lw-avatar" style="background-image: url('${avatar}')"></div>
                    <div class="lw-user-meta">
                        <h3>${name}</h3>
                        <p>${formatTime(moment.timestamp)}</p>
                    </div>
                </div>
                <div class="lw-moment-content">${moment.content}</div>
            </div>
            <div class="lw-comments-wrap">
                <div class="lw-comments-header">${moment.comments?.length || 0} 条回复</div>
                <div id="lw-comments-list"></div>
                <div class="lw-comment-input-wrap">
                    <input type="text" class="lw-comment-input" id="lw-comment-input" placeholder="写评论...">
                    <button class="lw-comment-send-btn" id="lw-comment-send">
                        <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </button>
                </div>
            </div>
        `;

        // 渲染评论
        renderComments(moment, contact);

        // 发送评论
        const sendBtn = document.getElementById('lw-comment-send');
        const input = document.getElementById('lw-comment-input');
        sendBtn.addEventListener('click', () => sendComment(moment, contact, input.value));
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') sendComment(moment, contact, input.value);
        });

        overlay.classList.add('open');
    }

    function renderComments(moment, contact) {
        const container = document.getElementById('lw-comments-list');
        if (!container) return;
        container.innerHTML = '';

        if (!moment.comments || moment.comments.length === 0) return;

        const userAvatar = contact.user?.avatar || '';
        const aiAvatar = contact.ai?.avatar || '';
        const aiName = contact.ai?.name || 'AI';

        moment.comments.forEach(comment => {
            const isMe = comment.sender === 'user';
            const div = document.createElement('div');
            div.className = `lw-comment-item ${isMe ? 'is-me' : ''}`;

            let repliesHTML = '';
            if (comment.replies && comment.replies.length > 0) {
                repliesHTML = comment.replies.map(reply => `
                    <div class="lw-nested-reply">
                        <div class="lw-c-avatar" style="background-image: url('${reply.sender === 'user' ? userAvatar : aiAvatar}')"></div>
                        <div class="lw-c-box">
                            <div class="lw-c-bubble ${reply.sender === 'ai' ? 'ai-reply' : ''}">${reply.text}</div>
                            <div class="lw-c-meta"><span>${reply.sender === 'user' ? '我' : aiName}</span> · <span>${formatTime(reply.timestamp)}</span></div>
                        </div>
                    </div>
                `).join('');
            }

            div.innerHTML = `
                <div class="lw-thread-line"></div>
                <div class="lw-c-avatar" style="background-image: url('${isMe ? userAvatar : aiAvatar}')"></div>
                <div class="lw-c-box">
                    <div class="lw-c-bubble">${comment.text}</div>
                    <div class="lw-c-meta"><span>${isMe ? '我' : aiName}</span> · <span>${formatTime(comment.timestamp)}</span></div>
                    ${repliesHTML}
                </div>
            `;
            container.appendChild(div);
        });
    }

    async function sendComment(moment, contact, text) {
        if (!text.trim()) return;

        const input = document.getElementById('lw-comment-input');
        if (input) input.value = '';

        // 添加用户评论
        const userComment = {
            id: generateUUID(),
            sender: 'user',
            text: text.trim(),
            timestamp: Date.now(),
            replies: []
        };

        if (!moment.comments) moment.comments = [];
        moment.comments.push(userComment);

        // 保存并渲染
        await saveLittleWorldData(currentContactId, littleWorldData);
        renderComments(moment, contact);

        // 显示输入中状态
        showTypingIndicator();

        // 调用AI回复
        try {
            const aiReply = await generateAICommentReply(contact, moment, text);
            userComment.replies.push({
                id: generateUUID(),
                sender: 'ai',
                text: aiReply,
                timestamp: Date.now()
            });
            await saveLittleWorldData(currentContactId, littleWorldData);
            hideTypingIndicator();
            renderComments(moment, contact);
        } catch (e) {
            console.error('[LittleWorld] AI回复失败:', e);
            hideTypingIndicator();
            showLWToast('AI回复失败');
        }
    }

    function showTypingIndicator() {
        const container = document.getElementById('lw-comments-list');
        if (!container) return;
        const indicator = document.createElement('div');
        indicator.id = 'lw-typing';
        indicator.className = 'lw-typing-indicator';
        indicator.innerHTML = '<span>正在输入中</span><div class="dot"></div><div class="dot"></div><div class="dot"></div>';
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
    }

    function hideTypingIndicator() {
        const indicator = document.getElementById('lw-typing');
        if (indicator) indicator.remove();
    }

    function toggleLike(moment) {
        moment.liked = !moment.liked;
        moment.likeCount = (moment.likeCount || 0) + (moment.liked ? 1 : -1);
        if (moment.likeCount < 0) moment.likeCount = 0;
        saveLittleWorldData(currentContactId, littleWorldData);
    }

    // ========== 言外之意渲染 ==========
    function renderSubtexts(contact) {
        const container = document.getElementById('lw-subtexts-list');
        if (!container) return;

        container.innerHTML = '<div class="lw-subtext-intro">✦ 解锁对话背后的真实想法 ✦</div>';

        // 空值保护
        if (!littleWorldData) {
            container.innerHTML += '<div class="lw-empty-state"><h3>加载中...</h3></div>';
            return;
        }

        if (!littleWorldData.subtexts || littleWorldData.subtexts.length === 0) {
            const remaining = CONFIG.SUBTEXT_THRESHOLD - ((littleWorldData.incrementCount || 0) % CONFIG.SUBTEXT_THRESHOLD);
            container.innerHTML += `
                <div class="lw-empty-state">
                    <svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>
                    <h3>暂无言外之意</h3>
                    <p>再聊 ${remaining} 条消息<br>解锁心声</p>
                </div>
            `;
            return;
        }

        littleWorldData.subtexts.forEach(subtext => {
            const card = createSubtextCard(subtext);
            container.appendChild(card);
        });
    }

    function createSubtextCard(subtext) {
        const div = document.createElement('div');
        div.className = 'lw-secret-card';

        if (subtext.unlocked) {
            div.innerHTML = `
                <div class="lw-secret-cover">
                    <div class="lw-quote-mark">"</div>
                    <div class="lw-public-text">${subtext.originalQuote}</div>
                </div>
                <div class="lw-rip-line"></div>
                <div class="lw-secret-inner">
                    <div class="lw-tag-pill">LOG: HIDDEN_MEANING</div>
                    <div class="lw-inner-text">${subtext.hiddenMeaning}</div>
                </div>
            `;
        } else {
            div.innerHTML = `
                <div class="lw-secret-cover">
                    <div class="lw-quote-mark">"</div>
                    <div class="lw-public-text">${subtext.originalQuote}</div>
                </div>
                <div class="lw-rip-line"></div>
                <div class="lw-locked-layer">
                    <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    <span>再聊 ${Math.max(0, subtext.unlockAt - littleWorldData.incrementCount)} 条解锁心声</span>
                </div>
            `;
        }

        return div;
    }

    // ========== AI生成逻辑 ==========
    async function generateMoment(contact) {
        const history = contact.history || [];
        const recentMessages = history.slice(-10); // 取最近10条

        const aiPersona = contact.ai?.persona || '';
        const aiName = contact.ai?.name || 'AI';

        const prompt = `角色扮演：你是"${aiName}"。
任务：发布一条心情动态（类似朋友圈）。

你的人设：${aiPersona.substring(0, 200)}
最近的对话片段：${recentMessages.slice(-5).map(m => `${m.sender === 'ai' ? aiName : '用户'}: ${m.text?.substring(0, 60) || ''}`).join('\n')}

规则：
1. 直接输出动态内容，禁止任何前缀、标题、引号
2. 50-100字，有情感有趣味
3. 第一人称
4. 可以透露小秘密或幕后花絮`;

        let content = await callLittleWorldAI(contact, prompt);
        return cleanAIResponse(content);
    }

    async function generateSubtext(contact, existingQuotes = []) {
        const history = contact.history || [];
        const recentMessages = history.slice(-50); // 取最近50条
        let aiMessages = recentMessages.filter(m => m.sender === 'ai' && m.text && m.text.length > 15);

        if (aiMessages.length === 0) return null;

        // 去重：排除已经使用过的原话
        if (existingQuotes.length > 0) {
            aiMessages = aiMessages.filter(m => {
                const msgStart = m.text.substring(0, 50);
                return !existingQuotes.some(q => q.includes(msgStart) || msgStart.includes(q.substring(0, 50)));
            });
        }

        if (aiMessages.length === 0) return null;

        const randomMsg = aiMessages[Math.floor(Math.random() * aiMessages.length)];

        // 取完整句子，最多120字符
        let originalQuote = randomMsg.text.substring(0, 120);
        // 如果截断了，在句号/问号/感叹号处截断
        if (originalQuote.length >= 120) {
            const lastPunc = Math.max(
                originalQuote.lastIndexOf('。'),
                originalQuote.lastIndexOf('？'),
                originalQuote.lastIndexOf('！'),
                originalQuote.lastIndexOf('.'),
                originalQuote.lastIndexOf('?'),
                originalQuote.lastIndexOf('!')
            );
            if (lastPunc > 30) {
                originalQuote = originalQuote.substring(0, lastPunc + 1);
            } else {
                originalQuote = originalQuote + '...';
            }
        }

        const prompt = `角色扮演：你是"${contact.ai?.name || 'AI'}"。
任务：针对你说过的一句话，写出当时内心的真实想法（潜台词）。

你说的话："${originalQuote}"

规则：
1. 直接输出潜台词，禁止任何前缀、标题、引号
2. 20-40字，简短俏皮
3. 第一人称
4. 语气可以傲娇/害羞/调皮/心痛/委屈等

示例输出：其实说这话的时候我脸都红了，希望你能懂我的心意啊`;

        let hiddenMeaning = await callLittleWorldAI(contact, prompt);

        // 后处理：清理AI返回的格式问题
        hiddenMeaning = cleanAIResponse(hiddenMeaning);

        return {
            originalQuote,
            hiddenMeaning
        };
    }

    // 清理AI响应中的格式问题
    function cleanAIResponse(text) {
        if (!text) return '（神秘微笑）';

        let cleaned = text;

        // 移除各种AI思考标签
        cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '');
        cleaned = cleaned.replace(/<[^>]+>/g, ''); // 移除所有HTML标签

        // 移除Markdown格式
        cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1'); // 加粗
        cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1'); // 斜体
        cleaned = cleaned.replace(/^#+\s*/gm, ''); // 标题
        cleaned = cleaned.replace(/^[-*]\s*/gm, ''); // 列表

        // 移除常见的AI前缀
        cleaned = cleaned.replace(/^(潜台词|内心想法|真实想法|心声|我的想法)[：:]\s*/i, '');
        cleaned = cleaned.replace(/^[>】\]]\s*/gm, '');

        // 移除引号
        cleaned = cleaned.replace(/^["「『"']+|["」』"']+$/g, '');

        // 移除开头结尾空白
        cleaned = cleaned.trim();

        // 如果清理后太短或太长，截断或使用默认值
        if (cleaned.length < 5) {
            return '（小声嘀咕着什么）';
        }
        if (cleaned.length > 100) {
            // 在标点处截断
            const puncIndex = cleaned.substring(0, 100).lastIndexOf('。');
            if (puncIndex > 30) {
                cleaned = cleaned.substring(0, puncIndex + 1);
            } else {
                cleaned = cleaned.substring(0, 80) + '...';
            }
        }

        return cleaned;
    }

    async function generateAICommentReply(contact, moment, userComment) {
        const prompt = `你是${contact.ai?.name || 'AI'}，你发布了一条动态："${moment.content.substring(0, 100)}"

用户评论说："${userComment}"

请以你的人设身份，简短、俏皮地回复这条评论（1-2句话）：`;

        return await callLittleWorldAI(contact, prompt);
    }

    async function callLittleWorldAI(contact, prompt) {
        // 直接调用API，避免使用callAI的复杂逻辑
        try {
            const settingsData = await window.dbHelper.loadData('settingsStore', 'apiSettings');
            if (!settingsData || !settingsData.value.url) {
                console.warn('[LittleWorld] API未配置，使用模拟回复');
                return getRandomMockReply();
            }

            const { url, key, model, temperature } = settingsData.value;
            let completionsUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            completionsUrl += '/chat/completions';

            // 构建简单的系统提示
            const systemPrompt = `你是${contact.ai?.name || 'AI'}。${contact.ai?.persona || ''}
请根据以下指令生成内容，直接输出结果，不要加任何前缀或解释。`;

            const response = await fetch(completionsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: model || 'gpt-3.5-turbo',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: prompt }
                    ],
                    temperature: parseFloat(temperature) || 0.8,
                    max_tokens: 5000
                })
            });

            if (!response.ok) {
                throw new Error(`API请求失败: ${response.status}`);
            }

            const data = await response.json();
            let content = data.choices?.[0]?.message?.content;

            if (content) {
                // 清理AI思考过程标签
                content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                content = content.replace(/^\*\*.*?\*\*\s*/g, '').trim(); // 移除开头的加粗标题
                content = content.replace(/^[\s\n]+/, '').trim(); // 移除开头空白

                // 如果清理后内容太短，使用模拟回复
                if (content.length < 5) {
                    return getRandomMockReply();
                }

                console.log('[LittleWorld] AI生成成功:', content.substring(0, 50) + '...');
                return content;
            }

            return getRandomMockReply();
        } catch (e) {
            console.error('[LittleWorld] AI调用失败:', e);
            return getRandomMockReply();
        }
    }

    function getRandomMockReply() {
        const mockReplies = [
            '今天的心情像天空一样蓝~',
            '有些话藏在心里，却总想说给你听',
            '和你聊天的每一刻都很珍贵呢',
            '嘿嘿，这是我们之间的小秘密',
            '每次想到你都会不自觉地微笑'
        ];
        return mockReplies[Math.floor(Math.random() * mockReplies.length)];
    }

    // ========== 触发检查 ==========
    async function checkAndTrigger(contact) {
        if (!littleWorldData || !contact) return;

        const count = littleWorldData.incrementCount;

        // 检查动态触发（基于增量计数）
        if (count > 0 && count % CONFIG.MOMENTS_THRESHOLD === 0 && count !== littleWorldData.lastMomentTrigger) {
            littleWorldData.lastMomentTrigger = count;
            try {
                const momentContent = await generateMoment(contact);
                const newMoment = {
                    id: generateUUID(),
                    content: momentContent,
                    timestamp: Date.now(),
                    likeCount: Math.floor(Math.random() * 15) + 1,
                    liked: false,
                    comments: []
                };
                if (!littleWorldData.moments) littleWorldData.moments = [];
                littleWorldData.moments.unshift(newMoment);
                await saveLittleWorldData(currentContactId, littleWorldData);
                showLWToast('新动态已生成！');
            } catch (e) {
                console.error('[LittleWorld] 生成动态失败:', e);
            }
        }

        // 检查言外之意触发
        if (count > 0 && count % CONFIG.SUBTEXT_THRESHOLD === 0 && count !== littleWorldData.lastSubtextTrigger) {
            littleWorldData.lastSubtextTrigger = count;
            try {
                // 获取已有的原话用于去重
                const existingQuotes = (littleWorldData.subtexts || []).map(s => s.originalQuote);
                const subtextData = await generateSubtext(contact, existingQuotes);
                if (subtextData) {
                    // 确保subtexts数组存在
                    if (!littleWorldData.subtexts) littleWorldData.subtexts = [];

                    // 只添加一个新的解锁内容
                    littleWorldData.subtexts.unshift({
                        id: generateUUID(),
                        originalQuote: subtextData.originalQuote,
                        hiddenMeaning: subtextData.hiddenMeaning,
                        unlocked: true,
                        timestamp: Date.now()
                    });

                    await saveLittleWorldData(currentContactId, littleWorldData);
                    showLWToast('新的言外之意已解锁！');
                }
            } catch (e) {
                console.error('[LittleWorld] 生成言外之意失败:', e);
            }
        }
    }

    // ========== 后台静默检查（不需要打开UI）==========
    async function backgroundCheck(contact, data) {
        if (!contact || !data) return;

        const count = data.incrementCount;
        console.log('[LittleWorld] 后台检查 increment:', count);

        // 检查动态触发
        if (count > 0 && count % CONFIG.MOMENTS_THRESHOLD === 0 && count !== data.lastMomentTrigger) {
            data.lastMomentTrigger = count;
            try {
                console.log('[LittleWorld] 后台触发动态生成...');
                const momentContent = await generateMoment(contact);
                const newMoment = {
                    id: generateUUID(),
                    content: momentContent,
                    timestamp: Date.now(),
                    likeCount: Math.floor(Math.random() * 15) + 1,
                    liked: false,
                    comments: []
                };
                if (!data.moments) data.moments = [];
                data.moments.unshift(newMoment);
                await saveLittleWorldData(contact.id, data);
                console.log('[LittleWorld] 后台动态生成成功！');
            } catch (e) {
                console.error('[LittleWorld] 后台生成动态失败:', e);
            }
        }

        // 检查言外之意触发
        if (count > 0 && count % CONFIG.SUBTEXT_THRESHOLD === 0 && count !== data.lastSubtextTrigger) {
            data.lastSubtextTrigger = count;
            try {
                console.log('[LittleWorld] 后台触发言外之意生成...');
                // 获取已有的原话用于去重
                const existingQuotes = (data.subtexts || []).map(s => s.originalQuote);
                const subtextData = await generateSubtext(contact, existingQuotes);
                if (subtextData) {
                    if (!data.subtexts) data.subtexts = [];

                    // 只添加一个新的解锁内容
                    data.subtexts.unshift({
                        id: generateUUID(),
                        originalQuote: subtextData.originalQuote,
                        hiddenMeaning: subtextData.hiddenMeaning,
                        unlocked: true,
                        timestamp: Date.now()
                    });

                    await saveLittleWorldData(contact.id, data);
                    console.log('[LittleWorld] 后台言外之意生成成功！');
                }
            } catch (e) {
                console.error('[LittleWorld] 后台生成言外之意失败:', e);
            }
        }
    }

    // ========== 消息计数器 ==========
    function incrementMessageCount() {
        if (!littleWorldData) return;
        littleWorldData.incrementCount++;
        saveLittleWorldData(currentContactId, littleWorldData);
        console.log('[LittleWorld] 消息计数+1, 当前:', littleWorldData.incrementCount);
    }

    // ========== 页面切换 ==========
    function switchTab(tabId) {
        document.querySelectorAll('.lw-tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.lw-page-view').forEach(view => view.classList.remove('active'));

        const btn = document.querySelector(`[data-lw-tab="${tabId}"]`);
        const view = document.getElementById(tabId);
        if (btn) btn.classList.add('active');
        if (view) view.classList.add('active');
    }

    // ========== 打开/关闭小世界 ==========
    function openLittleWorld() {
        const overlay = document.getElementById('littleworld-overlay');
        if (overlay) {
            overlay.classList.add('active');
            overlay.classList.remove('closing');
        }

        // 使用当前联系人初始化
        if (window.currentOpenContact) {
            initLittleWorld(window.currentOpenContact);
        }
    }

    function closeLittleWorld() {
        const overlay = document.getElementById('littleworld-overlay');
        if (overlay) {
            overlay.classList.add('closing');
            setTimeout(() => {
                overlay.classList.remove('active', 'closing');
                clearLittleWorldCache();
            }, 300);
        }
    }

    function closeDetail() {
        const overlay = document.getElementById('lw-detail-overlay');
        if (overlay) overlay.classList.remove('open');
    }

    // ========== 初始化事件绑定 ==========
    function bindEvents() {
        // 入口按钮
        document.addEventListener('click', (e) => {
            if (e.target.closest('.bigworld-entry-btn')) {
                openLittleWorld();
            }
        });

        // 返回按钮
        document.addEventListener('click', (e) => {
            if (e.target.closest('#lw-back-btn')) {
                closeLittleWorld();
            }
            if (e.target.closest('#lw-detail-back-btn')) {
                closeDetail();
            }
        });

        // Tab切换
        document.addEventListener('click', (e) => {
            const tabBtn = e.target.closest('.lw-tab-btn');
            if (tabBtn && tabBtn.dataset.lwTab) {
                switchTab(tabBtn.dataset.lwTab);
            }
        });
    }

    // ========== 暴露全局API ==========
    window.LittleWorld = {
        init: initLittleWorld,
        open: openLittleWorld,
        close: closeLittleWorld,
        incrementCount: incrementMessageCount,
        checkTrigger: checkAndTrigger,
        backgroundCheck: backgroundCheck,
        clearCache: clearLittleWorldCache
    };

    // DOM Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindEvents);
    } else {
        bindEvents();
    }

    console.log('[LittleWorld] 模块已加载');
})();
