/**
 * 音乐播放器核心模块 - "一起听" 功能
 * 基于原型图 prototype/music.html 的 UI 设计实现
 */

const MusicPlayer = (function () {
    'use strict';

    // =============== 状态管理 ===============
    const state = {
        isPlaying: false,
        currentTrack: null,
        playlist: [],
        currentIndex: 0,
        volume: 0.8,
        shuffle: false,
        repeat: 'none', // 'none', 'one', 'all'
        listenTogetherActive: false,
        listenTogetherMessages: [],
        // 歌词相关
        showLyric: false,
        lyrics: [],  // [{time: 秒, text: 歌词}]
        currentLyricIndex: -1
    };

    // DOM 元素缓存
    let els = {};

    // Audio 实例
    let audio = null;

    // 进度条更新定时器
    let progressTimer = null;

    // =============== 初始化 ===============

    function init() {
        // 创建 Audio 元素
        audio = new Audio();
        audio.volume = state.volume;

        // 绑定音频事件
        audio.addEventListener('ended', handleTrackEnd);
        audio.addEventListener('timeupdate', updateProgress);
        audio.addEventListener('loadedmetadata', handleMetadataLoaded);
        audio.addEventListener('error', handlePlayError);
        audio.addEventListener('play', () => updatePlayState(true));
        audio.addEventListener('pause', () => updatePlayState(false));

        // 缓存 DOM 元素
        cacheElements();

        // 绑定 UI 事件
        bindEvents();

        console.log('[MusicPlayer] 初始化完成');
    }

    function cacheElements() {
        els = {
            // 播放器界面
            playerScreen: document.getElementById('music-player-screen'),
            playerBg: document.getElementById('music-player-bg'),

            // 封面和信息
            albumArt: document.getElementById('music-album-art'),
            trackTitle: document.getElementById('music-track-title'),
            trackArtist: document.getElementById('music-track-artist'),

            // 进度条
            progressBar: document.getElementById('music-progress-bar'),
            progressFill: document.getElementById('music-progress-fill'),
            progressKnob: document.getElementById('music-progress-knob'),
            currentTime: document.getElementById('music-current-time'),
            totalTime: document.getElementById('music-total-time'),

            // 控制按钮
            playBtn: document.getElementById('music-play-btn'),
            prevBtn: document.getElementById('music-prev-btn'),
            nextBtn: document.getElementById('music-next-btn'),
            shuffleBtn: document.getElementById('music-shuffle-btn'),
            playlistBtn: document.getElementById('music-playlist-btn'),

            // 浮动胶囊
            floatingCapsule: document.getElementById('music-floating-capsule'),
            capsuleArt: document.getElementById('music-capsule-art'),
            capsuleText: document.getElementById('music-capsule-text'),

            // 歌单面板
            playlistSheet: document.getElementById('music-playlist-sheet'),
            playlistContainer: document.getElementById('music-playlist-container'),

            // 搜索面板
            searchSheet: document.getElementById('music-search-sheet'),
            searchInput: document.getElementById('music-search-input'),
            searchResults: document.getElementById('music-search-results'),

            // 一起听聊天
            miniChatList: document.getElementById('music-mini-chat-list'),
            miniChatInput: document.getElementById('music-mini-chat-input'),

            // 歌词视图
            lyricView: document.getElementById('music-lyric-view'),
            lyricScroll: document.getElementById('music-lyric-scroll')
        };
    }

    function bindEvents() {
        // 如果元素不存在则跳过
        if (!els.playBtn) return;

        // 播放/暂停
        els.playBtn?.addEventListener('click', togglePlay);

        // 上一首/下一首
        els.prevBtn?.addEventListener('click', playPrev);
        els.nextBtn?.addEventListener('click', playNext);

        // 随机播放
        els.shuffleBtn?.addEventListener('click', toggleShuffle);

        // 打开歌单
        els.playlistBtn?.addEventListener('click', () => toggleSheet('playlist', true));

        // 进度条拖动
        els.progressBar?.addEventListener('click', seekTo);

        // 浮动胶囊点击
        els.floatingCapsule?.addEventListener('click', () => togglePlayerScreen(true));

        // 搜索输入
        els.searchInput?.addEventListener('input', debounce(handleSearch, 300));

        // 一起听聊天发送
        els.miniChatInput?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendChatMessage(e.target.value);
                e.target.value = '';
            }
        });
    }

    // =============== 播放控制 ===============

    /**
     * 播放指定歌曲
     * @param {Object} track 歌曲对象
     */
    async function play(track) {
        if (!track) return;

        state.currentTrack = track;
        state.isPlaying = false;

        // 重置歌词状态
        state.lyrics = [];
        state.currentLyricIndex = -1;
        if (state.showLyric) {
            loadLyrics(track.id);
        }

        // 更新UI（使用当前歌曲信息）
        updateTrackInfo();
        updatePlayState(false);

        // 获取播放地址
        try {
            const result = await NeteaseMusic.getSongUrl(track.id);

            if (!result || !result.url) {
                showToast('该歌曲暂不可播放（可能需要VIP）');
                console.warn('[MusicPlayer] 无法获取播放地址:', track.name);
                return;
            }

            // console.log('[MusicPlayer] 开始播放:', track.name, result.url);

            // 设置音频源并播放
            audio.src = result.url;
            audio.play().then(() => {
                state.isPlaying = true;
                updatePlayState(true);
            }).catch(e => {
                if (e.name !== 'AbortError') {
                    console.error('[MusicPlayer] 播放失败:', e);
                    showToast('播放失败，请稍后重试');
                }
            });

        } catch (e) {
            console.error('[MusicPlayer] 获取播放地址失败:', e);
            showToast('播放失败，请检查网络');
        }
    }

    /**
     * 切换播放/暂停
     */
    function togglePlay() {
        if (!state.currentTrack) {
            // 没有当前歌曲，播放歌单第一首
            if (state.playlist.length > 0) {
                play(state.playlist[0]);
            }
            return;
        }

        if (state.isPlaying) {
            audio.pause();
        } else {
            audio.play();
        }
    }

    /**
     * 上一首
     */
    function playPrev() {
        if (state.playlist.length === 0) return;

        // 记录切歌前的歌曲（用于 AI 反馈）
        const prevTrack = state.currentTrack;

        if (state.shuffle) {
            state.currentIndex = Math.floor(Math.random() * state.playlist.length);
        } else {
            state.currentIndex = (state.currentIndex - 1 + state.playlist.length) % state.playlist.length;
        }

        const newTrack = state.playlist[state.currentIndex];
        play(newTrack);

        // 在一起听模式下触发切歌反馈
        if (state.listenTogetherActive && prevTrack) {
            setTimeout(() => {
                triggerAIFeedback('user_skip', { prevTrack, track: newTrack });
            }, 500);
        }
    }

    /**
     * 下一首
     */
    function playNext() {
        if (state.playlist.length === 0) return;

        // 记录切歌前的歌曲（用于 AI 反馈）
        const prevTrack = state.currentTrack;

        if (state.shuffle) {
            state.currentIndex = Math.floor(Math.random() * state.playlist.length);
        } else {
            state.currentIndex = (state.currentIndex + 1) % state.playlist.length;
        }

        const newTrack = state.playlist[state.currentIndex];
        play(newTrack);

        // 在一起听模式下触发切歌反馈
        if (state.listenTogetherActive && prevTrack) {
            setTimeout(() => {
                triggerAIFeedback('user_skip', { prevTrack, track: newTrack });
            }, 500);
        }
    }

    /**
     * 切换随机播放
     */
    function toggleShuffle() {
        state.shuffle = !state.shuffle;
        els.shuffleBtn?.classList.toggle('active', state.shuffle);
        showToast(state.shuffle ? '已开启随机播放' : '已关闭随机播放');
    }

    /**
     * 跳转到指定位置
     */
    function seekTo(e) {
        if (!audio.duration) return;

        const rect = els.progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        audio.currentTime = percent * audio.duration;
    }

    /**
     * 歌曲结束处理
     */
    function handleTrackEnd() {
        if (state.repeat === 'one') {
            audio.currentTime = 0;
            audio.play();
        } else if (state.repeat === 'all' || state.currentIndex < state.playlist.length - 1) {
            playNext();
        } else {
            state.isPlaying = false;
            updatePlayState(false);
        }
    }

    /**
     * 播放错误处理
     */
    function handlePlayError(e) {
        console.error('[MusicPlayer] 播放错误:', e);
        showToast('播放出错，正在跳过...');
        setTimeout(playNext, 1000);
    }

    // =============== UI 更新 ===============

    // 追踪上一次播放状态，避免重复触发
    let lastPlayingState = null;

    /**
     * 更新播放状态UI
     */
    function updatePlayState(playing) {
        const wasPlaying = state.isPlaying;
        state.isPlaying = playing;

        // 更新播放按钮图标 - 直接使用SVG
        if (els.playBtn) {
            if (playing) {
                els.playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
            } else {
                els.playBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
            }
        }

        // 更新播放器界面状态
        els.playerScreen?.classList.toggle('playing', playing);

        // 更新浮动胶囊
        if (els.floatingCapsule) {
            els.floatingCapsule.classList.toggle('playing', playing);
            const bars = els.floatingCapsule.querySelectorAll('.bar');
            bars.forEach(bar => {
                bar.style.animationPlayState = playing ? 'running' : 'paused';
            });
        }

        // 【新增】在一起听模式下，暂停/恢复时触发 AI 反馈
        if (state.listenTogetherActive && state.currentTrack && lastPlayingState !== null) {
            if (wasPlaying && !playing) {
                // 暂停时触发
                triggerAIFeedback('track_pause', { track: state.currentTrack });
            } else if (!wasPlaying && playing && lastPlayingState === false) {
                // 恢复播放时触发（排除首次播放）
                triggerAIFeedback('track_resume', { track: state.currentTrack });
            }
        }
        lastPlayingState = playing;
    }

    /**
     * 更新歌曲信息UI
     */
    function updateTrackInfo() {
        const track = state.currentTrack;
        if (!track) return;

        // 更新播放器界面
        if (els.trackTitle) els.trackTitle.textContent = track.name;
        if (els.trackArtist) els.trackArtist.textContent = track.artist;
        if (els.albumArt) {
            els.albumArt.style.backgroundImage = `url(${track.cover})`;
        }

        // 更新浮动胶囊
        if (els.capsuleText) els.capsuleText.textContent = track.name;
        if (els.capsuleArt) {
            els.capsuleArt.style.backgroundImage = `url(${track.cover})`;
        }

        // 更新背景色彩（根据封面提取主色调）
        updatePlayerBackground(track.cover);
    }

    /**
     * 更新进度条
     */
    function updateProgress() {
        if (!audio.duration) return;

        const percent = (audio.currentTime / audio.duration) * 100;

        if (els.progressFill) {
            els.progressFill.style.width = percent + '%';
        }

        if (els.currentTime) {
            els.currentTime.textContent = formatTime(audio.currentTime);
        }

        // 更新歌词高亮
        updateLyricHighlight(audio.currentTime);
    }

    /**
     * 元数据加载完成
     */
    function handleMetadataLoaded() {
        if (els.totalTime) {
            els.totalTime.textContent = formatTime(audio.duration);
        }
    }

    /**
     * =============== iOS 内存优化：图片压缩 ===============
     * 优化图片URL，对网易云音乐的图片使用缩略图
     * @param {string} url - 原始图片URL
     * @returns {string} - 优化后的URL
     */
    function optimizeImageUrl(url) {
        if (!url) return url;

        // 网易云音乐图片优化：添加缩略图参数
        if (url.includes('music.126.net') || url.includes('p1.music') || url.includes('p2.music')) {
            // 如果URL已经有参数，不重复添加
            if (url.includes('param=')) return url;
            // 添加300x300缩略图参数，大幅减少内存占用
            return url + '?param=300y300';
        }

        return url;
    }
    // =====================================================


    /**
     * 更新播放器背景（使用color-thief提取封面主色调）
     */
    function updatePlayerBackground(coverUrl) {
        if (!els.playerBg || !coverUrl) {
            // 使用默认渐变
            if (els.playerBg) {
                els.playerBg.style.background = 'linear-gradient(180deg, #4A304D 0%, #1A1A1D 100%)';
            }
            return;
        }

        // 创建临时图片来提取颜色
        const img = new Image();
        img.crossOrigin = 'Anonymous';

        img.onload = () => {
            try {
                // 使用 Color Thief 提取主色调
                if (typeof ColorThief !== 'undefined') {
                    const colorThief = new ColorThief();

                    // 获取主色调
                    const dominantColor = colorThief.getColor(img);

                    // 获取调色板（2个颜色）
                    const palette = colorThief.getPalette(img, 2);

                    // 构建渐变色
                    const [r1, g1, b1] = dominantColor;
                    const [r2, g2, b2] = palette[1] || [r1 * 0.5, g1 * 0.5, b1 * 0.5];

                    // 稍微调暗颜色，增加沉浸感
                    const darken = (r, g, b, factor = 0.7) => [
                        Math.floor(r * factor),
                        Math.floor(g * factor),
                        Math.floor(b * factor)
                    ];

                    const [dr1, dg1, db1] = darken(r1, g1, b1, 0.8);
                    const [dr2, dg2, db2] = darken(r2, g2, b2, 0.4);

                    els.playerBg.style.background = `linear-gradient(180deg, 
                        rgb(${dr1}, ${dg1}, ${db1}) 0%, 
                        rgb(${dr2}, ${dg2}, ${db2}) 100%)`;

                    // 更新发光效果颜色
                    const glowEl = document.querySelector('.music-player-glow');
                    if (glowEl) {
                        glowEl.style.background = `radial-gradient(circle, 
                            rgba(${r1}, ${g1}, ${b1}, 0.4) 0%, 
                            transparent 70%)`;
                    }

                    // console.log('[MusicPlayer] 已提取封面主色调:', dominantColor);
                }
            } catch (e) {
                console.warn('[MusicPlayer] 提取颜色失败，使用默认背景:', e);
                els.playerBg.style.background = 'linear-gradient(180deg, #4A304D 0%, #1A1A1D 100%)';
            }
        };

        img.onerror = () => {
            console.warn('[MusicPlayer] 封面图片加载失败');
            els.playerBg.style.background = 'linear-gradient(180deg, #4A304D 0%, #1A1A1D 100%)';
        };

        // =============== iOS 内存优化：使用压缩后的图片 ===============
        // 加载优化后的图片（缩略图）
        img.src = optimizeImageUrl(coverUrl);
        // =============================================================
    }

    // =============== 界面切换 ===============

    /**
     * 切换播放器界面显示
     */
    function togglePlayerScreen(show) {
        if (!els.playerScreen) return;

        if (show) {
            els.playerScreen.classList.add('active');
            els.floatingCapsule?.classList.remove('visible');
        } else {
            els.playerScreen.classList.remove('active');
            // 延迟显示胶囊
            setTimeout(() => {
                if (state.currentTrack) {
                    els.floatingCapsule?.classList.add('visible');
                }
            }, 300);
        }
    }

    /**
     * 切换底部面板
     * @param {string} type 'playlist' | 'search'
     * @param {boolean} show 是否显示
     */
    function toggleSheet(type, show) {
        const sheet = type === 'playlist' ? els.playlistSheet : els.searchSheet;
        if (!sheet) return;

        if (show) {
            sheet.classList.add('open');
            if (type === 'playlist') {
                renderPlaylist();
            }
        } else {
            sheet.classList.remove('open');
        }
    }

    /**
     * 最小化播放器（显示浮动胶囊）
     */
    function minimize() {
        togglePlayerScreen(false);
    }

    // =============== 歌词功能 ===============

    /**
     * 切换歌词/封面视图
     */
    function toggleLyricView() {
        state.showLyric = !state.showLyric;

        if (els.albumArt) {
            els.albumArt.style.display = state.showLyric ? 'none' : 'block';
        }
        if (els.lyricView) {
            els.lyricView.style.display = state.showLyric ? 'block' : 'none';
        }

        // 如果切换到歌词视图且还没加载歌词，则加载
        if (state.showLyric && state.lyrics.length === 0 && state.currentTrack) {
            loadLyrics(state.currentTrack.id);
        }
    }

    /**
     * 加载歌词
     */
    async function loadLyrics(songId) {
        if (!songId) return;

        try {
            const result = await NeteaseMusic.getLyric(songId);
            if (result && result.lrc) {
                state.lyrics = parseLRC(result.lrc);
                renderLyrics();
            } else {
                showNoLyrics();
            }
        } catch (e) {
            console.error('[MusicPlayer] 加载歌词失败:', e);
            showNoLyrics();
        }
    }

    /**
     * 解析LRC歌词格式
     */
    function parseLRC(lrcText) {
        const lines = lrcText.split('\n');
        const lyrics = [];

        // 匹配 [mm:ss.xx] 或 [mm:ss] 格式
        const timeRegex = /\[(\d{2}):(\d{2})\.?(\d{0,3})\]/g;

        lines.forEach(line => {
            const matches = [...line.matchAll(timeRegex)];
            if (matches.length === 0) return;

            // 提取歌词文本（去掉时间标签）
            const text = line.replace(timeRegex, '').trim();
            if (!text) return;

            // 每个时间标签对应同一行歌词
            matches.forEach(match => {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const msStr = match[3] || '0';
                // 修正毫秒解析：如果是2位，通过 * 10 转换为毫秒；如果是3位，直接是毫秒
                const ms = msStr.length === 2 ? parseInt(msStr) * 10 : parseInt(msStr);
                const time = minutes * 60 + seconds + ms / 1000;

                lyrics.push({ time, text });
            });
        });

        // 按时间排序
        return lyrics.sort((a, b) => a.time - b.time);
    }

    /**
     * 渲染歌词
     */
    function renderLyrics() {
        if (!els.lyricScroll) return;

        if (state.lyrics.length === 0) {
            showNoLyrics();
            return;
        }

        els.lyricScroll.innerHTML = state.lyrics.map((lyric, index) =>
            `<div class="music-lyric-line" data-index="${index}" data-time="${lyric.time}">${lyric.text}</div>`
        ).join('');

        // 绑定点击事件（点击歌词跳转到对应位置）
        els.lyricScroll.querySelectorAll('.music-lyric-line').forEach(el => {
            el.onclick = (e) => {
                // 阻止冒泡，避免触发容器的切换视图事件
                e.stopPropagation();

                const time = parseFloat(el.dataset.time);
                if (audio && !isNaN(time)) {
                    audio.currentTime = time;
                    // 可选：跳转后给予反馈
                    if (window.showToast) window.showToast('已跳转');
                }
            };
        });
    }

    /**
     * 无歌词状态
     */
    function showNoLyrics() {
        if (!els.lyricScroll) return;
        els.lyricScroll.innerHTML = `
            <div class="music-lyric-empty">
                <div class="music-lyric-empty-icon">🎵</div>
                <p>暂无歌词</p>
            </div>
        `;
    }

    /**
     * 更新当前歌词高亮（需要在进度更新时调用）
     */
    function updateLyricHighlight(currentTime) {
        if (!state.showLyric || state.lyrics.length === 0) return;

        // 找到当前时间对应的歌词索引
        let newIndex = -1;
        for (let i = state.lyrics.length - 1; i >= 0; i--) {
            if (currentTime >= state.lyrics[i].time) {
                newIndex = i;
                break;
            }
        }

        // 索引没变则不更新
        if (newIndex === state.currentLyricIndex) return;

        state.currentLyricIndex = newIndex;

        // 更新高亮样式
        if (!els.lyricScroll) return;

        const lines = els.lyricScroll.querySelectorAll('.music-lyric-line');
        // 移除所有旧状态
        els.lyricScroll.querySelector('.active')?.classList.remove('active');

        lines.forEach((line, index) => {
            if (index === newIndex) {
                line.classList.add('active');
                line.classList.remove('passed');
                // 滚动到当前歌词 (使用 scrollIntoView 更稳健)
                line.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (index < newIndex) {
                line.classList.add('passed');
                line.classList.remove('active');
            } else {
                line.classList.remove('passed', 'active');
            }
        });
    }

    /**
     * 滚动到当前歌词（已废弃，直接使用 scrollIntoView）
     */
    function scrollToLyric(element) {
        // 保留空函数以防其他地方调用
    }

    // =============== 歌单管理 ===============

    /**
     * 保存歌单到当前联系人
     */
    async function savePlaylistToContact() {
        if (window.currentOpenContact && window.dbHelper) {
            try {
                // 更新当前内存中的对象，确保UI和其他逻辑一致
                window.currentOpenContact.playlist = state.playlist;

                // IndexDB 持久化流程：
                // 1. 读取所有联系人列表
                // 注意：根据 shop-ceramic.js 的用法，联系人列表存储在 'messageContacts' 仓库的 'allContacts' 键下
                const result = await window.dbHelper.loadData('messageContacts', 'allContacts');

                if (result && result.value && Array.isArray(result.value)) {
                    const allContacts = result.value;
                    const contactId = window.currentOpenContact.id;

                    // 2. 在列表中找到当前联系人并更新
                    const index = allContacts.findIndex(c => c.id === contactId);
                    if (index !== -1) {
                        allContacts[index].playlist = state.playlist;

                        // 3. 保存回数据库
                        await window.dbHelper.saveData('messageContacts', 'allContacts', allContacts);
                        // console.log('[MusicPlayer] 歌单已同步保存到数据库', contactId);
                    } else {
                        console.warn('[MusicPlayer] 数据库中未找到当前联系人，无法保存歌单');
                    }
                }
            } catch (e) {
                console.error('[MusicPlayer] 保存歌单失败:', e);
                // 降级：如果数据库操作失败，至少内存中已更新，仅本次会话有效
            }
        }
    }

    /**
     * 添加歌曲到歌单
     */
    function addToPlaylist(track, addedBy = 'user') {
        if (!track) return;

        const exists = state.playlist.some(t => t.id === track.id);
        if (!exists) {
            // 记录是谁点的歌
            // 如果是 AI 点歌，传入的是 'ai' 或者 AI 的名字
            // 如果是用户，传入 'user'
            // 我们统一存储显示用的名字
            let addedByName = addedBy;
            if (addedBy === 'ai') {
                // 尝试多种路径获取名字：直接name > ai.name > 默认值
                addedByName = window.currentOpenContact?.name || window.currentOpenContact?.ai?.name || 'TA';
            } else if (addedBy === 'user') {
                addedByName = 'user'; // 特殊标记，不显示名字或显示“你”
            }

            track.addedBy = addedByName;
            track.addedAt = Date.now();

            state.playlist.push(track);
            renderPlaylist();

            // 持久化保存
            savePlaylistToContact();

            showToast(`已添加到播放列表${addedBy !== 'user' ? ' (由 ' + addedByName + ' 点歌)' : ''}`);
        } else {
            showToast('歌曲已在列表中');
        }
    }

    /**
     * 从歌单移除歌曲
     */
    function removeFromPlaylist(trackId) {
        const index = state.playlist.findIndex(t => t.id === trackId);
        if (index > -1) {
            state.playlist.splice(index, 1);
            renderPlaylist();

            // 持久化保存
            savePlaylistToContact();

            // 如果删除的是当前播放的歌曲
            if (state.currentTrack && state.currentTrack.id === trackId) {
                if (state.playlist.length > 0) {
                    playNext();
                } else {
                    audio.pause();
                    state.isPlaying = false;
                    state.currentTrack = null;
                    updatePlayState(false);
                    // 重置界面
                    if (els.trackTitle) els.trackTitle.textContent = '选择一首歌';
                    if (els.trackArtist) els.trackArtist.textContent = '搜索添加音乐';
                }
            }
        }
    }

    /**
     * 渲染歌单列表
     */
    function renderPlaylist() {
        if (els.playlistContainer && state.playlist.length > 0) {
            els.playlistContainer.innerHTML = state.playlist.map((track, index) => {
                const isPlaying = state.currentTrack && state.currentTrack.id === track.id;
                // 判断 Tag 显示内容
                let tagHtml = '';
                if (track.addedBy && track.addedBy !== 'user') {
                    tagHtml = `<span class="music-song-tag ai">${track.addedBy} 点歌</span>`;
                }

                return `
                    <div class="music-playlist-item ${isPlaying ? 'playing' : ''}" onclick="MusicPlayer.playAt(${index})">
                        <div class="music-song-idx">${isPlaying ? '<i data-lucide="bar-chart-2" class="music-playing-icon"></i>' : index + 1}</div>
                        <div class="music-song-details">
                            <div class="music-song-name">${track.name}</div>
                            <div class="music-song-meta">
                                ${tagHtml}
                                ${track.artist}
                            </div>
                        </div>
                        <button class="music-remove-btn" onclick="event.stopPropagation(); MusicPlayer.removeFromPlaylist(${track.id})">
                            <i data-lucide="x"></i>
                        </button>
                    </div>
                `;
            }).join('');

            lucide.createIcons();
        } else if (els.playlistContainer) {
            els.playlistContainer.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">暂无歌曲</div>';
        }
    }

    /**
     * 播放歌单中指定位置的歌曲
     */
    function playAt(index) {
        if (index >= 0 && index < state.playlist.length) {
            state.currentIndex = index;
            play(state.playlist[index]);
            // 立即更新歌单 UI，确保 .playing 状态立刻生效
            renderPlaylist();
        }
    }

    // =============== 搜索功能 ===============

    /**
     * 处理搜索
     */
    async function handleSearch() {
        const query = els.searchInput?.value.trim();
        if (!query) {
            els.searchResults.innerHTML = '';
            return;
        }

        try {
            const results = await NeteaseMusic.searchSongs(query);
            renderSearchResults(results);
        } catch (e) {
            console.error('[MusicPlayer] 搜索失败:', e);
            els.searchResults.innerHTML = '<div class="music-error">搜索失败，请重试</div>';
        }
    }

    /**
     * 渲染搜索结果
     */
    function renderSearchResults(songs) {
        if (!els.searchResults) return;

        if (songs.length === 0) {
            els.searchResults.innerHTML = '<div class="music-empty-state">没有找到相关歌曲</div>';
            return;
        }

        els.searchResults.innerHTML = songs.map(song => `
            <div class="music-search-item" onclick="MusicPlayer.addAndPlay(${JSON.stringify(song).replace(/"/g, '&quot;')})">
                <div class="music-song-cover" style="background-image: url(${song.cover})"></div>
                <div class="music-song-details">
                    <div class="music-song-name">${song.name}</div>
                    <div class="music-song-meta">${song.artist} · ${NeteaseMusic.formatDuration(song.duration)}</div>
                </div>
                <button class="music-add-btn" onclick="MusicPlayer.addSongOnly(${JSON.stringify(song).replace(/"/g, '&quot;')}, event)">
                    <i data-lucide="plus"></i>
                </button>
            </div>
        `).join('');

        lucide.createIcons();
    }

    /**
     * 添加并播放歌曲
     */
    function addAndPlay(track) {
        addToPlaylist(track);
        state.currentIndex = state.playlist.length - 1;
        play(track);
        toggleSheet('search', false);
    }

    /**
     * 仅添加歌曲到播放列表（不立即播放）
     */
    function addSongOnly(track, event) {
        if (event) {
            event.stopPropagation();
        }
        addToPlaylist(track);

        // 视觉反馈
        if (event && event.currentTarget) {
            const btn = event.currentTarget;
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="check"></i>';
            btn.style.color = 'var(--music-accent)';
            btn.style.borderColor = 'var(--music-accent)';

            lucide.createIcons();

            setTimeout(() => {
                btn.innerHTML = originalHTML;
                btn.style.color = '';
                btn.style.borderColor = '';
                lucide.createIcons();
            }, 1000);
        }

        showToast('已添加到播放列表');
    }

    // =============== 一起听功能 ===============

    /**
     * 开始一起听会话
     */

    function startListenTogether() {
        state.listenTogetherActive = true;
        state.listenTogetherMessages = [];
        state.sessionStartTime = Date.now();

        // 加载当前联系人的歌单
        if (window.currentOpenContact?.playlist && window.currentOpenContact.playlist.length > 0) {
            // 深度复制一份，避免引用问题
            state.playlist = JSON.parse(JSON.stringify(window.currentOpenContact.playlist));
            // console.log('[MusicPlayer] 已加载联系人歌单:', state.playlist.length, '首');
        } else {
            // ✅ 如果该联系人没有歌单，必须清空，否则会显示上一位联系人的歌单
            state.playlist = [];
            console.log('[MusicPlayer] 该联系人暂无已保存歌单，已清空列表');
        }

        // 渲染歌单（确保加载后UI更新）
        renderPlaylist();

        togglePlayerScreen(true);
        if (els.playerScreen) {
            els.playerScreen.classList.add('listen-together-active');
        }

        // 发送开始消息给AI
        addChatMessage('system', '一起听会话已开始');

        // 开启沉默检测（60秒无消息时 AI 主动发言）
        startSilenceDetection();

        // 如果当前有歌正在播放，立即触发一次AI反馈
        if (state.currentTrack) {
            setTimeout(() => {
                triggerAIFeedback('track_start', { track: state.currentTrack });
            }, 1000);
        }

        // console.log('[MusicPlayer] 一起听会话开始');

        // 添加退出按钮（如果不存在）
        const chatHeader = document.querySelector('.music-mini-chat-header');
        if (chatHeader && !chatHeader.querySelector('.listen-exit-btn')) {
            const btn = document.createElement('button');
            btn.className = 'listen-exit-btn';
            btn.innerHTML = '<i data-lucide="x-circle"></i> 退出';
            btn.style.cssText = 'margin-left:auto; background:none; border:none; color:rgba(255,255,255,0.6); cursor:pointer; display:flex; align-items:center; gap:4px; font-size:12px;';
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (confirm('确认退出一起听模式吗？')) {
                    endListenTogether();
                }
            };
            chatHeader.appendChild(btn);
            lucide.createIcons();
        }
    }

    /**
     * 显示正在输入状态
     */
    function showTypingIndicator() {
        hideTypingIndicator(); // Ensure only one exists
        const chatList = document.querySelector('.music-mini-chat-list');
        if (!chatList) return;

        const aiName = window.currentOpenContact?.name || window.currentOpenContact?.ai?.name || 'TA';

        const typingDiv = document.createElement('div');
        typingDiv.id = 'music-typing-indicator-row';
        typingDiv.className = 'music-typing-indicator';
        typingDiv.innerHTML = `
            <span>${aiName} 正在打字</span>
            <div class="music-typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;

        chatList.appendChild(typingDiv);
        chatList.scrollTop = chatList.scrollHeight;
    }

    /**
     * 隐藏正在输入状态
     */
    function hideTypingIndicator() {
        const existing = document.getElementById('music-typing-indicator-row');
        if (existing) existing.remove();
    }

    /**
     * 清理/格式化 AI 回复
     * 1. 将 <think>...</think> 转换为可折叠的详情块
     * 2. 标记 [点歌: xxx] 指令
     * 3. 处理截断或未闭合的 <think> 标签
     */
    function cleanAIResponse(text) {
        if (!text) return '';

        let processedText = text;

        // 预防性处理：如果包含 <think> 但不包含 </think>，手动补全闭合标签，防止正则失效
        if (processedText.includes('<think>') && !processedText.includes('</think>')) {
            processedText += '</think>\n(回复已被截断)';
        }

        // 1. 处理思考过程：转换为折叠详情
        // 使用非贪婪匹配，且兼容包含换行符的情况
        processedText = processedText.replace(/<think>([\s\S]*?)<\/think>/gi, (match, content) => {
            return `<details class="ai-think-process" style="margin-bottom:8px; border-left: 2px solid #666; padding-left: 8px; font-size: 0.85em; opacity: 0.8;">
                <summary style="cursor:pointer; color:#aaa; font-size:0.8em;">思考过程 (点击展开)</summary>
                <div style="margin-top:4px; white-space: pre-wrap; color: #ccc;">${content.trim()}</div>
            </details>`;
        });

        // 2. 处理点歌指令：高亮显示而不是删除（兼容中英文冒号）
        processedText = processedText.replace(/\[点歌[：:]\s*(.*?)\]/g, (match, songName) => {
            return `<span class="ai-command-tag" style="display:inline-block; background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:0.85em; color:#aaffaa; margin:0 4px;">点歌《${songName}》</span>`;
        });

        // 3. 处理切歌指令：高亮显示
        processedText = processedText.replace(/\[切歌[：:]\s*(.*?)\]/g, (match, songName) => {
            return `<span class="ai-command-tag" style="display:inline-block; background:rgba(255,200,100,0.15); padding:2px 6px; border-radius:4px; font-size:0.85em; color:#ffcc66; margin:0 4px;">切歌《${songName}》</span>`;
        });

        // 4. 处理分享歌单指令：高亮显示（内容会在别处渲染成歌单卡片）
        processedText = processedText.replace(/\[分享歌单[：:]\s*(.*?)\]/g, (match, songs) => {
            const songList = songs.split(/[；;]/).map(s => s.trim()).filter(s => s);
            return `<span class="ai-command-tag" style="display:inline-block; background:rgba(100,200,255,0.15); padding:2px 6px; border-radius:4px; font-size:0.85em; color:#66ccff; margin:0 4px;">分享歌单 (${songList.length}首)</span>`;
        });

        // 5. 【关键】清理掉不应该出现在一起听模式的指令格式（防止指令污染）
        // 移除表情包指令
        processedText = processedText.replace(/表情包[：:]\s*[^\s\n]+/g, '');
        // 移除语音指令
        processedText = processedText.replace(/语音[：:]\s*[^\n]+/g, '');
        // 移除状态/内心独白
        processedText = processedText.replace(/状态[：:]\s*[^\n]+/g, '');
        processedText = processedText.replace(/内心独白[：:]\s*[^\n]+/g, '');
        // 移除动作描写 *xxx*
        processedText = processedText.replace(/\*[^*]+\*/g, '');
        // 移除 (动作) 格式
        processedText = processedText.replace(/[（(][^）)]*[）)]/g, '');
        // 移除反斜杠分割
        processedText = processedText.replace(/\\/g, '');
        // 移除 HTML/文图/朋友圈等指令
        processedText = processedText.replace(/(发送HTML|文图|发朋友圈|评论朋友圈|发送文件|引用回复|发起通话|转账)[：:][^\n]*/g, '');
        // 清理多余空白和换行
        processedText = processedText.replace(/\n{3,}/g, '\n\n').trim();

        return processedText.trim();
    }

    /**
     * 发送聊天消息（调用真实AI API）
     */
    async function sendChatMessage(message) {
        if (!message.trim()) return;

        addChatMessage('user', message);

        const currentContact = window.currentOpenContact;
        if (!currentContact) {
            console.warn('[MusicPlayer] 未找到当前联系人，使用 Fallback');
            fallbackAIResponse(message);
            return;
        }

        try {
            // 从 dbHelper 获取 API 配置
            const settingsData = await window.dbHelper?.loadData('settingsStore', 'apiSettings');
            if (!settingsData?.value?.url) {
                console.warn('[MusicPlayer] 未配置 API URL，使用 Fallback');
                fallbackAIResponse(message);
                return;
            }

            console.log('[MusicPlayer] 正在调用 API...');
            showTypingIndicator(); // 显示正在输入

            const { url, key, model } = settingsData.value;
            let completionsUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            completionsUrl += '/chat/completions';

            // 构建对话历史
            const recentMessages = state.listenTogetherMessages.slice(-10).map(m => {
                const name = m.type === 'ai' ? (currentContact.name || 'AI') : '用户';
                return `${name}: ${m.message}`;
            }).join('\n');

            // 当前歌曲信息
            const currentTrackInfo = state.currentTrack ?
                `当前播放: 《${state.currentTrack.name}》- ${state.currentTrack.artist}` :
                '暂无播放';

            // 获取歌词文本
            let lyricContext = '暂无歌词';
            if (state.lyrics && state.lyrics.length > 0) {
                lyricContext = state.lyrics.map(l => l.text).filter(t => t).join('\n');
            }

            // 获取完整人设信息
            const aiName = currentContact.name || currentContact.ai?.name || 'TA';
            const aiPersona = currentContact.ai?.persona || currentContact.persona || '';

            // 获取用户人设
            const userPersona = currentContact.user?.persona || '';
            const userName = currentContact.user?.name || '用户';

            // 读取世界书（参照井字棋实现）
            let worldBookContent = '';
            if (currentContact.worldBooks && currentContact.worldBooks.length > 0 && window.dbHelper) {
                try {
                    const worldBookEntries = [];
                    for (const bookId of currentContact.worldBooks) {
                        const book = await window.dbHelper.loadData('worldBooksStore', bookId);
                        if (book && book.value && book.value.content) {
                            worldBookEntries.push(book.value.content);
                        }
                    }
                    if (worldBookEntries.length > 0) {
                        worldBookContent = worldBookEntries.join('\n\n');
                    }
                } catch (e) {
                    console.warn('[MusicPlayer] 读取世界书失败:', e);
                }
            }

            // 读取之前的主聊天历史（最近10条）
            let recentChatHistory = '';
            if (currentContact.history && currentContact.history.length > 0) {
                const chatHistory = currentContact.history.slice(-10);
                recentChatHistory = chatHistory.map(msg => {
                    if (msg.sender === 'ai') {
                        return `${aiName}: ${msg.text || ''}`;
                    } else if (msg.sender === 'user') {
                        return `${userName}: ${msg.text || ''}`;
                    }
                    return '';
                }).filter(Boolean).join('\n');
            }

            const systemPrompt = `【🎭 核心身份 - 最高优先级】
你是「${aiName}」，正在和「${userName}」一起听音乐聊天。
⚠️ 你必须完全代入「${aiName}」这个角色身份！
⚠️ 绝对禁止说"我是AI"、"作为AI"、"我只是AI"等破坏沉浸感的话！
⚠️ 如果用户问你是谁，你要说"我是${aiName}啊"，而不是"我是AI"！

【AI 角色设定】
姓名：${aiName}
${aiPersona ? `人设：\n${aiPersona}` : ''}
${worldBookContent ? `\n【世界设定】\n${worldBookContent}` : ''}

【用户设定】
姓名：${userName}
${userPersona ? `人设：\n${userPersona}` : ''}

${recentChatHistory ? `【之前的聊天记录】\n${recentChatHistory}\n` : ''}
【一起听模式规则】
这是"一起听"音乐聊天模式，你需要保持角色身份，但回复要简短自然。

【🚫 禁用格式 - 一起听专用】
以下格式在此模式下完全禁用：
1. ❌ 表情包：xxx - 禁止
2. ❌ 语音：xxx - 禁止  
3. ❌ 发送HTML：xxx - 禁止
4. ❌ 文图：xxx - 禁止
5. ❌ 发朋友圈：xxx - 禁止
6. ❌ 状态：/内心独白： - 禁止
7. ❌ *动作描写* - 禁止
8. ❌ 任何带冒号的特殊指令格式 - 禁止（除了点歌/切歌/分享歌单）
9. ❌ 用反斜杠 \\ 分割句子 - 禁止

你只需要用**纯文本**自然聊天，就像发微信消息一样简单直接。

【重要规则】
1. 保持「${aiName}」的性格特点说话
2. 用符合你们关系的方式称呼「${userName}」
3. 口语化，自然简短，1-3句话
4. 不要复读歌词，要有互动感
5. 绝对不要说自己是AI！

【当前会话】
${currentTrackInfo}
播放列表: ${state.playlist.map(t => t.name).join(', ') || '空'}

【当前歌曲歌词】
${lyricContext}

【一起听对话历史】
${recentMessages}

【✅ 唯一允许的3个指令】
1. 点歌 → [点歌: 歌曲名] 
2. 切歌 → [切歌: 歌曲名]
3. 分享歌单 → [分享歌单: 歌曲1；歌曲2；歌曲3]

记住：你是「${aiName}」，正在和「${userName}」一起听歌！保持角色身份！`;

            const response = await fetch(completionsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: message }
                    ],
                    temperature: 0.9,
                    max_tokens: 50000
                })
            });

            hideTypingIndicator(); // 隐藏正在输入

            if (!response.ok) {
                throw new Error(`API 请求失败: ${response.status}`);
            }

            const result = await response.json();
            let aiMessage = result.choices?.[0]?.message?.content?.trim();



            if (aiMessage) {
                // 1. 检查并提取点歌指令（兼容中英文冒号）
                const recommendMatch = aiMessage.match(/\[点歌[：:]\s*(.*?)\]/);
                let songToRecommend = null;

                if (recommendMatch) {
                    songToRecommend = recommendMatch[1];
                }

                // 2. 检查并提取切歌指令（立即播放）
                const switchMatch = aiMessage.match(/\[切歌[：:]\s*(.*?)\]/);
                let songToSwitch = null;

                if (switchMatch) {
                    songToSwitch = switchMatch[1];
                }

                // 3. 检查并提取分享歌单指令
                const sharePlaylistMatch = aiMessage.match(/\[分享歌单[：:]\s*(.*?)\]/);
                let sharedSongs = [];

                if (sharePlaylistMatch) {
                    sharedSongs = sharePlaylistMatch[1].split(/[；;]/).map(s => s.trim()).filter(s => s);
                }

                // 4. 格式化消息（处理思维链和指令显示）
                const displayMessage = cleanAIResponse(aiMessage);

                // 5. 显示回复
                if (displayMessage) {
                    addChatMessage('ai', displayMessage);
                }

                // 6. 执行切歌逻辑（优先级最高，立即播放）
                if (songToSwitch) {
                    searchAndSwitchSong(songToSwitch);
                }
                // 7. 执行点歌逻辑（添加到歌单末尾）
                else if (songToRecommend) {
                    searchAndAddSong(songToRecommend);
                }

                // 8. 执行分享歌单逻辑（渲染歌单卡片）
                if (sharedSongs.length > 0) {
                    renderSharedPlaylist(sharedSongs);
                }
            } else {
                console.warn('[MusicPlayer] AI 返回内容为空');
            }

        } catch (e) {
            hideTypingIndicator();
            console.error('[MusicPlayer] AI对话调用失败:', e);
            fallbackAIResponse(message);
        }
    }

    /**
     * 搜索并添加歌曲（供AI使用）
     */
    async function searchAndAddSong(keyword, addedBy = 'ai') {
        if (!keyword) return;

        try {
            const aiName = window.currentOpenContact?.name || window.currentOpenContact?.ai?.name || 'TA';
            addChatMessage('system', `${addedBy === 'ai' ? aiName : addedBy} 正在搜索 "${keyword}"...`);

            const songs = await NeteaseMusic.searchSongs(keyword);

            if (songs && songs.length > 0) {
                const song = songs[0];

                // 添加到歌单
                addToPlaylist(song, 'ai');

                // ✅ 恢复成功提示
                addChatMessage('system', `${addedBy === 'ai' ? aiName : addedBy} 已添加歌曲 《${song.name}》`);

                // 如果当前没有播放，或者用户只有这一首歌，自动播放
                if (!state.isPlaying && state.playlist.length === 1) {
                    setTimeout(() => MusicPlayer.playAt(0), 1000);
                }
            } else {
                addChatMessage('system', `未找到关于 "${keyword}" 的歌曲`);
            }
        } catch (e) {
            console.error('[MusicPlayer] AI点歌失败:', e);
            addChatMessage('system', '搜索歌曲时出错了');
        }
    }

    /**
     * 搜索并切歌（立即播放，供AI切歌使用）
     */
    async function searchAndSwitchSong(keyword) {
        if (!keyword) return;

        try {
            const aiName = window.currentOpenContact?.name || window.currentOpenContact?.ai?.name || 'TA';
            addChatMessage('system', `${aiName} 正在切歌到 "${keyword}"...`);

            const songs = await NeteaseMusic.searchSongs(keyword);

            if (songs && songs.length > 0) {
                const song = songs[0];

                // 添加到歌单
                addToPlaylist(song, 'ai');

                // 找到这首歌在歌单中的位置
                const songIndex = state.playlist.findIndex(t => t.id === song.id);

                if (songIndex !== -1) {
                    // 立即播放这首歌
                    playAt(songIndex);
                    addChatMessage('system', `已切换到 《${song.name}》`);
                }
            } else {
                addChatMessage('system', `未找到关于 "${keyword}" 的歌曲`);
            }
        } catch (e) {
            console.error('[MusicPlayer] AI切歌失败:', e);
            addChatMessage('system', '切歌时出错了');
        }
    }

    /**
     * 渲染分享的歌单卡片（可滚动，用户可点击添加）
     */
    function renderSharedPlaylist(songNameList) {
        if (!songNameList || songNameList.length === 0) return;

        const chatList = document.querySelector('.music-mini-chat-list');
        if (!chatList) return;

        const aiName = window.currentOpenContact?.name || window.currentOpenContact?.ai?.name || 'TA';

        // 创建歌单卡片容器
        const cardDiv = document.createElement('div');
        cardDiv.className = 'music-shared-playlist-card';
        cardDiv.innerHTML = `
            <div class="shared-playlist-header">
                
                <span class="shared-playlist-title">${aiName} 分享了一份歌单</span>
                <span class="shared-playlist-count">${songNameList.length}首</span>
            </div>
            <div class="shared-playlist-scroll">
                ${songNameList.map((songName, index) => `
                    <div class="shared-playlist-item" data-song-name="${songName.replace(/"/g, '&quot;')}">
                        <span class="shared-playlist-idx">${index + 1}</span>
                        <span class="shared-playlist-name">${songName}</span>
                        <button class="shared-playlist-add-btn" title="添加到播放列表">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="12" y1="5" x2="12" y2="19"></line>
                                <line x1="5" y1="12" x2="19" y2="12"></line>
                            </svg>
                        </button>
                    </div>
                `).join('')}
            </div>
            <button class="shared-playlist-add-all-btn">全部添加到播放列表</button>
        `;

        // 添加样式（如果尚未添加）
        if (!document.getElementById('shared-playlist-styles')) {
            const style = document.createElement('style');
            style.id = 'shared-playlist-styles';
            style.textContent = `
                .music-shared-playlist-card {
                    background: rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    padding: 12px;
                    margin: 8px 0;
                    max-width: 100%;
                }
                .shared-playlist-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 10px;
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.9);
                }
                .shared-playlist-icon {
                    font-size: 16px;
                }
                .shared-playlist-title {
                    flex: 1;
                    font-weight: 500;
                }
                .shared-playlist-count {
                    color: rgba(255, 255, 255, 0.5);
                    font-size: 12px;
                }
                .shared-playlist-scroll {
                    max-height: 180px;
                    overflow-y: auto;
                    margin-bottom: 10px;
                    scrollbar-width: thin;
                    scrollbar-color: rgba(255,255,255,0.2) transparent;
                }
                .shared-playlist-scroll::-webkit-scrollbar {
                    width: 4px;
                }
                .shared-playlist-scroll::-webkit-scrollbar-track {
                    background: transparent;
                }
                .shared-playlist-scroll::-webkit-scrollbar-thumb {
                    background: rgba(255,255,255,0.2);
                    border-radius: 2px;
                }
                .shared-playlist-item {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 8px 6px;
                    border-radius: 8px;
                    transition: background 0.2s;
                }
                .shared-playlist-item:hover {
                    background: rgba(255, 255, 255, 0.05);
                }
                .shared-playlist-item.added {
                    opacity: 0.5;
                }
                .shared-playlist-item.added .shared-playlist-add-btn {
                    color: #4ade80;
                }
                .shared-playlist-idx {
                    font-size: 12px;
                    color: rgba(255, 255, 255, 0.4);
                    width: 20px;
                    text-align: center;
                }
                .shared-playlist-name {
                    flex: 1;
                    font-size: 13px;
                    color: rgba(255, 255, 255, 0.85);
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .shared-playlist-add-btn {
                    background: none;
                    border: none;
                    color: rgba(255, 255, 255, 0.5);
                    cursor: pointer;
                    padding: 4px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: color 0.2s, transform 0.2s;
                }
                .shared-playlist-add-btn:hover {
                    color: #66ccff;
                    transform: scale(1.1);
                }
                .shared-playlist-add-all-btn {
                    width: 100%;
                    padding: 10px;
                    background: rgba(102, 204, 255, 0.15);
                    border: none;
                    border-radius: 8px;
                    color: #66ccff;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: background 0.2s;
                }
                .shared-playlist-add-all-btn:hover {
                    background: rgba(102, 204, 255, 0.25);
                }
                .shared-playlist-add-all-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            `;
            document.head.appendChild(style);
        }

        // 绑定单首添加事件
        cardDiv.querySelectorAll('.shared-playlist-add-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const item = btn.closest('.shared-playlist-item');
                if (item.classList.contains('added')) return;

                const songName = item.dataset.songName;
                item.classList.add('added');
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

                // 搜索并添加歌曲
                await searchAndAddSong(songName, 'ai');
            });
        });

        // 绑定全部添加事件
        const addAllBtn = cardDiv.querySelector('.shared-playlist-add-all-btn');
        addAllBtn.addEventListener('click', async () => {
            addAllBtn.disabled = true;
            addAllBtn.textContent = '正在添加...';

            const items = cardDiv.querySelectorAll('.shared-playlist-item:not(.added)');
            for (const item of items) {
                const songName = item.dataset.songName;
                const btn = item.querySelector('.shared-playlist-add-btn');
                item.classList.add('added');
                btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';

                await searchAndAddSong(songName, 'ai');
                // 添加小延迟避免请求过快
                await new Promise(r => setTimeout(r, 500));
            }

            addAllBtn.textContent = '✓ 已全部添加';
        });

        chatList.appendChild(cardDiv);
        chatList.scrollTop = chatList.scrollHeight;
    }

    function endListenTogether() {
        if (!state.listenTogetherActive) return;

        state.listenTogetherActive = false;

        // 停止沉默检测
        stopSilenceDetection();

        // 生成会话总结
        const summary = generateSessionSummary();

        // 【关键修复】先清空状态，再执行其他操作
        // 这样 togglePlayerScreen 的 setTimeout 检查 state.currentTrack 时会得到 null
        state.currentTrack = null;
        state.isPlaying = false;

        // 彻底停止音频播放
        if (audio) {
            // 先移除事件监听，防止触发 handleTrackEnd 等回调
            audio.pause();
            audio.removeAttribute('src'); // 比设置 src = '' 更彻底
            audio.load(); // 重置音频元素
        }

        // 隐藏浮动胶囊（在 togglePlayerScreen 之前，防止延迟显示）
        if (els.floatingCapsule) {
            els.floatingCapsule.classList.remove('visible');
            els.floatingCapsule.style.display = 'none';
        }

        // 关闭播放器界面
        if (els.playerScreen) {
            els.playerScreen.classList.remove('active');
            els.playerScreen.classList.remove('listen-together-active');
        }

        // 更新播放按钮状态
        updatePlayState(false);

        // 清空聊天记录区域
        state.listenTogetherMessages = [];

        console.log('[MusicPlayer] 一起听会话结束', summary);

        // 返回总结数据
        return summary;
    }

    /**
     * 生成会话总结
     */
    function generateSessionSummary() {
        return {
            duration: 0, // TODO: 实际计算时长
            songsPlayed: state.playlist.length,
            favoriteSong: state.playlist[0]?.name || '无',
            chatHighlights: state.listenTogetherMessages.slice(0, 3)
        };
    }

    /**
     * 添加聊天消息
     */
    function addChatMessage(type, message) {
        state.listenTogetherMessages.push({ type, message, time: Date.now() });

        // 获取角色名字（从当前打开的联系人获取）
        let senderName = '';
        if (type === 'ai') {
            senderName = window.currentOpenContact?.name || window.currentOpenContact?.ai?.name || 'AI';
        } else if (type === 'user') {
            senderName = window.currentOpenContact?.user?.name || '你';
        } else if (type === 'system') {
            senderName = '';
        }

        if (els.miniChatList) {
            // =============== iOS 内存优化：限制聊天历史长度 ===============
            const MAX_CHAT_MESSAGES = 50; // 最多保留50条消息
            if (els.miniChatList.children.length >= MAX_CHAT_MESSAGES) {
                // 移除最旧的消息
                els.miniChatList.removeChild(els.miniChatList.firstChild);
                console.log('[MusicPlayer] 内存优化：移除最旧的聊天消息');
            }
            // =============================================================

            const msgEl = document.createElement('div');
            msgEl.className = 'music-mini-msg';

            if (type === 'system') {
                msgEl.innerHTML = `<div style="opacity:0.5;font-size:12px;">${message}</div>`;
            } else {
                msgEl.innerHTML = `
                    <div class="music-msg-name">${senderName}:</div>
                    <div>${message}</div>
                `;
            }
            els.miniChatList.appendChild(msgEl);
            els.miniChatList.scrollTop = els.miniChatList.scrollHeight;
        }
    }


    /**
     * 构建一起听的音乐上下文（供AI参考）
     */
    function buildMusicContext() {
        return {
            isListeningTogether: true,
            currentTrack: state.currentTrack ? {
                name: state.currentTrack.name,
                artist: state.currentTrack.artist,
                album: state.currentTrack.album
            } : null,
            playlistLength: state.playlist.length,
            isPlaying: state.isPlaying,
            recentMessages: state.listenTogetherMessages.slice(-5).map(m => `${m.type}: ${m.message}`),
            sessionStartTime: state.sessionStartTime
        };
    }

    /**
     * 本地模拟AI回复（当主AI不可用时）
     */
    function fallbackAIResponse(userMessage) {
        const track = state.currentTrack;
        const trackName = track ? track.name : '这首歌';

        // 根据用户消息内容智能匹配回复
        let responses = [];
        const lowerMsg = userMessage.toLowerCase();

        if (lowerMsg.includes('喜欢') || lowerMsg.includes('好听')) {
            responses = [
                `我也觉得《${trackName}》超级好听！`,
                '是的呢，这首歌的旋律很美~',
                '我们的品味真像！'
            ];
        } else if (lowerMsg.includes('换') || lowerMsg.includes('下一首')) {
            responses = [
                '好的，要不我们听听别的？你想听什么风格的？',
                '换一首也行，你来点歌吧！',
                '没问题，你想听什么？'
            ];
        } else if (lowerMsg.includes('歌词') || lowerMsg.includes('意思')) {
            responses = [
                '这首歌的歌词确实很有意境...',
                '每次听都有不同的感受呢',
                '歌词写得真走心'
            ];
        } else if (lowerMsg.includes('心情') || lowerMsg.includes('感觉')) {
            responses = [
                '和你一起听歌让我很开心~',
                '这首歌让我感到很放松',
                '音乐真的能影响心情呢'
            ];
        } else {
            responses = [
                '嗯嗯~',
                '这首歌真的很棒',
                '我也这么觉得！',
                '继续听下去吧~',
                '你说得对呢'
            ];
        }

        setTimeout(() => {
            addChatMessage('ai', responses[Math.floor(Math.random() * responses.length)]);
        }, 800 + Math.random() * 1500);
    }

    /**
     * AI实时反馈系统（歌曲事件触发）
     * 调用真实API获取AI的实时反馈
     */

    // 节流控制：防止频繁触发
    let lastAIFeedbackTime = 0;
    const AI_FEEDBACK_COOLDOWN = 10000; // 10秒冷却时间

    async function triggerAIFeedback(eventType, data = {}) {
        if (!state.listenTogetherActive) return;

        // 节流控制
        const now = Date.now();
        if (now - lastAIFeedbackTime < AI_FEEDBACK_COOLDOWN) {
            console.log('[MusicPlayer] AI反馈冷却中，跳过');
            return;
        }
        lastAIFeedbackTime = now;

        const currentContact = window.currentOpenContact;
        if (!currentContact) {
            triggerFallbackFeedback(eventType, data);
            return;
        }

        // 构建事件提示
        let eventDescription = '';
        switch (eventType) {
            case 'track_start':
                eventDescription = `开始播放新歌曲《${data.track?.name || '未知'}》- ${data.track?.artist || '未知歌手'}`;
                break;
            case 'track_pause':
                eventDescription = `用户暂停了歌曲《${data.track?.name || '未知'}》`;
                break;
            case 'track_resume':
                eventDescription = `用户恢复播放歌曲《${data.track?.name || '未知'}》`;
                break;
            case 'user_skip':
                eventDescription = `用户切歌，跳过了《${data.prevTrack?.name || '未知'}》，开始播放《${data.track?.name || '未知'}》`;
                break;
            case 'long_silence':
                eventDescription = `你们一起听歌已经超过60秒没有说话了，主动找个话题聊聊吧`;
                break;
            default:
                return;
        }

        try {
            // 从 dbHelper 获取 API 配置
            const settingsData = await window.dbHelper?.loadData('settingsStore', 'apiSettings');
            if (!settingsData?.value?.url) {
                triggerFallbackFeedback(eventType, data);
                return;
            }

            // 显示"正在打字"动画
            showTypingIndicator();

            const { url, key, model } = settingsData.value;
            let completionsUrl = url.endsWith('/') ? url.slice(0, -1) : url;
            completionsUrl += '/chat/completions';

            // 获取 AI 人设
            const aiName = currentContact.name || currentContact.ai?.name || 'TA';
            const aiPersona = currentContact.ai?.persona || currentContact.persona || '';

            // 获取用户人设
            const userPersona = currentContact.user?.persona || '';
            const userName = currentContact.user?.name || '用户';

            // 读取世界书
            let worldBookContent = '';
            if (currentContact.worldBooks && currentContact.worldBooks.length > 0 && window.dbHelper) {
                try {
                    const worldBookEntries = [];
                    for (const bookId of currentContact.worldBooks) {
                        const book = await window.dbHelper.loadData('worldBooksStore', bookId);
                        if (book && book.value && book.value.content) {
                            worldBookEntries.push(book.value.content);
                        }
                    }
                    if (worldBookEntries.length > 0) {
                        worldBookContent = worldBookEntries.join('\n\n');
                    }
                } catch (e) {
                    console.warn('[MusicPlayer] 读取世界书失败:', e);
                }
            }

            // 获取歌词
            let lyricContext = '';
            if (state.lyrics && state.lyrics.length > 0) {
                lyricContext = state.lyrics.map(l => l.text).filter(t => t).join('\n');
            }

            // 读取之前的主聊天历史（最近5条）
            let recentChatHistory = '';
            if (currentContact.history && currentContact.history.length > 0) {
                const chatHistory = currentContact.history.slice(-5);
                recentChatHistory = chatHistory.map(msg => {
                    if (msg.sender === 'ai') {
                        return `${aiName}: ${msg.text || ''}`;
                    } else if (msg.sender === 'user') {
                        return `${userName}: ${msg.text || ''}`;
                    }
                    return '';
                }).filter(Boolean).join('\n');
            }

            // 构建一起听对话历史
            const recentMessages = state.listenTogetherMessages.slice(-10).map(m => {
                const name = m.type === 'ai' ? aiName : userName;
                return `${name}: ${m.message}`;
            }).join('\n');

            // 构建当前歌曲信息
            const currentTrackInfo = state.currentTrack ?
                `当前播放: 《${state.currentTrack.name}》- ${state.currentTrack.artist}` :
                '暂无播放';

            // 构建播放列表信息
            const playlistInfo = state.playlist.length > 0 ?
                `播放列表(${state.playlist.length}首): ${state.playlist.map(t => t.name).join(', ')}` :
                '播放列表为空';

            // 构建完整 System Prompt
            const systemPrompt = `【🎭 核心身份】
你是「${aiName}」，正在和「${userName}」一起听音乐。
⚠️ 你必须完全代入「${aiName}」这个角色身份！
⚠️ 绝对禁止说"我是AI"、"作为AI"等破坏沉浸感的话！

【AI 角色设定】
姓名：${aiName}
${aiPersona ? `人设：\n${aiPersona}` : ''}
${worldBookContent ? `\n【世界设定】\n${worldBookContent}` : ''}

【用户设定】
姓名：${userName}
${userPersona ? `人设：\n${userPersona}` : ''}

${recentChatHistory ? `【之前的聊天记录】\n${recentChatHistory}\n` : ''}

【一起听会话信息】
${currentTrackInfo}
${playlistInfo}
播放状态: ${state.isPlaying ? '正在播放' : '暂停中'}
${lyricContext ? `\n【歌词片段】\n${lyricContext}` : ''}

【一起听对话历史】
${recentMessages || '暂无对话'}

【当前事件】
${eventDescription}

【要求】
1. 用符合「${aiName}」角色人设的语气说话
2. 用符合你们关系的方式称呼「${userName}」
3. 回复要简短自然（1-2句话，不超过25个字）
4. 严禁像报幕员一样只说"xx开始了"，要对歌曲、心情或用户行为进行点评
5. 不要用引号，不要动作描写，直接第一人称说话
6. 绝对不要说自己是AI！`;

            const response = await fetch(completionsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `(事件: ${eventDescription}) 请根据当前情况说一句话。` }
                    ],
                    temperature: 0.9,
                    max_tokens: 100
                })
            });

            // 隐藏"正在打字"动画
            hideTypingIndicator();

            if (!response.ok) {
                throw new Error(`API 请求失败: ${response.status}`);
            }

            const result = await response.json();
            let aiMessage = result.choices?.[0]?.message?.content?.trim();

            if (aiMessage) {
                // 清洗消息（移除思维链）
                aiMessage = cleanAIResponse(aiMessage);
                if (aiMessage) {
                    addChatMessage('ai', aiMessage);
                    console.log('[MusicPlayer] AI反馈:', aiMessage);
                }
            }

        } catch (e) {
            console.warn('[MusicPlayer] AI反馈API调用失败:', e);
            hideTypingIndicator();
            triggerFallbackFeedback(eventType, data);
        }
    }

    /**
     * 预设的AI反馈（降级方案）
     */
    function triggerFallbackFeedback(eventType, data) {
        const trackName = data.track?.name || '这首歌';
        let responses = [];
        let isSystemMsg = false;

        switch (eventType) {
            case 'track_start':
                // 改为系统提示，避免AI机械报幕
                addChatMessage('system', `正在播放 《${trackName}》`);
                return;
            case 'track_chorus':
                responses = [
                    '这段副歌太好听了！',
                    '🎵',
                    '这个旋律我超喜欢'
                ];
                break;
            case 'user_skip':
                // 跳过歌曲也可以用系统提示，或者简单的AI反应
                addChatMessage('system', `已跳过 《${trackName}》`);
                return;
            case 'long_silence':
                responses = [
                    '这首歌挺特别的，你觉得呢？',
                    '好好听的旋律~',
                    '你平时喜欢听这种风格的歌吗？'
                ];
                break;
        }

        if (responses.length > 0) {
            setTimeout(() => {
                const randomResponse = responses[Math.floor(Math.random() * responses.length)];
                addChatMessage('ai', randomResponse);
            }, 1000 + Math.random() * 2000);
        }
    }

    /**
     * 通知AI歌单变化
     */
    function notifyAIPlaylistChange(action, track) {
        if (action === 'add') {
            triggerFallbackFeedback('track_start', { track });
        }
    }

    /**
     * 开启长时间沉默检测
     */
    let silenceTimer = null;
    function startSilenceDetection() {
        clearInterval(silenceTimer);
        silenceTimer = setInterval(() => {
            if (!state.listenTogetherActive) return;

            // 检查最后一条消息的时间
            const lastMsg = state.listenTogetherMessages[state.listenTogetherMessages.length - 1];
            if (lastMsg && Date.now() - lastMsg.time > 60000) { // 60秒无消息
                triggerAIFeedback('long_silence', { track: state.currentTrack });
            }
        }, 30000); // 每30秒检查一次
    }

    function stopSilenceDetection() {
        clearInterval(silenceTimer);
        silenceTimer = null;
    }

    // =============== 工具函数 ===============

    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    function debounce(fn, delay) {
        let timer;
        return function (...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    function showToast(message) {
        // 使用全局的toast函数（如果存在）
        if (window.showToast) {
            window.showToast(message);
        } else {
            console.log('[MusicPlayer]', message);
        }
    }

    // =============== 导出 ===============

    return {
        // 初始化
        init,

        // 播放控制
        play,
        togglePlay,
        playPrev,
        playNext,
        playAt,

        // 歌单管理
        addToPlaylist,
        removeFromPlaylist,
        addAndPlay,
        addSongOnly,

        // 界面控制
        togglePlayerScreen,
        toggleSheet,
        minimize,
        toggleLyricView,

        // 一起听
        startListenTogether,
        endListenTogether,
        sendChatMessage,

        // 状态访问
        getState: () => ({ ...state }),
        getCurrentTrack: () => state.currentTrack,
        isPlaying: () => state.isPlaying
    };
})();

// 挂载到全局
window.MusicPlayer = MusicPlayer;

// 页面加载后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保DOM已就绪
    setTimeout(() => MusicPlayer.init(), 100);
});

// =============== iOS 内存优化：页面隐藏时清理资源 ===============
// 监听页面隐藏事件（用户切换到其他APP或标签页）
window.addEventListener('pagehide', () => {
    console.log('[MusicPlayer] 页面隐藏，执行内存清理...');

    try {
        // 获取当前播放列表
        const currentState = MusicPlayer.getState();

        // 释放所有Blob URL（如果有的话）
        if (currentState.playlist && Array.isArray(currentState.playlist)) {
            currentState.playlist.forEach(track => {
                if (track.coverUrl && track.coverUrl.startsWith('blob:')) {
                    URL.revokeObjectURL(track.coverUrl);
                }
            });
        }

        // 清理聊天历史DOM（但保留数据）
        const chatList = document.querySelector('.music-mini-chat-list');
        if (chatList && chatList.children.length > 10) {
            // 保留最近10条消息，删除其他的
            while (chatList.children.length > 10) {
                chatList.removeChild(chatList.firstChild);
            }
            console.log('[MusicPlayer] 已清理聊天历史DOM');
        }

        console.log('[MusicPlayer] 内存清理完成');
    } catch (e) {
        console.error('[MusicPlayer] 内存清理失败:', e);
    }
});

// 也监听visibilitychange事件（更通用）
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        console.log('[MusicPlayer] 页面进入后台，建议系统回收内存');
        // 触发垃圾回收的提示（仅在支持的浏览器中）
        if (window.gc && typeof window.gc === 'function') {
            try {
                window.gc();
                console.log('[MusicPlayer] 已请求垃圾回收');
            } catch (e) {
                // 忽略错误
            }
        }
    }
});
// =================================================================

