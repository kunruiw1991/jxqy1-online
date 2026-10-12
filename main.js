(function () {
  'use strict';

  var DATA_VERSION = 'jxqy1-web-v1.0';
  var IDB_NAME = 'jxqy1_cache_db';
  var IDB_VERSION = 1;

  var FONTS = {
    chs: { code: 'chs', byte: 0, badge: '🇨🇳 简体中文 (GB2312)' },
    cht: { code: 'cht', byte: 1, badge: '🇭🇰 繁體中文 (BIG5)' }
  };
  var BOOTS = {
    fast: { code: 'fast', label: '快速主菜单' },
    intro: { code: 'intro', label: '完整片头动画' }
  };

  var currentFont = localStorage.getItem('jxqy1_font');
  if (!FONTS[currentFont]) currentFont = 'chs';
  var currentBoot = localStorage.getItem('jxqy1_boot');
  if (!BOOTS[currentBoot]) currentBoot = 'fast';

  var statusTextEl = document.getElementById('statusText');
  var byteStatsEl = document.getElementById('byteStats');
  var progressFillEl = document.getElementById('progressFill');
  var loaderPanelEl = document.getElementById('loaderPanel');
  var setupOverlayEl = document.getElementById('setupOverlay');
  var btnStartEl = document.getElementById('btnStartGame');
  var langBadgeEl = document.getElementById('langBadge');
  var cdBadgeEl = document.getElementById('cdBadge');
  var saveBadgeEl = document.getElementById('saveBadge');
  var btnSyncSaveEl = document.getElementById('btnSyncSave');
  var slotsGridEl = document.getElementById('slotsGrid');
  var trackSelectEl = document.getElementById('trackSelect');
  var canvasEl = document.getElementById('canvas');
  var ctx2d = canvasEl ? canvasEl.getContext('2d') : null;

  var bundleBytes = null;
  var dataReady = false;
  var gameRunning = false;
  var starting = false;
  var ciInstance = null;

  // In-memory map of SAVE0.DAT .. SAVE4.DAT persisted in IndexedDB
  var persistedSaves = {};
  // Live snapshot of all 5 slots (either persisted or factory default from bundle)
  var liveSlotBytes = {};

  var SLOT_NAMES = ['进度一', '进度二', '进度三', '进度四', '进度五'];
  var MAP_NAMES = {
    1: '衡山派大殿',
    2: '衡山派后山',
    3: '临安城',
    4: '襄阳城',
    5: '采石矶',
    6: '武当派',
    7: '少林寺',
    8: '丐帮',
    9: '五毒教',
    10: '天山派',
    11: '金国大营'
  };

  // ---------------------------------------------------------------------------
  // 23-Track CD-Audio Table (from AudioCD.cue, 75 frames/sec, 2352 bytes/sector)
  // ---------------------------------------------------------------------------
  var CD_TRACKS = [
    { track: 1,  sector: 0,      title: 'Track 01 · 剑侠情缘主题曲 (序曲)' },
    { track: 2,  sector: 20907,  title: 'Track 02 · 江湖行 (大地图/城镇)' },
    { track: 3,  sector: 42356,  title: 'Track 03 · 衡山晴云' },
    { track: 4,  sector: 53355,  title: 'Track 04 · 侠骨柔情' },
    { track: 5,  sector: 67443,  title: 'Track 05 · 江南烟雨' },
    { track: 6,  sector: 87133,  title: 'Track 06 · 刀光剑影 (战斗一)' },
    { track: 7,  sector: 97313,  title: 'Track 07 · 十面埋伏 (战斗二)' },
    { track: 8,  sector: 110793, title: 'Track 08 · 决战沙场 (首领战)' },
    { track: 9,  sector: 125233, title: 'Track 09 · 幽谷清风' },
    { track: 10, sector: 140440, title: 'Track 10 · 红颜知己 (张琳心)' },
    { track: 11, sector: 152742, title: 'Track 11 · 塞外风雪' },
    { track: 12, sector: 162230, title: 'Track 12 · 古刹钟声' },
    { track: 13, sector: 174532, title: 'Track 13 · 诡计暗涌' },
    { track: 14, sector: 183621, title: 'Track 14 · 铁血丹心' },
    { track: 15, sector: 202422, title: 'Track 15 · 儿女情长 (杨瑛)' },
    { track: 16, sector: 212324, title: 'Track 16 · 悲歌慷慨' },
    { track: 17, sector: 218964, title: 'Track 17 · 危机四伏' },
    { track: 18, sector: 232954, title: 'Track 18 · 壮志凌云' },
    { track: 19, sector: 254493, title: 'Track 19 · 凯旋欢歌' },
    { track: 20, sector: 261309, title: 'Track 20 · 胜败乃兵家常事 (短曲)' },
    { track: 21, sector: 261959, title: 'Track 21 · 剑侠情缘主界面曲' },
    { track: 22, sector: 276526, title: 'Track 22 · 靖康风云 (开篇序幕)' },
    { track: 23, sector: 277652, title: 'Track 23 · 江湖再见 (结局终曲)' }
  ];

  if (trackSelectEl) {
    CD_TRACKS.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = String(t.track);
      opt.textContent = t.title;
      trackSelectEl.appendChild(opt);
    });
  }

  var cdAudio = new Audio();
  cdAudio.loop = true;
  cdAudio.volume = 0.78;
  var currentCdTrack = 0;
  var manualCdTrack = 0;
  var cdMuted = false;
  var lastCdSectorReadAt = 0;

  function pad2(n) { return ('0' + n).slice(-2); }
  function hhmmss() {
    var d = new Date();
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(pad2).join(':');
  }

  function updateCdBadge() {
    if (!cdBadgeEl) return;
    if (cdMuted) {
      cdBadgeEl.textContent = '🔇 CD 音乐已静音 (点击开启)';
      cdBadgeEl.className = 'cd-badge muted';
      return;
    }
    var active = manualCdTrack || currentCdTrack;
    if (!active) {
      cdBadgeEl.textContent = '🎵 CD 音轨待命';
      cdBadgeEl.className = 'cd-badge';
      return;
    }
    var info = CD_TRACKS[active - 1];
    cdBadgeEl.textContent = '🎵 ' + (info ? info.title : ('Track ' + pad2(active)));
    cdBadgeEl.className = 'cd-badge';
  }

  function playCdTrack(trackNum) {
    if (trackNum < 1 || trackNum > 23) return;
    var targetSrc = 'cd/Track' + pad2(trackNum) + '.ogg';
    if (currentCdTrack !== trackNum || cdAudio.paused) {
      if (currentCdTrack !== trackNum) {
        currentCdTrack = trackNum;
        cdAudio.src = targetSrc;
      }
      if (!cdMuted) {
        cdAudio.play().catch(function () {});
      }
      updateCdBadge();
    }
  }

  if (cdBadgeEl) {
    cdBadgeEl.addEventListener('click', function () {
      cdMuted = !cdMuted;
      cdAudio.muted = cdMuted;
      if (!cdMuted && (manualCdTrack || currentCdTrack)) {
        cdAudio.play().catch(function () {});
      }
      updateCdBadge();
    });
  }

  if (trackSelectEl) {
    trackSelectEl.addEventListener('change', function () {
      var val = parseInt(trackSelectEl.value, 10) || 0;
      manualCdTrack = val;
      if (val > 0) {
        playCdTrack(val);
      } else {
        updateCdBadge();
      }
      if (canvasEl && gameRunning) canvasEl.focus();
    });
  }

  // Hook invoked by wdosbox.js when MSCDEX reads virtual /home/web_user/CD/AudioCD.bin
  window.__onJxqyCdRead = function (position, size) {
    lastCdSectorReadAt = Date.now();
    if (manualCdTrack > 0) return;
    var sector = Math.floor(position / 2352);
    var found = 1;
    for (var i = CD_TRACKS.length - 1; i >= 0; i--) {
      if (sector >= CD_TRACKS[i].sector) {
        found = CD_TRACKS[i].track;
        break;
      }
    }
    playCdTrack(found);
  };

  // Pause automatic CD audio if DOSBox stops reading CD sectors for > 2.5 seconds
  setInterval(function () {
    if (manualCdTrack === 0 && currentCdTrack > 0 && !cdAudio.paused) {
      if (Date.now() - lastCdSectorReadAt > 2500) {
        cdAudio.pause();
      }
    }
  }, 1000);

  // ---------------------------------------------------------------------------
  // WebAudio Unlock on user gesture
  // ---------------------------------------------------------------------------
  var trackedAudioContexts = [];
  var OrigAudioContext = window.AudioContext || window.webkitAudioContext;
  if (OrigAudioContext) {
    var PatchedAudioContext = function (opts) {
      var ctx = opts ? new OrigAudioContext(opts) : new OrigAudioContext();
      trackedAudioContexts.push(ctx);
      return ctx;
    };
    PatchedAudioContext.prototype = OrigAudioContext.prototype;
    window.AudioContext = PatchedAudioContext;
    if (window.webkitAudioContext) window.webkitAudioContext = PatchedAudioContext;
  }

  function unlockAudio() {
    trackedAudioContexts.forEach(function (ctx) {
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
    });
    if (!cdMuted && (manualCdTrack || currentCdTrack) && cdAudio.paused && (manualCdTrack > 0 || Date.now() - lastCdSectorReadAt < 2500)) {
      cdAudio.play().catch(function () {});
    }
  }
  ['pointerdown', 'keydown', 'click', 'touchstart'].forEach(function (ev) {
    window.addEventListener(ev, unlockAudio, { passive: true });
  });

  // ---------------------------------------------------------------------------
  // IndexedDB helpers (bundle cache + SAVE0..4.DAT persistence)
  // ---------------------------------------------------------------------------
  function openIdb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains('bundle')) db.createObjectStore('bundle');
        if (!db.objectStoreNames.contains('saves')) db.createObjectStore('saves');
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { resolve(null); };
    });
  }

  async function idbGet(storeName, key) {
    var db = await openIdb();
    if (!db) return null;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(storeName, 'readonly');
        var req = tx.objectStore(storeName).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { resolve(null); };
      } catch (e) {
        resolve(null);
      }
    });
  }

  async function idbPut(storeName, key, val) {
    var db = await openIdb();
    if (!db) return false;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put(val, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      } catch (e) {
        resolve(false);
      }
    });
  }

  async function idbClearBundle() {
    var db = await openIdb();
    if (!db) return;
    return new Promise(function (resolve) {
      try {
        var tx = db.transaction('bundle', 'readwrite');
        tx.objectStore('bundle').clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { resolve(); };
      } catch (e) {
        resolve();
      }
    });
  }

  async function loadPersistedSavesFromIdb() {
    for (var i = 0; i < 5; i++) {
      var key = 'SAVE' + i + '.DAT';
      var val = await idbGet('saves', key);
      if (val && val.byteLength === 17266) {
        persistedSaves[key] = new Uint8Array(val);
        liveSlotBytes[key] = new Uint8Array(val);
      }
    }
    renderSaveInspector();
  }

  // ---------------------------------------------------------------------------
  // SAVE0.DAT ~ SAVE4.DAT Binary Parser & Inspector UI
  // ---------------------------------------------------------------------------
  var gbkDecoder = null;
  try { gbkDecoder = new TextDecoder('gbk'); } catch (e) {}

  function parseSaveDat(bytes) {
    if (!bytes || bytes.byteLength < 72) return null;
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var mapId = dv.getUint16(0, true);
    var nameEnd = 4;
    while (nameEnd < 16 && bytes[nameEnd] !== 0) nameEnd++;
    var name = '独孤剑';
    if (gbkDecoder && nameEnd > 4) {
      try { name = gbkDecoder.decode(bytes.subarray(4, nameEnd)); } catch (e) {}
    }
    var x = dv.getUint16(16, true);
    var y = dv.getUint16(18, true);
    var hp = dv.getUint16(20, true);
    var sta = dv.getUint16(22, true);
    var maxHp = dv.getUint16(24, true);
    var mp = dv.getUint16(28, true);
    var maxMp = dv.getUint16(30, true);
    var silver = dv.getUint16(36, true);
    var level = dv.getUint16(38, true);
    var atk = dv.getUint16(44, true);
    var def = dv.getUint16(46, true);
    return {
      mapId: mapId,
      mapName: MAP_NAMES[mapId] || ('地图 #' + mapId),
      name: name,
      x: x,
      y: y,
      hp: hp,
      maxHp: maxHp,
      mp: mp,
      maxMp: maxMp,
      sta: sta,
      silver: silver,
      level: level,
      atk: atk,
      def: def
    };
  }

  function renderSaveInspector() {
    if (!slotsGridEl) return;
    var html = '';
    for (var i = 0; i < 5; i++) {
      var key = 'SAVE' + i + '.DAT';
      var isPersisted = !!persistedSaves[key];
      var bytes = persistedSaves[key] || liveSlotBytes[key];
      var info = parseSaveDat(bytes);
      html += '<div class="slot-card' + (isPersisted ? ' persisted' : '') + '">';
      html += '<div class="slot-card-top"><span>' + SLOT_NAMES[i] + '</span><span class="tag">' + (isPersisted ? '✓ 浏览器已存' : '初始存档') + '</span></div>';
      if (info) {
        html += '<div class="slot-stats">' +
          info.name + ' Lv.' + info.level + ' · ' + info.mapName + '<br>' +
          '命 ' + info.hp + '/' + info.maxHp + ' · 内 ' + info.mp + '/' + info.maxMp + '<br>' +
          '攻 ' + info.atk + ' · 防 ' + info.def + ' · 银 ' + info.silver +
          '</div>';
      } else {
        html += '<div class="slot-stats">等待载入后读取状态…</div>';
      }
      html += '</div>';
    }
    slotsGridEl.innerHTML = html;
  }

  // ---------------------------------------------------------------------------
  // Chunk Loader & Progress Bar
  // ---------------------------------------------------------------------------
  function setStatus(msg) {
    if (statusTextEl) statusTextEl.textContent = msg;
  }

  function setProgress(pct, statsText) {
    if (progressFillEl) progressFillEl.style.width = Math.max(2, Math.min(100, pct)).toFixed(1) + '%';
    if (statsText && byteStatsEl) byteStatsEl.textContent = statsText;
    if (!dataReady && btnStartEl) btnStartEl.textContent = '⏳ 正在加载 (' + Math.round(Math.max(0, Math.min(100, pct))) + '%)…';
  }

  async function sha256Hex(bytes) {
    if (!(window.crypto && crypto.subtle && crypto.subtle.digest)) return null;
    var digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.prototype.map.call(new Uint8Array(digest), function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  async function loadOrDownloadBundle() {
    await loadPersistedSavesFromIdb();

    setStatus('正在检查浏览器 IndexedDB 缓存...');
    var cached = await idbGet('bundle', DATA_VERSION);
    if (cached && cached.byteLength > 10000000) {
      bundleBytes = new Uint8Array(cached);
      for (var i = 0; i < 8; i++) {
        var chip = document.getElementById('chip-' + i);
        if (chip) {
          chip.className = 'chunk-chip done';
          chip.textContent = 'Part 0' + i + ' ✓';
        }
      }
      setProgress(100, '已从 IndexedDB 缓存秒加载 (0 MB 网络流量)');
      await inspectDefaultSavesFromBundle(bundleBytes);
      markDataReady();
      return;
    }

    setStatus('正在获取分片清单 chunks/manifest.json...');
    var manResp = await fetch('chunks/manifest.json', { cache: 'no-cache' });
    if (!manResp.ok) throw new Error('无法加载 chunks/manifest.json (' + manResp.status + ')');
    var manifest = await manResp.json();
    var totalBytes = manifest.total_size;
    var chunkBytesLoaded = new Array(manifest.chunks.length).fill(0);
    var bust = '?v=' + encodeURIComponent(manifest.version || DATA_VERSION);

    function updateOverallProgress() {
      var loaded = chunkBytesLoaded.reduce(function (a, b) { return a + b; }, 0);
      var pct = (loaded / totalBytes) * 92;
      var mbLoaded = (loaded / 1048576).toFixed(2);
      var mbTotal = (totalBytes / 1048576).toFixed(2);
      setProgress(pct, mbLoaded + ' / ' + mbTotal + ' MB (' + manifest.chunks.length + ' 分片)');
    }

    setStatus('正在并行流式下载 ' + manifest.chunks.length + ' 个游戏数据分片...');

    async function fetchChunkBytes(chunkMeta, fetchOpts) {
      var idx = chunkMeta.index;
      var resp = await fetch(chunkMeta.file + bust, fetchOpts);
      if (!resp.ok) throw new Error('分片下载失败: ' + chunkMeta.file);
      if (resp.body && resp.body.getReader) {
        var reader = resp.body.getReader();
        var parts = [];
        var received = 0;
        while (true) {
          var step = await reader.read();
          if (step.done) break;
          parts.push(step.value);
          received += step.value.byteLength;
          chunkBytesLoaded[idx] = received;
          updateOverallProgress();
        }
        var out = new Uint8Array(received);
        var pos = 0;
        for (var i = 0; i < parts.length; i++) {
          out.set(parts[i], pos);
          pos += parts[i].byteLength;
        }
        return out;
      }
      var ab = await resp.arrayBuffer();
      chunkBytesLoaded[idx] = ab.byteLength;
      updateOverallProgress();
      return new Uint8Array(ab);
    }

    var chunkBuffers = await Promise.all(manifest.chunks.map(async function (chunkMeta) {
      var idx = chunkMeta.index;
      var chip = document.getElementById('chip-' + idx);
      if (chip) {
        chip.className = 'chunk-chip loading';
        chip.textContent = 'Part 0' + idx + ' ⬇';
      }
      var bytes = await fetchChunkBytes(chunkMeta, undefined);
      if (chunkMeta.sha256) {
        var digest = await sha256Hex(bytes);
        if (digest !== null && (digest !== chunkMeta.sha256 || bytes.byteLength !== chunkMeta.size)) {
          bytes = await fetchChunkBytes(chunkMeta, { cache: 'reload' });
          digest = await sha256Hex(bytes);
          if (digest !== null && digest !== chunkMeta.sha256) {
            throw new Error('SHA-256 校验失败: ' + chunkMeta.file);
          }
        }
      }
      if (chip) {
        chip.className = 'chunk-chip done';
        chip.textContent = 'Part 0' + idx + ' ✓';
      }
      return bytes;
    }));

    setStatus('正在合并分片并写入浏览器 IndexedDB 缓存...');
    var merged = new Uint8Array(totalBytes);
    var offset = 0;
    for (var j = 0; j < chunkBuffers.length; j++) {
      merged.set(chunkBuffers[j], offset);
      offset += chunkBuffers[j].byteLength;
    }

    bundleBytes = merged;
    await idbPut('bundle', DATA_VERSION, merged);
    await inspectDefaultSavesFromBundle(merged);
    setProgress(100, '准备就绪 · 已缓存至 IndexedDB (14.40 MB)');
    markDataReady();
  }

  async function inspectDefaultSavesFromBundle(zipBytes) {
    try {
      if (typeof JSZip === 'undefined') return;
      var z = await JSZip.loadAsync(zipBytes);
      for (var i = 0; i < 5; i++) {
        var key = 'SAVE' + i + '.DAT';
        if (!liveSlotBytes[key] && z.files[key]) {
          liveSlotBytes[key] = await z.files[key].async('uint8array');
        }
      }
      renderSaveInspector();
    } catch (e) {}
  }

  function markDataReady() {
    dataReady = true;
    if (btnStartEl) {
      btnStartEl.disabled = false;
      btnStartEl.textContent = '▶ 开始游戏 (Start Game)';
      btnStartEl.focus();
    }
    setStatus('数据准备就绪 — 请选择字库与启动模式后点击「▶ 开始游戏」');
  }

  // ---------------------------------------------------------------------------
  // Pre-Launch Setup Screen Controls
  // ---------------------------------------------------------------------------
  function selectFont(font) {
    if (!FONTS[font] || gameRunning) return;
    currentFont = font;
    localStorage.setItem('jxqy1_font', font);
    document.querySelectorAll('.lang-opt').forEach(function (b) {
      var on = b.getAttribute('data-font') === font;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    if (langBadgeEl) langBadgeEl.textContent = FONTS[font].badge;
  }

  function selectBoot(boot) {
    if (!BOOTS[boot] || gameRunning) return;
    currentBoot = boot;
    localStorage.setItem('jxqy1_boot', boot);
    document.querySelectorAll('.boot-opt').forEach(function (b) {
      var on = b.getAttribute('data-boot') === boot;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  document.querySelectorAll('.lang-opt').forEach(function (b) {
    b.addEventListener('click', function () { selectFont(b.getAttribute('data-font')); });
  });
  document.querySelectorAll('.boot-opt').forEach(function (b) {
    b.addEventListener('click', function () { selectBoot(b.getAttribute('data-boot')); });
  });

  selectFont(currentFont);
  selectBoot(currentBoot);

  var linkRedownload = document.getElementById('linkRedownload');
  if (linkRedownload) {
    linkRedownload.addEventListener('click', async function (e) {
      e.preventDefault();
      if (gameRunning) return;
      if (!confirm('确定重新下载 14.4 MB 游戏数据包吗？（您在浏览器中的游戏存档将完整保留）')) return;
      await idbClearBundle();
      window.location.reload();
    });
  }

  // ---------------------------------------------------------------------------
  // Hook called by wdosbox.js right after bundle 0 is extracted to /home/web_user
  // ---------------------------------------------------------------------------
  window.__onJxqyBundleExtracted = function (Module) {
    try {
      // 1. Write GAME.CFG (SoundBlaster=1, Port=0x220, IRQ=5, DMA=1, Font=0 or 1)
      var fontByte = FONTS[currentFont] ? FONTS[currentFont].byte : 0;
      var cfgBytes = new Uint8Array([1, 0, 0x20, 0x02, 5, 0, 1, 0, fontByte, 0]);
      Module.FS.writeFile('/home/web_user/GAME.CFG', cfgBytes);

      // 2. Customize .jsdos/dosbox.conf [autoexec] for fast menu vs intro video
      if (currentBoot === 'fast') {
        var conf = Module.FS.readFile('/home/web_user/.jsdos/dosbox.conf', { encoding: 'utf8' });
        conf = conf.replace(/\ntitle\r?\n/, '\n');
        Module.FS.writeFile('/home/web_user/.jsdos/dosbox.conf', conf);
      }

      // 3. Shorten the 10-second black-screen delay before New Game's opening narration
      //    (MAIN.EXE overlay offset 199256: 68 b4 00 -> 68 18 00, 180 ticks -> 24 ticks = 1.3s)
      var mainExe = Module.FS.readFile('/home/web_user/MAIN.EXE');
      if (mainExe && mainExe.byteLength === 269503 &&
          mainExe[199256] === 0x68 && mainExe[199257] === 0xb4 && mainExe[199258] === 0x00) {
        var patchedMain = new Uint8Array(mainExe);
        patchedMain[199257] = 0x18;
        Module.FS.writeFile('/home/web_user/MAIN.EXE', patchedMain);
      }

      // 4. Inject persisted user saves (SAVE0.DAT .. SAVE4.DAT) from IndexedDB
      for (var i = 0; i < 5; i++) {
        var key = 'SAVE' + i + '.DAT';
        if (persistedSaves[key] && persistedSaves[key].byteLength === 17266) {
          Module.FS.writeFile('/home/web_user/' + key, persistedSaves[key]);
        }
        try {
          var cur = Module.FS.readFile('/home/web_user/' + key);
          if (cur && cur.byteLength === 17266) liveSlotBytes[key] = new Uint8Array(cur);
        } catch (e) {}
      }
      renderSaveInspector();
    } catch (err) {
      console.error('Error in __onJxqyBundleExtracted:', err);
    }
  };

  // Hook called by wdosbox.js whenever Module.FS.close closes SAVE0..4.DAT
  window.__onJxqySaveClosed = function (path, bytes) {
    if (!bytes || bytes.byteLength !== 17266) return;
    var m = /SAVE([0-4])\.DAT$/i.exec(path);
    if (!m) return;
    var slotIdx = parseInt(m[1], 10);
    var key = 'SAVE' + slotIdx + '.DAT';
    var copy = new Uint8Array(bytes);
    persistedSaves[key] = copy;
    liveSlotBytes[key] = copy;
    idbPut('saves', key, copy).then(function () {
      if (saveBadgeEl) {
        saveBadgeEl.className = 'save-badge ok';
        saveBadgeEl.textContent = '✓ 已自动保存 ' + SLOT_NAMES[slotIdx] + ' (' + hhmmss() + ')';
      }
      renderSaveInspector();
    });
  };

  async function syncAllSavesToIdb(manual) {
    var mod = window.__jxqyModule;
    if (!mod || !mod.FS) return;
    var count = 0;
    for (var i = 0; i < 5; i++) {
      var key = 'SAVE' + i + '.DAT';
      try {
        var bytes = mod.FS.readFile('/home/web_user/' + key);
        if (bytes && bytes.byteLength === 17266) {
          var copy = new Uint8Array(bytes);
          liveSlotBytes[key] = copy;
          // Persist if already in persistedSaves or if manual sync requested
          if (manual || persistedSaves[key]) {
            persistedSaves[key] = copy;
            await idbPut('saves', key, copy);
            count++;
          }
        }
      } catch (e) {}
    }
    if (manual && saveBadgeEl) {
      saveBadgeEl.className = 'save-badge ok';
      saveBadgeEl.textContent = '✓ 已手动同步全部 5 个存档槽 (' + hhmmss() + ')';
    }
    renderSaveInspector();
  }

  if (btnSyncSaveEl) {
    btnSyncSaveEl.addEventListener('click', function () {
      syncAllSavesToIdb(true);
      if (canvasEl && gameRunning) canvasEl.focus();
    });
  }

  // ---------------------------------------------------------------------------
  // Boot js-dos 0.73.6 Direct Backend (emulators.dosDirect)
  // ---------------------------------------------------------------------------
  async function startGameFromSetup() {
    if (!dataReady || !bundleBytes || gameRunning || starting) return;
    starting = true;
    unlockAudio();

    if (setupOverlayEl) setupOverlayEl.classList.add('hidden');
    if (langBadgeEl) langBadgeEl.classList.add('locked');
    setStatus('正在启动 DOSBox WebAssembly 虚拟机...');

    try {
      emulators.pathPrefix = './';
      var ci = await emulators.dosboxDirect(bundleBytes);
      ciInstance = ci;
      window.ci = ci;
      gameRunning = true;

      if (btnSyncSaveEl) btnSyncSaveEl.disabled = false;
      setStatus('运行中 (' + FONTS[currentFont].badge + ') — 方向键行走 · Space/Enter 对话 · ESC 系统菜单');
      setTimeout(function () {
        if (loaderPanelEl) loaderPanelEl.style.display = 'none';
      }, 800);

      // Frame rendering handler (supports both RGB 3-byte and XRGB 4-byte frame buffers with alpha forced to 255)
      var frameW = 0, frameH = 0, imgData = null;
      ci.events().onFrameSize(function (w, h) {
        frameW = w;
        frameH = h;
        canvasEl.width = w;
        canvasEl.height = h;
        imgData = ctx2d.createImageData(w, h);
      });

      ci.events().onFrame(function (rgb, rgba) {
        var buf = rgb !== null ? rgb : rgba;
        if (!buf) return;
        var w = frameW || ci.width() || 640;
        var h = frameH || ci.height() || 480;
        if (!imgData || frameW !== w || frameH !== h) {
          frameW = w;
          frameH = h;
          canvasEl.width = w;
          canvasEl.height = h;
          imgData = ctx2d.createImageData(w, h);
        }
        var d = imgData.data;
        var isRgba = (buf.length === d.length);
        var i = 0, r = 0;
        while (r < d.length) {
          d[r++] = buf[i++];
          d[r++] = buf[i++];
          d[r++] = buf[i++];
          d[r++] = 255;
          if (isRgba) i++;
        }
        ctx2d.putImageData(imgData, 0, 0);
      });

      // Enable js-dos WebAudio sound output for SoundBlaster SFX
      if (typeof emulatorsUi !== 'undefined' && emulatorsUi.sound && emulatorsUi.sound.audioNode) {
        emulatorsUi.sound.audioNode(ci);
      } else {
        setupDirectSoundblasterAudio(ci);
      }

      if (canvasEl) canvasEl.focus();
    } catch (err) {
      console.error('Failed to start DOSBox:', err);
      setStatus('启动失败: ' + err.message);
      starting = false;
    }
  }

  // Lightweight WebAudio player for DOSBox SoundBlaster PCM samples (ci.events().onSoundPush)
  function setupDirectSoundblasterAudio(ci) {
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var audioCtx = new AudioCtx();
      var sampleRate = ci.soundFrequency() || 44100;
      var nextTime = 0;
      ci.events().onSoundPush(function (samples) {
        if (!samples || !samples.length || audioCtx.state !== 'running') return;
        var frames = samples.length;
        var buf = audioCtx.createBuffer(1, frames, sampleRate);
        buf.getChannelData(0).set(samples);
        var src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(audioCtx.destination);
        var now = audioCtx.currentTime;
        if (nextTime < now) nextTime = now + 0.02;
        src.start(nextTime);
        nextTime += frames / sampleRate;
      });
    } catch (e) {}
  }

  if (btnStartEl) btnStartEl.addEventListener('click', startGameFromSetup);

  // ---------------------------------------------------------------------------
  // Keyboard, Mouse & Virtual Gamepad Input -> DOSBox KeyCodes
  // ---------------------------------------------------------------------------
  var SPECIAL_KEY_MAP = {
    Enter: 257,
    Escape: 256,
    Backspace: 259,
    Tab: 258,
    ArrowRight: 262,
    ArrowLeft: 263,
    ArrowDown: 264,
    ArrowUp: 265,
    PageUp: 266,
    PageDown: 267,
    Home: 268,
    End: 269,
    Insert: 260,
    Delete: 261,
    F1: 290, F2: 291, F3: 292, F4: 293,
    F5: 294, F6: 295, F7: 296, F8: 297,
    F9: 298, F10: 299, F11: 300, F12: 301,
    ShiftLeft: 340, ShiftRight: 344,
    ControlLeft: 341, ControlRight: 345,
    AltLeft: 342, AltRight: 346
  };

  function mapToDosKeyCode(e) {
    if (SPECIAL_KEY_MAP[e.key]) return SPECIAL_KEY_MAP[e.key];
    if (SPECIAL_KEY_MAP[e.code]) return SPECIAL_KEY_MAP[e.code];
    if (e.key === ' ') return 32;
    if (e.key && e.key.length === 1) {
      var c = e.key.toUpperCase().charCodeAt(0);
      if (c >= 32 && c <= 96) return c;
    }
    if (e.keyCode >= 65 && e.keyCode <= 90) return e.keyCode;
    if (e.keyCode >= 48 && e.keyCode <= 57) return e.keyCode;
    if (e.keyCode === 13) return 257;
    if (e.keyCode === 27) return 256;
    if (e.keyCode === 32) return 32;
    if (e.keyCode === 37) return 263;
    if (e.keyCode === 38) return 265;
    if (e.keyCode === 39) return 262;
    if (e.keyCode === 40) return 264;
    if (e.keyCode >= 112 && e.keyCode <= 123) return 290 + (e.keyCode - 112);
    return 0;
  }

  window.addEventListener('keydown', function (e) {
    if (!gameRunning) {
      if ((e.key === 'Enter' || e.key === ' ') && dataReady && setupOverlayEl && !setupOverlayEl.classList.contains('hidden')) {
        startGameFromSetup();
        e.preventDefault();
      }
      return;
    }
    if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
    var k = mapToDosKeyCode(e);
    if (k && ciInstance) {
      ciInstance.sendKeyEvent(k, true);
      e.preventDefault();
    }
  }, true);

  window.addEventListener('keyup', function (e) {
    if (!gameRunning || !ciInstance) return;
    var k = mapToDosKeyCode(e);
    if (k) {
      ciInstance.sendKeyEvent(k, false);
      e.preventDefault();
    }
  }, true);

  // Mouse support on canvas (normalized [0, 1] coordinates for js-dos sendMouseMotion)
  if (canvasEl) {
    var updateMousePos = function (e) {
      if (!ciInstance || !gameRunning) return;
      var rect = canvasEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      var nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      var ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      ciInstance.sendMouseMotion(nx, ny);
    };
    canvasEl.addEventListener('mousemove', updateMousePos);
    canvasEl.addEventListener('mousedown', function (e) {
      canvasEl.focus();
      unlockAudio();
      if (!ciInstance || !gameRunning) return;
      updateMousePos(e);
      ciInstance.sendMouseButton(e.button === 2 ? 1 : 0, true);
    });
    canvasEl.addEventListener('mouseup', function (e) {
      if (!ciInstance || !gameRunning) return;
      updateMousePos(e);
      ciInstance.sendMouseButton(e.button === 2 ? 1 : 0, false);
    });
  }

  // On-screen virtual buttons
  document.querySelectorAll('.key-btn').forEach(function (btn) {
    var key = btn.getAttribute('data-key');
    var code = parseInt(btn.getAttribute('data-code'), 10);
    var dosKey = mapToDosKeyCode({ key: key, keyCode: code });
    var press = function (e) {
      e.preventDefault();
      unlockAudio();
      btn.classList.add('active');
      if (ciInstance && dosKey) ciInstance.sendKeyEvent(dosKey, true);
    };
    var release = function (e) {
      e.preventDefault();
      btn.classList.remove('active');
      if (ciInstance && dosKey) ciInstance.sendKeyEvent(dosKey, false);
    };
    btn.addEventListener('mousedown', press);
    btn.addEventListener('mouseup', release);
    btn.addEventListener('mouseleave', function () {
      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        if (ciInstance && dosKey) ciInstance.sendKeyEvent(dosKey, false);
      }
    });
    btn.addEventListener('touchstart', press, { passive: false });
    btn.addEventListener('touchend', release, { passive: false });
  });

  // ---------------------------------------------------------------------------
  // Fullscreen (4:3 aspect-contained on #canvasWrap)
  // ---------------------------------------------------------------------------
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }
  function updateFullscreenButton() {
    var b = document.getElementById('btnFullscreen');
    if (b) b.textContent = isFullscreen() ? '✕ 退出全屏' : '⛶ 全屏';
  }
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

  var btnFullscreen = document.getElementById('btnFullscreen');
  if (btnFullscreen) {
    btnFullscreen.addEventListener('click', function () {
      var wrap = document.getElementById('canvasWrap');
      if (!isFullscreen()) {
        if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
        else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
      } else {
        if (document.exitFullscreen) document.exitFullscreen().catch(function () {});
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Save Export (.zip) & Import (.dat / .zip)
  // ---------------------------------------------------------------------------
  var btnExportSave = document.getElementById('btnExportSave');
  if (btnExportSave) {
    btnExportSave.addEventListener('click', async function () {
      await syncAllSavesToIdb(false);
      var zip = new JSZip();
      var count = 0;
      for (var i = 0; i < 5; i++) {
        var key = 'SAVE' + i + '.DAT';
        var bytes = persistedSaves[key] || liveSlotBytes[key];
        if (bytes && bytes.byteLength === 17266) {
          zip.file(key, bytes);
          count++;
        }
      }
      if (count === 0) {
        alert('当前暂无可导出的存档文件。');
        return;
      }
      var blob = await zip.generateAsync({ type: 'blob' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'jxqy1-saves.zip';
      a.click();
    });
  }

  var inputImportSave = document.getElementById('inputImportSave');
  if (inputImportSave) {
    inputImportSave.addEventListener('change', async function () {
      if (!inputImportSave.files || !inputImportSave.files.length) return;
      var imported = [];
      var skipped = [];

      async function handleSaveBytes(name, bytes) {
        var base = name.split('/').pop().toUpperCase();
        if (!bytes || bytes.byteLength !== 17266) {
          skipped.push(base + ' (文件大小 ' + (bytes ? bytes.byteLength : 0) + ' 字节，标准存档需为 17266 字节)');
          return;
        }
        var m = /^SAVE([0-4])\.DAT$/i.exec(base);
        var slotIdx = m ? parseInt(m[1], 10) : -1;
        if (slotIdx < 0 || slotIdx > 4) {
          var ans = prompt('请选择将「' + base + '」导入到哪个存档槽 (1~5 对应 进度一~进度五)：', '1');
          if (!ans) return;
          var n = parseInt(ans, 10);
          if (n >= 1 && n <= 5) slotIdx = n - 1;
        }
        if (slotIdx < 0 || slotIdx > 4) {
          skipped.push(base + ' (未选择有效槽位)');
          return;
        }
        var key = 'SAVE' + slotIdx + '.DAT';
        var copy = new Uint8Array(bytes);
        persistedSaves[key] = copy;
        liveSlotBytes[key] = copy;
        await idbPut('saves', key, copy);
        if (window.__jxqyModule && window.__jxqyModule.FS) {
          try { window.__jxqyModule.FS.writeFile('/home/web_user/' + key, copy); } catch (e) {}
        }
        imported.push(base + ' → ' + SLOT_NAMES[slotIdx] + ' (' + key + ')');
      }

      for (var i = 0; i < inputImportSave.files.length; i++) {
        var f = inputImportSave.files[i];
        if (f.name.toLowerCase().endsWith('.zip')) {
          var z = await JSZip.loadAsync(f);
          var names = Object.keys(z.files);
          for (var k = 0; k < names.length; k++) {
            var zn = names[k];
            if (zn.toLowerCase().endsWith('.dat') && !z.files[zn].dir) {
              await handleSaveBytes(zn, await z.files[zn].async('uint8array'));
            }
          }
        } else if (f.name.toLowerCase().endsWith('.dat')) {
          await handleSaveBytes(f.name, new Uint8Array(await f.arrayBuffer()));
        }
      }
      inputImportSave.value = '';
      renderSaveInspector();
      alert('已成功导入 ' + imported.length + ' 个存档：\n' + (imported.join('\n') || '无') +
        (skipped.length ? '\n\n跳过：\n' + skipped.join('\n') : '') +
        '\n\n现在可在游戏主菜单选择「载入」或在系统菜单选择「读取进度」！');
    });
  }

  // Expose automation/test API
  window.JXQY1 = {
    version: DATA_VERSION,
    start: startGameFromSetup,
    selectFont: selectFont,
    selectBoot: selectBoot,
    syncSaves: function () { return syncAllSavesToIdb(true); },
    state: function () {
      return {
        dataReady: dataReady,
        gameRunning: gameRunning,
        font: currentFont,
        boot: currentBoot,
        cdTrack: currentCdTrack,
        persistedSlots: Object.keys(persistedSaves)
      };
    }
  };

  // Start loading bundle chunks immediately
  loadOrDownloadBundle().catch(function (err) {
    console.error('Failed to load JXQY1 bundle:', err);
    setStatus('加载失败: ' + err.message);
    if (btnStartEl) btnStartEl.textContent = '⚠ ' + err.message;
  });
})();
