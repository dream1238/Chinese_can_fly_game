/* ============================================================================
 * 《中国人能飞》音频管理器模块 — audio.js
 * 版本：v1.0（2026-08-31）
 * ----------------------------------------------------------------------------
 * 【职责】网站内全部声音操作统一由本模块管理（BGM / 音效 / 解锁 / 场景切换），
 *         其他代码不得再直接操作 Audio / AudioContext（见 index.html 迁移计划）。
 *
 * 【规格 0】所有音频集中在一个文件，删繁就简；针对 Windows / macOS / iOS / Android
 *          浏览器的音频限制策略做了调研并针对性兼容（见下方平台策略）。
 * 【规格 1】零依赖、纯原生 JS：只用浏览器自带 AudioContext 与 <audio> 标签，
 *          无第三方库（无版本兼容、无打包配置、无"库没加载成功"的坑）。
 * 【规格 2】unlock()：首次点击/触摸时调用——创建 AudioContext + resume 解锁，
 *          并用静音音频"预热"HTML5 Audio 通道（安卓 WebView 常见必需）。
 * 【规格 3】playBGM(src, volume)：循环播放；播放新 BGM 前必须销毁旧实例，
 *          防止切歌时两段 BGM 叠放成"双声道鬼畜"。
 * 【规格 4】playSFX(src, volume)：短音效，支持缓存——首次加载后复用，
 *          不重复下载；同一元素复用避免安卓多元素并发限制。
 * 【规格 5】onRouteChange(keepBGM)：场景/路由切换时清理正在响的音效，
 *          可选用 keepBGM=true 保留 BGM，避免旧场景声音"串台"。
 * 【规格 6】未解锁时调用 playBGM：不硬播，把 src 暂存，等 unlock() 后自动补播
 *          ——直接解决"已登录 → 关闭网站 → 重新进站 → 没声音"问题。
 * 【规格 7】所有音频操作 try/catch 静默 + Promise reject 不冒泡，
 *          文件 404 / 解码失败 / 被浏览器拦截都不会崩游戏。
 *
 * ----------------------------------------------------------------------------
 * 【浏览器音频限制策略调研】（实现依据）
 *
 * ▎Windows（Chrome / Edge）
 *   - 自动播放策略：无用户交互前，有声 el.play() 被拒（Media Engagement 机制）；
 *     AudioContext 创建后默认 suspended，需 resume()。
 *   - `new Audio(url)` 默认 preload=auto 会下载（桌面行为可靠）。
 *   - 结论：unlock 后一切正常；BGM/SFX 用 <audio> 元素即可。
 *
 * ▎macOS（Safari 17/18+）
 *   - Safari 18 引入"网页音频限制"：未经用户点击，Web Audio（AudioContext）不发声，
 *     且关闭该限制后需用户点击网站才恢复；HTML5 Audio 同样需要交互。
 *   - 结论：unlock()（首次手势）是必经之路；BGM 用 <audio> 元素（兼容更好）。
 *
 * ▎iOS（Safari / WKWebView 如微信）
 *   - AudioContext 创建即 suspended，必须**用户手势栈内** resume() 才生效；
 *     手势外的 resume() 可能被拒。
 *   - HTML5 Audio：非手势的 el.play() 有声播放被拒（**静音播放允许**）；
 *     preload 被忽略——**不显式 el.load() 就完全不下载**（canplaythrough 永不触发）。
 *   - 硬件静音开关会静音所有音频；低电量模式可能影响。
 *   - 结论：unlock 必须挂在 pointerdown/click 上；BGM 元素显式 load()；
 *     被拒的 play 挂起等下次手势重试（pendingBgm 机制）。
 *
 * ▎Android（Chrome / 微信 / UC / 夸克等 WebView）
 *   - Chrome 同桌面策略（交互后正常）。
 *   - **国产 WebView（微信/UC/夸克）已知问题**：
 *     ① AudioContext 可能 state=running 但**无输出**（WebAudio 输出异常）——
 *        实测"解锁✓ / ctx:running / 声音开"却完全无声，即此现象。
 *     ② 多 <audio> 元素**并发播放数量受限**（部分 WebView 仅 1-2 路）。
 *     ③ 后台/切屏后播放被暂停。
 *   - 结论：**音效与 BGM 一律优先走 HTML5 <audio> 元素**（Android 上更可靠），
 *     WebAudio 仅作合成兜底；音效缓存复用单一元素（规避并发限制）；
 *     unlock 时用静音音频预热 HTML5 Audio 通道。
 * ============================================================================ */

(function (global) {
  'use strict';

  /* ---------------- 平台检测 ---------------- */
  var UA = global.navigator ? (global.navigator.userAgent || '') : '';
  var IS_IOS = /iphone|ipad|ipod/i.test(UA);
  var IS_ANDROID = /android/i.test(UA);
  var IS_WKWEBVIEW = /wkw?ebview/i.test(UA);          // iOS WKWebView（微信等）
  var IS_X5 = /x5/i.test(UA) || /qqbrowser/i.test(UA); // 安卓 X5 内核（微信/QQ 浏览器）
  var IS_TOUCH = IS_IOS || IS_ANDROID || !!(global.matchMedia && global.matchMedia('(pointer: coarse)').matches);

  /* 极小静音 WAV（data URI，用于解锁时预热 HTML5 Audio 通道，零网络请求） */
  var SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

  /* ==========================================================================
   * GameAudio 音频管理器
   * ========================================================================== */
  var GameAudio = {
    /* ---- 状态 ---- */
    ctx: null,            // AudioContext（WebAudio，仅合成兜底用）
    master: null,         // 总音量 Gain
    sfxBus: null,         // 音效总线
    bgmBus: null,         // BGM 总线
    unlocked: false,      // 是否已解锁（首次手势后 true）
    muted: false,         // 全局静音（声音开关 OFF）

    bgmEl: null,          // 当前 BGM 的 <audio> 元素（规格 3：唯一实例，切换前销毁）
    bgmSrc: null,         // 当前 BGM src
    bgmVolume: 0.35,      // BGM 默认音量
    pendingBgmSrc: null,  // 未解锁时暂存的 BGM src（规格 6）
    sfxCache: {},         // 音效缓存 { src: <audio> 元素 }（规格 4）
    soundOn: true,        // 声音开关状态
    lastError: '',        // 最近一次静默错误（供诊断调试）
    debugLog: [],         // 诊断日志（上限 20 条）

    /* ---------------- 诊断 ---------------- */
    _diag(msg) {
      this.debugLog.push(msg);
      if (this.debugLog.length > 20) this.debugLog.shift();
      try { if (global.console) console.info('[音频]', msg); } catch (e) {}
    },
    _err(tag, e) {
      this.lastError = tag + ':' + (e && e.message ? e.message : e);
      try { if (global.console) console.warn('[音频]', this.lastError); } catch (err) {}
    },

    /* ---------------- 音量控制 ---------------- */
    setMuted(m) {
      this.muted = !!m;
      if (this.master) { try { this.master.gain.value = m ? 0 : 0.9; } catch (e) {} }
      if (this.bgmEl) { try { this.bgmEl.muted = m; } catch (e) {} }
      for (var k in this.sfxCache) {
        try { this.sfxCache[k].muted = m; } catch (e) {}
      }
    },
    setSoundOn(on) {
      this.soundOn = !!on;
      this.setMuted(!on);
    },

    /* ---------------- WebAudio 兜底合成（规格 7 静默） ---------------- */
    _ensureCtx() {
      if (this.ctx) return;
      try {
        var AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) { this._err('ctx', 'no AudioContext'); return; }
        this.ctx = new AC();
        if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(this.ctx.destination);
        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 1;
        this.sfxBus.connect(this.master);
        this.bgmBus = this.ctx.createGain();
        this.bgmBus.gain.value = 1;
        this.bgmBus.connect(this.master);
      } catch (e) {
        this._err('ctx', e);
      }
    },
    /* 合成音效（仅当真实文件不可用时兜底，Android WebView 可能无输出——已知限制） */
    _synth(freq0, freq1, dur, vol, type) {
      try {
        this._ensureCtx();
        if (!this.ctx || this.ctx.state === 'suspended') return;
        var o = this.ctx.createOscillator();
        var g = this.ctx.createGain();
        var t0 = this.ctx.currentTime;
        o.type = type || 'square';
        o.frequency.setValueAtTime(freq0, t0);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, freq1 || freq0), t0 + dur);
        g.gain.setValueAtTime(vol || 0.4, t0);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
        o.connect(g); g.connect(this.sfxBus);
        o.start(t0); o.stop(t0 + dur + 0.02);
      } catch (e) { this._err('synth', e); }
    },

    /* ---------------- 解锁（规格 2） ---------------- */
    unlock() {
      if (this.unlocked) return;
      this._ensureCtx();
      // iOS/WebView：必须手势内 resume（再补一次，确保状态）
      try {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});
      } catch (e) { this._err('resume', e); }
      this.unlocked = true;
      this._diag('unlocked, ctx=' + (this.ctx ? this.ctx.state : 'none') + ', touch=' + (IS_TOUCH ? '是' : '否'));
      // 静音预热：打通 HTML5 Audio 通道（Android 微信/UC/夸克 WebView 常见必需）
      this._preheat();
      // 规格 6：补播未解锁时暂存的 BGM
      if (this.pendingBgmSrc) {
        var src = this.pendingBgmSrc;
        this.pendingBgmSrc = null;
        this.playBGM(src, this.bgmVolume);
      }
    },
    /* 静音预热：播放一段零音量/静音音频，让浏览器放开 HTML5 Audio 输出通道 */
    _preheat() {
      try {
        var a = new Audio(SILENT_WAV);
        a.volume = 0;
        a.muted = true;
        var p = a.play();
        if (p && p.catch) p.catch(function () {});
        // 预热完成后释放
        setTimeout(function () {
          try { a.pause(); a.src = ''; a.load(); } catch (e) {}
        }, 300);
      } catch (e) { this._err('preheat', e); }
    },

    /* ---------------- BGM（规格 3 + 规格 6） ---------------- */
    /* 播放/切换 BGM：循环播放；切换前销毁旧实例防叠放；未解锁时暂存待 unlock 补播 */
    playBGM(src, volume) {
      if (!src) return;
      if (volume !== undefined) this.bgmVolume = volume;
      if (!this.unlocked) { this.pendingBgmSrc = src; return; }   // 规格 6
      try {
        if (this.bgmEl && this.bgmSrc === src) {
          // 同一首已在播：确保继续（可能被系统暂停）
          if (this.bgmEl.paused) {
            var p1 = this.bgmEl.play();
            if (p1 && p1.catch) p1.catch(function () {});
          }
          return;
        }
        this._destroyBgm();   // 规格 3：销毁旧实例
        var el = new Audio(src);
        el.loop = true;
        el.volume = this.bgmVolume;
        el.muted = this.muted;
        el.preload = 'auto';
        if (IS_TOUCH) { try { el.load(); } catch (e) {} }   // iOS/安卓 WebView：不显式 load 不下载
        var p = el.play();
        if (p && p.catch) p.catch(function () {
          // 被自动播放策略拒绝（非手势时机）→ 挂起，下次手势（unlock/任意点击）补播
          GameAudio.pendingBgmSrc = src;
        });
        this.bgmEl = el;
        this.bgmSrc = src;
        this._diag('bgm: ' + src);
      } catch (e) {
        this._err('bgm', e);
      }
    },
    /* 销毁当前 BGM 实例（切歌/场景离开时调用，防叠放与资源泄漏） */
    _destroyBgm() {
      if (this.bgmEl) {
        try { this.bgmEl.pause(); } catch (e) {}
        try { this.bgmEl.src = ''; this.bgmEl.load(); } catch (e) {}   // 释放资源（安卓 WebView 必需）
      }
      this.bgmEl = null;
      this.bgmSrc = null;
    },
    stopBGM() {
      this._destroyBgm();
    },
    /* 暂停（不销毁，如切后台）；恢复用 playBGM 同源即续播 */
    pauseBGM() {
      if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) {} }
    },

    /* ---------------- 音效（规格 4：缓存复用） ---------------- */
    playSFX(src, volume) {
      if (!src || !this.unlocked) return;
      try {
        var vol = (volume === undefined) ? 0.6 : volume;
        var el = this.sfxCache[src];
        if (!el) {
          el = new Audio(src);
          el.preload = 'auto';
          if (IS_TOUCH) { try { el.load(); } catch (e) {} }
          this.sfxCache[src] = el;   // 缓存复用（规格 4）
        }
        el.volume = vol;
        el.muted = this.muted;
        try { el.currentTime = 0; } catch (e) {}
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      } catch (e) {
        this._err('sfx', e);
      }
    },
    /* 合成兜底音效（真实文件不可用时的降级；无输出不报错） */
    playSynth(freq0, freq1, dur, vol, type) {
      this._synth(freq0, freq1, dur, vol, type);
    },

    /* ---------------- 路由/场景切换（规格 5） ---------------- */
    /* 清理正在响的音效（缓存元素暂停复位）；keepBGM=true 时保留 BGM */
    onRouteChange(keepBGM) {
      for (var k in this.sfxCache) {
        try { this.sfxCache[k].pause(); this.sfxCache[k].currentTime = 0; } catch (e) {}
      }
      if (!keepBGM) this._destroyBgm();
      this._diag('route change, keepBGM=' + !!keepBGM);
    },

    /* ---------------- 诊断快照（供页面调试显示） ---------------- */
    diag() {
      return {
        unlocked: this.unlocked,
        ctxState: this.ctx ? this.ctx.state : 'none',
        soundOn: this.soundOn,
        bgmSrc: this.bgmSrc,
        pendingBgm: this.pendingBgmSrc,
        sfxCount: Object.keys(this.sfxCache).length,
        lastError: this.lastError,
        touch: IS_TOUCH,
        ua: IS_IOS ? 'iOS' : (IS_ANDROID ? 'Android' : 'Desktop') + (IS_WKWEBVIEW ? '/WKWebView' : '') + (IS_X5 ? '/X5' : '')
      };
    }
  };

  /* 导出 */
  global.GameAudio = GameAudio;
})(typeof window !== 'undefined' ? window : this);

/* ============================================================================
 * 【接入指引】（供 index.html 后续迁移，本次不改其他代码）
 * ----------------------------------------------------------------------------
 * 1. <script src="audio.js"></script> 置于游戏脚本之前；
 * 2. 页面级交互（任意 pointerdown/click）调用 GameAudio.unlock()；
 * 3. 原 AudioSys.playBGM(key)  →  GameAudio.playBGM(真实URL, 音量)；
 *    原 AudioSys.play(key)      →  GameAudio.playSFX(真实URL, 音量)；
 * 4. 场景切换处调用 GameAudio.onRouteChange(是否保留BGM)；
 * 5. 声音开关调用 GameAudio.setSoundOn(布尔)；
 * 6. 原合成音效（sfxTone/sfxNoise）由 GameAudio.playSynth 兜底。
 * ============================================================================ */
