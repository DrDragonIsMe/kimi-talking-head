/* 薪灵视频后台 SPA —— 原生 JS + fetch，hash 路由，无构建步骤 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var pollTimer = null;
  var configCache = null;
  var listSearch = '';
  var detailVersionSel = {};
  var compareSel = {};
  var previewReadyJobs = {}; // 收到 SSE preview_ready 的 jobId 集合（低清预览可播放）
  var scriptVersionSel = {}; // 口播稿版本下拉选择（''= 最新版本）
  var lastDetailJobId = null; // 最近打开的任务详情（素材库「应用到当前任务」用）
  // SSE 实时推送：可用时替代轮询；断线回退 3s 轮询并 10s 后重试
  var eventSource = null;
  var sseAvailable = false;
  var sseRetryTimer = null;
  var sseDebounceTimer = null;
  var currentRefresh = null; // 当前页面的数据刷新函数（SSE 事件触发）

  var STATUS_LABELS = {
    draft: '草稿',
    queued: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };

  // 与 scripts/lib/state.sh 的 9 个阶段一致
  var PHASE_LABELS = {
    script: '脚本',
    tts: '配音',
    whisper: '语音识别',
    subtitles: '字幕',
    storyboard: '分镜',
    visuals: '场景画面',
    lipsync: '唇形同步',
    postprocess: '后处理',
    render: '渲染',
  };
  var PHASE_ORDER = ['script', 'tts', 'whisper', 'subtitles', 'storyboard', 'visuals', 'lipsync', 'postprocess', 'render'];

  var PHASE_STATUS_LABELS = {
    pending: '等待',
    running: '进行中',
    completed: '完成',
    failed: '失败',
    skipped: '跳过',
  };

  // ---------- 工具 ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function toast(msg, type) {
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () { el.remove(); }, 4000);
  }

  // 复制到剪贴板：优先 clipboard API，失败回退 execCommand
  function copyText(text, okMsg) {
    function done() { toast(okMsg || '已复制', 'ok'); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        done();
      } catch (_err) {
        toast('复制失败，请手动复制', 'error');
      }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  // ---------- 鉴权令牌（WEB_TOKENS 开启时使用；localStorage 持久化） ----------
  var TOKEN_KEY = 'kth_token';

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || '';
  }

  function authHeaders() {
    var t = getToken();
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  // <video>/<audio>/<img>/EventSource 无法带 Authorization header，用查询参数传递
  function withToken(url) {
    var t = getToken();
    if (!t || !url) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'access_token=' + encodeURIComponent(t);
  }

  // 401 时替换当前视图为令牌输入面板；保存后重走路由自动重试
  function showTokenPrompt() {
    clearPoll();
    app.innerHTML = '<div class="panel"><h2>需要访问令牌</h2>' +
      '<p class="hint">后台已启用 WEB_TOKENS 鉴权，请输入你的访问令牌（Bearer token）。</p>' +
      '<div class="field"><input type="password" id="auth-token" placeholder="粘贴 token"></div>' +
      '<div class="btn-row"><button class="btn btn-primary" id="auth-save">保存并重试</button>' +
      '<button class="btn" id="auth-clear">清除已存令牌</button></div></div>';
    document.getElementById('auth-save').addEventListener('click', function () {
      var t = document.getElementById('auth-token').value.trim();
      if (!t) return toast('请输入令牌', 'error');
      localStorage.setItem(TOKEN_KEY, t);
      route();
    });
    document.getElementById('auth-clear').addEventListener('click', function () {
      localStorage.removeItem(TOKEN_KEY);
      toast('已清除', 'ok');
      route();
    });
    document.getElementById('auth-token').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('auth-save').click();
    });
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign(authHeaders(), options.headers || {});
    if (options.body && typeof options.body === 'object') {
      options.body = JSON.stringify(options.body);
      options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    }
    return fetch(path, options).then(function (res) {
      if (res.status === 401) {
        // 令牌缺失/失效：显示输入面板，挂起当前请求流，等用户保存后 route() 重试
        showTokenPrompt();
        return new Promise(function () {});
      }
      if (res.status === 204) return null;
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) {
          var msg = (data && data.error) || ('请求失败: HTTP ' + res.status);
          var err = new Error(msg);
          err.status = res.status;
          err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  function fmtTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleString('zh-CN', { hour12: false });
  }

  function fmtDuration(job) {
    var start = job.startedAt || job.queuedAt;
    if (!start) return '-';
    var end = job.finishedAt || (job.status === 'running' ? Date.now() : null);
    if (!end) return '进行中';
    var sec = Math.max(0, Math.round((new Date(end) - new Date(start)) / 1000));
    if (sec < 60) return sec + 's';
    return Math.floor(sec / 60) + 'm' + (sec % 60) + 's';
  }

  function isActive(status) {
    return status === 'queued' || status === 'running';
  }

  function fmtSize(bytes) {
    if (bytes == null) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function clearPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // SSE 可用时不轮询；SSE 断线或活跃任务才回退 3s 轮询
  function schedulePoll(fn, active) {
    clearPoll();
    if (active && !sseAvailable) {
      pollTimer = setInterval(fn, 3000);
    }
  }

  // ---------- SSE 实时推送 ----------

  function refreshCurrentView() {
    if (currentRefresh) currentRefresh();
  }

  // SSE 消息 500ms 防抖，避免事件风暴引发连续重拉
  function onSseMessage() {
    if (sseDebounceTimer) return;
    sseDebounceTimer = setTimeout(function () {
      sseDebounceTimer = null;
      refreshCurrentView();
    }, 500);
  }

  function scheduleSseRetry() {
    if (sseRetryTimer) return;
    sseRetryTimer = setTimeout(function () {
      sseRetryTimer = null;
      startSse();
    }, 10000);
  }

  function startSse() {
    if (eventSource) return;
    try {
      eventSource = new EventSource(withToken('/api/v1/events'));
    } catch (_err) {
      eventSource = null;
    }
    if (!eventSource) return scheduleSseRetry();
    eventSource.onopen = function () {
      sseAvailable = true;
    };
    eventSource.onmessage = function () {
      onSseMessage();
    };
    // 渐进式渲染：低清预览就绪事件（named event，onmessage 收不到）
    eventSource.addEventListener('preview_ready', function (e) {
      try {
        var data = JSON.parse(e.data || '{}');
        if (data.jobId) previewReadyJobs[data.jobId] = true;
      } catch (_err) { /* 忽略非 JSON 数据 */ }
      onSseMessage();
    });
    eventSource.onerror = function () {
      sseAvailable = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      scheduleSseRetry();
      // 回退轮询：重渲染当前页面，schedulePoll 接管活跃任务的刷新
      refreshCurrentView();
    };
  }

  function getPath(obj, dotPath) {
    var cur = obj;
    var parts = dotPath.split('.');
    for (var i = 0; i < parts.length; i++) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = cur[parts[i]];
    }
    return cur;
  }

  function setPath(obj, dotPath, value) {
    var parts = dotPath.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function deletePath(obj, dotPath) {
    var parts = dotPath.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur == null || typeof cur !== 'object') return;
      cur = cur[parts[i]];
    }
    if (cur && typeof cur === 'object') delete cur[parts[parts.length - 1]];
  }

  function deepClone(o) {
    return o == null ? o : JSON.parse(JSON.stringify(o));
  }

  // 模板套用时的深合并：extra 覆盖 base，子对象递归合并，数组/标量直接替换
  function mergeOverrides(base, extra) {
    var out = {};
    base = base || {};
    extra = extra || {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(extra).forEach(function (k) {
      if (
        extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) &&
        out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])
      ) {
        out[k] = mergeOverrides(out[k], extra[k]);
      } else {
        out[k] = extra[k];
      }
    });
    return out;
  }

  // 分组参数表单定义（字段写入 job 的 configOverrides 层）
  function fieldGroups(enums) {
    return [
      {
        title: '字幕',
        fields: [
          { path: 'content_overlay.subtitles.dna', label: '字幕 DNA', type: 'select', options: enums.captionDnas },
          { path: 'content_overlay.subtitles.fontSizeLarge', label: '大字号', type: 'number' },
          { path: 'content_overlay.subtitles.fontSizeMedium', label: '中字号', type: 'number' },
          { path: 'content_overlay.subtitles.fontSizeSmall', label: '小字号', type: 'number' },
          { path: 'content_overlay.subtitles.maxCharsPerLine', label: '每行最多字数', type: 'number' },
          { path: 'content_overlay.subtitles.maxLines', label: '最多行数', type: 'number' },
        ],
      },
      {
        title: '布局',
        fields: [
          { path: 'video_layout.aspect', label: '画面比例', type: 'select', options: enums.aspects },
          { path: 'video_layout.hybrid.preset', label: '布局预设', type: 'select', options: enums.hybridPresets },
          { path: 'video_layout.hybrid.chapterCardScale', label: '章节卡缩放', type: 'number', step: '0.1' },
          { path: 'video_layout.hybrid.showProgressBar', label: '显示进度条', type: 'checkbox' },
          { path: 'video_layout.hybrid.showWaveform', label: '显示波形', type: 'checkbox' },
        ],
      },
      {
        title: '风格',
        fields: [
          { path: 'style.bgm', label: '背景音乐路径', type: 'text' },
          { path: 'style.bgm_volume', label: '背景音量', type: 'number', step: '0.01', min: '0', max: '1' },
          { path: 'style.sfx_enabled', label: '音效开关', type: 'checkbox' },
          { path: 'style.sfx_volume', label: '音效音量', type: 'number', step: '0.01', min: '0', max: '1' },
          { path: 'scene_visuals.media_type', label: '场景素材类型', type: 'select', options: enums.mediaTypes },
        ],
      },
      {
        title: '标题',
        fields: [
          { path: 'title_card.title', label: '标题', type: 'text' },
          { path: 'title_card.subtitle', label: '副标题', type: 'text' },
        ],
      },
    ];
  }

  function loadConfig() {
    if (configCache) return Promise.resolve(configCache);
    return api('/api/v1/config').then(function (cfg) {
      configCache = cfg;
      return cfg;
    });
  }

  // ---------- 路由 ----------

  function route() {
    clearPoll();
    var hash = location.hash || '#/';
    if (hash === '#/' || hash === '#') return renderList();
    if (hash === '#/new') {
      currentRefresh = null;
      return renderNew();
    }
    if (hash === '#/assets') return renderAssets();
    if (hash === '#/stats') return renderStats();
    var m = hash.match(/^#\/job\/([0-9a-f-]{36})$/i);
    if (m) return renderDetail(m[1]);
    currentRefresh = null;
    app.innerHTML = '<div class="panel"><p>未知页面，<a href="#/">返回任务列表</a></p></div>';
  }

  window.addEventListener('hashchange', route);

  // ---------- 任务列表 ----------

  function jobRowHtml(j) {
    var phases = j.phases || { completed: 0, total: 9, currentPhase: null };
    var pct = Math.round((phases.completed / phases.total) * 100);
    var phaseText = phases.completed + '/' + phases.total +
      (phases.currentPhase ? ' · ' + (PHASE_LABELS[phases.currentPhase] || phases.currentPhase) : '');
    var queueText = j.queuePosition ? '（队列第 ' + j.queuePosition + ' 位）' : '';
    var versionText = j.latestVersion > 1 ? ' · v' + j.latestVersion : '';
    return '<tr>' +
      '<td><a class="job-name" href="#/job/' + j.jobId + '">' + esc(j.outputName) + '</a>' +
      '<div class="job-meta">' + esc(j.kind === 'rebuild' ? '重渲' : '全量') + versionText + queueText + '</div></td>' +
      '<td><span class="badge ' + esc(j.status) + '">' + esc(STATUS_LABELS[j.status] || j.status) + '</span></td>' +
      '<td><div class="progress-wrap"><div class="progress-bar"><div style="width:' + pct + '%"></div></div>' +
      '<div class="progress-text">' + esc(phaseText) + '</div></div></td>' +
      '<td class="job-meta">' + esc(fmtTime(j.createdAt)) + '</td>' +
      '<td class="job-meta">' + esc(fmtDuration(j)) + '</td>' +
      '<td><div class="btn-row">' +
      '<a class="btn btn-sm" href="#/job/' + j.jobId + '">打开</a>' +
      (isActive(j.status)
        ? '<button class="btn btn-sm" data-action="stop" data-id="' + j.jobId + '">停止</button>'
        : '') +
      '<button class="btn btn-sm btn-danger" data-action="delete" data-id="' + j.jobId + '" data-name="' + esc(j.outputName) + '">删除</button>' +
      '</div></td>' +
      '</tr>';
  }

  function renderList() {
    currentRefresh = renderList;
    app.innerHTML = '<div class="panel"><p class="hint">加载中…</p></div>';
    api('/api/v1/jobs?limit=100').then(function (data) {
      var jobs = data.jobs || [];
      var html = '<div class="panel">' +
        '<div class="btn-row" style="justify-content:space-between;margin-bottom:12px">' +
        '<h2 style="margin:0">任务列表（' + data.total + '）</h2>' +
        '<div class="btn-row">' +
        '<input type="text" id="job-search" class="search-input" placeholder="搜索任务名…" value="' + esc(listSearch) + '">' +
        '<a class="btn btn-primary" href="#/new">新建任务</a>' +
        '</div></div>';

      if (!jobs.length) {
        html += '<p class="hint">还没有任务，点击右上角"新建任务"开始。</p>';
      } else {
        html += '<table class="job-table"><thead><tr>' +
          '<th>任务</th><th>状态</th><th>进度</th><th>创建时间</th><th>耗时</th><th>操作</th>' +
          '</tr></thead><tbody id="job-tbody"></tbody></table>' +
          '<p class="hint" id="job-search-empty" style="display:none">没有匹配「<span id="job-search-q"></span>」的任务。</p>';
      }
      html += '</div>';
      app.innerHTML = html;

      var tbody = document.getElementById('job-tbody');

      function applyFilter() {
        if (!tbody) return;
        var q = listSearch.trim().toLowerCase();
        var filtered = q
          ? jobs.filter(function (j) { return (j.outputName || '').toLowerCase().indexOf(q) !== -1; })
          : jobs;
        tbody.innerHTML = filtered.map(jobRowHtml).join('');
        var emptyHint = document.getElementById('job-search-empty');
        if (emptyHint) {
          emptyHint.style.display = filtered.length ? 'none' : '';
          var qSpan = document.getElementById('job-search-q');
          if (qSpan) qSpan.textContent = listSearch.trim();
        }
        bindRowButtons();
      }

      function bindRowButtons() {
        app.querySelectorAll('button[data-action]').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-id');
            if (btn.getAttribute('data-action') === 'stop') {
              api('/api/v1/jobs/' + id + '/stop', { method: 'POST' })
                .then(function () { toast('已停止', 'ok'); renderList(); })
                .catch(function (err) { toast(err.message, 'error'); });
            } else {
              var name = btn.getAttribute('data-name');
              var purge = confirm('确定删除任务「' + name + '」？\n\n点"确定"= 同时删除 temp/ 与 output/ 产物；点"取消"可放弃。');
              if (!purge) return;
              api('/api/v1/jobs/' + id + '?purge=1', { method: 'DELETE' })
                .then(function () { toast('已删除', 'ok'); renderList(); })
                .catch(function (err) { toast(err.message, 'error'); });
            }
          });
        });
      }

      var searchInput = document.getElementById('job-search');
      if (searchInput) {
        searchInput.addEventListener('input', function () {
          listSearch = searchInput.value;
          applyFilter();
        });
      }

      applyFilter();

      schedulePoll(renderList, jobs.some(function (j) { return isActive(j.status); }));
    }).catch(function (err) {
      app.innerHTML = '<div class="panel"><div class="error-box">' + esc(err.message) + '</div></div>';
    });
  }

  // ---------- 新建任务 ----------

  function renderNew() {
    app.innerHTML =
      '<div class="panel">' +
      '<h2>新建任务</h2>' +
      '<div class="field"><label>任务名（ outputName，可中文，留空自动生成）</label>' +
      '<input type="text" id="new-name" placeholder="例如 ai_agents_workforce"></div>' +
      '<div class="field"><label>文章（粘贴 Markdown / 纯文本，或选择文件）</label>' +
      '<input type="file" id="new-file" accept=".md,.markdown,.txt" style="margin-bottom:8px">' +
      '<label class="checkbox-field" style="margin-bottom:8px"><input type="checkbox" id="new-batch"> 批量模式（多篇文章用单独一行 --- 分隔）</label>' +
      '<textarea id="new-article" rows="14" placeholder="# 文章标题&#10;&#10;正文…"></textarea>' +
      '<p class="hint" id="batch-hint" style="display:none;margin-top:6px">批量模式：按 --- 分隔逐篇创建草稿；任务名按「名称_1、名称_2」自动编号，留空则自动生成。</p></div>' +
      '<div class="field"><label>主播（可选，留空使用默认主播）</label>' +
      '<select id="new-host" class="tpl-select" style="max-width:none"><option value="">默认主播（host_profile.json）</option></select></div>' +
      '<div class="field"><label>高级配置（可选，JSON overrides，例如 {"content_overlay":{"subtitles":{"dna":"loud"}}}）' +
      '<span class="hint" id="new-config-hint" style="display:none;margin-left:8px">已加载上次项目配置，可修改</span></label>' +
      '<div class="btn-row" style="margin-bottom:6px">' +
      '<select id="new-tpl" class="tpl-select"><option value="">套用模板…</option></select>' +
      '</div>' +
      '<textarea id="new-config" rows="4" placeholder="留空使用默认配置"></textarea></div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" id="new-create">创建并配置参数</button>' +
      '<a class="btn" href="#/">取消</a>' +
      '</div>' +
      '<p class="hint" style="margin-top:8px">创建后进入详情页调整参数，确认无误再点 Run 执行；参数在每次执行时才合并生效。</p></div>';

    // 预填上次项目的高级配置（每次新建都重新拉取，不走 configCache）+ 模板下拉
    var newTplMap = {};
    Promise.all([
      api('/api/v1/config').catch(function () { return null; }),
      api('/api/v1/templates').catch(function () { return null; }),
      api('/api/v1/assets').catch(function () { return null; }),
    ]).then(function (results) {
      var cfg = results[0];
      var tplData = results[1];
      var assets = results[2];
      var ta = document.getElementById('new-config');
      if (ta && cfg && cfg.lastJobOverrides && !ta.value.trim()) { // 用户已开始输入则不覆盖
        ta.value = JSON.stringify(cfg.lastJobOverrides, null, 2);
        var hint = document.getElementById('new-config-hint');
        if (hint) hint.style.display = '';
      }
      var tplSelect = document.getElementById('new-tpl');
      if (tplSelect && tplData && tplData.templates) {
        tplData.templates.forEach(function (t) {
          newTplMap[t.name] = t.overrides;
          var opt = document.createElement('option');
          opt.value = t.name;
          opt.textContent = t.name;
          tplSelect.appendChild(opt);
        });
      }
      // 主播下拉：GET /api/v1/assets 的 hosts；默认主播（host_profile.json）已在 HTML 里
      var hostSelect = document.getElementById('new-host');
      if (hostSelect && assets && assets.hosts) {
        assets.hosts.forEach(function (h) {
          if (h.path === 'config/host_profile.json') return; // 默认主播，勿重复
          var opt = document.createElement('option');
          opt.value = h.name;
          opt.textContent = h.name;
          hostSelect.appendChild(opt);
        });
      }
    });

    document.getElementById('new-batch').addEventListener('change', function () {
      document.getElementById('batch-hint').style.display = this.checked ? '' : 'none';
    });

    // 模板套用：深合并进当前 JSON（解析失败则直接替换）
    document.getElementById('new-tpl').addEventListener('change', function () {
      var name = this.value;
      if (!name || !newTplMap[name]) return;
      var ta = document.getElementById('new-config');
      var current = {};
      if (ta.value.trim()) {
        try { current = JSON.parse(ta.value); } catch (_err) { current = {}; }
      }
      ta.value = JSON.stringify(mergeOverrides(current, newTplMap[name]), null, 2);
      this.value = '';
      toast('已套用模板「' + name + '」', 'ok');
    });

    document.getElementById('new-file').addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        document.getElementById('new-article').value = reader.result;
        if (!document.getElementById('new-name').value) {
          document.getElementById('new-name').value = file.name.replace(/\.(md|markdown|txt)$/i, '');
        }
      };
      reader.readAsText(file);
    });

    function submit() {
      var name = document.getElementById('new-name').value.trim();
      var article = document.getElementById('new-article').value;
      var configText = document.getElementById('new-config').value.trim();
      var hostSel = document.getElementById('new-host');
      var hostProfile = hostSel && hostSel.value ? hostSel.value : undefined;
      var config = null;
      if (configText) {
        try {
          config = JSON.parse(configText);
        } catch (err) {
          return toast('高级配置 JSON 格式错误: ' + err.message, 'error');
        }
      }

      // 批量模式：按单独一行 --- 分隔，逐篇创建草稿
      if (document.getElementById('new-batch').checked) {
        var parts = article.split(/^---\s*$/m).map(function (s) { return s.trim(); }).filter(Boolean);
        if (!parts.length) return toast('请填写文章内容', 'error');
        var items = parts.map(function (text, i) {
          return {
            outputName: name ? (parts.length > 1 ? name + '_' + (i + 1) : name) : undefined,
            articleText: text,
            config: config || undefined,
            hostProfile: hostProfile,
          };
        });
        return api('/api/v1/jobs/batch', { method: 'POST', body: { items: items, run: false } })
          .then(function (data) {
            var results = data.jobs || [];
            var okCount = results.filter(function (r) { return r.ok; }).length;
            var failCount = results.length - okCount;
            toast(
              '批量创建完成：成功 ' + okCount + ' 个' + (failCount ? '，失败 ' + failCount + ' 个' : ''),
              failCount ? 'error' : 'ok'
            );
            location.hash = '#/';
          })
          .catch(function (err) { toast(err.message, 'error'); });
      }

      if (!article.trim()) return toast('请填写文章内容', 'error');
      // 新建只创建草稿；配置参数在详情页确认后，由用户显式点 Run/重建 执行
      api('/api/v1/jobs', {
        method: 'POST',
        body: { outputName: name || undefined, articleText: article, config: config, hostProfile: hostProfile, run: false },
      }).then(function (job) {
        toast('已创建，请在详情页配置参数后点 Run 执行', 'ok');
        location.hash = '#/job/' + job.jobId;
      }).catch(function (err) { toast(err.message, 'error'); });
    }

    document.getElementById('new-create').addEventListener('click', submit);
  }

  // ---------- 素材库 ----------

  // BGM 应用：深合并 style.bgm 进任务 configOverrides 后跳回详情页
  function applyBgmToJob(jobId, bgmPath) {
    api('/api/v1/jobs/' + jobId)
      .then(function (job) {
        var merged = mergeOverrides(job.configOverrides || {}, { style: { bgm: bgmPath } });
        return api('/api/v1/jobs/' + jobId, { method: 'PATCH', body: { configOverrides: merged } });
      })
      .then(function () {
        toast('已将 BGM 应用到当前任务', 'ok');
        location.hash = '#/job/' + jobId;
      })
      .catch(function (err) { toast(err.message, 'error'); });
  }

  function renderAssets() {
    currentRefresh = null; // 静态目录浏览，不随 SSE 刷新
    app.innerHTML = '<div class="panel"><p class="hint">加载中…</p></div>';
    api('/api/v1/assets').then(function (data) {
      var html = '<div class="panel">' +
        '<div class="btn-row" style="justify-content:space-between;margin-bottom:12px">' +
        '<h2 style="margin:0">素材库</h2>' +
        (lastDetailJobId ? '<a class="btn btn-sm" href="#/job/' + lastDetailJobId + '">← 返回当前任务</a>' : '') +
        '</div>';

      // BGM：内联试听 + 应用到当前任务
      html += '<h3>背景音乐（assets/bgm）</h3>';
      if (!data.bgm || !data.bgm.length) {
        html += '<p class="hint">assets/bgm/ 下还没有音频文件。</p>';
      } else {
        html += '<div class="bgm-list">';
        data.bgm.forEach(function (b) {
          html += '<div class="bgm-row">' +
            '<div class="bgm-name">' + esc(b.name) +
            '<div class="job-meta">' + esc(fmtSize(b.size)) + '</div></div>' +
            '<audio controls preload="none" src="' + withToken(b.url) + '"></audio>' +
            (lastDetailJobId ? '<button class="btn btn-sm" data-bgm="' + esc(b.name) + '">应用到当前任务</button>' : '') +
            '</div>';
        });
        html += '</div>';
        if (!lastDetailJobId) {
          html += '<p class="hint">先打开一个任务详情页再回来，即可把 BGM 应用到该任务。</p>';
        }
      }

      // 场景画面：按 run 分组的缩略图，点击看原图
      html += '<h3 style="margin-top:20px">场景画面（public/scene_visuals）</h3>';
      if (!data.sceneVisuals || !data.sceneVisuals.length) {
        html += '<p class="hint">还没有生成过场景画面。</p>';
      } else {
        data.sceneVisuals.forEach(function (group) {
          html += '<div class="scene-group">' +
            '<div class="scene-group-name">' + esc(group.run) + '</div>' +
            '<div class="scene-grid">';
          group.files.forEach(function (f) {
            var media = f.type === 'video'
              ? '<video preload="metadata" muted src="' + withToken(f.url) + '"></video>'
              : '<img loading="lazy" src="' + withToken(f.url) + '" alt="' + esc(f.name) + '">';
            html += '<a class="scene-cell" href="' + withToken(f.url) + '" target="_blank" title="' + esc(f.name) + '">' +
              media + '</a>';
          });
          html += '</div></div>';
        });
      }

      // 主播 profile：只读展示
      html += '<h3 style="margin-top:20px">主播 Profile</h3>' +
        '<p class="hint">新建任务时可在表单中选择主播。</p>' +
        '<div class="host-list">';
      (data.hosts || []).forEach(function (h) {
        html += '<div class="host-row"><span class="host-name">' + esc(h.name) + '</span>' +
          '<span class="job-meta">' + esc(h.path) + '</span></div>';
      });
      html += '</div></div>';
      app.innerHTML = html;

      app.querySelectorAll('button[data-bgm]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!lastDetailJobId) return;
          applyBgmToJob(lastDetailJobId, 'assets/bgm/' + btn.getAttribute('data-bgm'));
        });
      });
    }).catch(function (err) {
      app.innerHTML = '<div class="panel"><div class="error-box">' + esc(err.message) + '</div></div>';
    });
  }

  // ---------- 数据看板 ----------

  function statCard(label, value) {
    return '<div class="stat-card"><div class="stat-card-value">' + esc(value == null ? '-' : value) + '</div>' +
      '<div class="stat-card-label">' + esc(label) + '</div></div>';
  }

  function renderStats() {
    currentRefresh = null;
    app.innerHTML = '<div class="panel"><p class="hint">加载中…</p></div>';
    api('/api/v1/stats').then(function (data) {
      var t = data.totals || {};
      var html = '<div class="panel"><h2>数据看板</h2>' +
        '<div class="stat-cards">' +
        statCard('任务数', t.jobs) +
        statCard('版本数', t.versions) +
        statCard('已完成', t.completed) +
        statCard('失败', t.failed) +
        statCard('已取消', t.cancelled) +
        statCard('成功率', Math.round((t.successRate || 0) * 100) + '%') +
        '</div>';

      // 平均耗时
      var avg = data.avgDurationByKind || {};
      html += '<h3>平均耗时</h3><div class="stat-cards">' +
        statCard('全量', avg.full != null ? fmtSecs(avg.full) : '暂无样本') +
        statCard('Rebuild', avg.rebuild != null ? fmtSecs(avg.rebuild) : '暂无样本') +
        '</div>';

      // 近 14 天完成/失败（纯 CSS 条形）
      html += '<h3>近 14 天产出</h3>';
      var perDay = data.perDay || [];
      var maxCount = perDay.reduce(function (m, d) { return Math.max(m, d.completed + d.failed); }, 0);
      if (!maxCount) {
        html += '<p class="hint">近 14 天没有完成或失败的版本。</p>';
      } else {
        html += '<div class="stat-bars">';
        perDay.forEach(function (d) {
          var okW = d.completed ? Math.max(2, Math.round((d.completed / maxCount) * 100)) : 0;
          var failW = d.failed ? Math.max(2, Math.round((d.failed / maxCount) * 100)) : 0;
          html += '<div class="stat-bar-row">' +
            '<span class="stat-bar-date">' + esc(d.date.slice(5)) + '</span>' +
            '<div class="stat-bar-track">' +
            (okW ? '<div class="stat-bar ok" style="width:' + okW + '%"></div>' : '') +
            (failW ? '<div class="stat-bar fail" style="width:' + failW + '%"></div>' : '') +
            '</div>' +
            '<span class="stat-bar-count">' + d.completed + ' / ' + d.failed + '</span>' +
            '</div>';
        });
        html += '</div><p class="hint">绿=已完成，红=失败；数字为 完成 / 失败。</p>';
      }

      // 失败阶段分布
      html += '<h3>失败阶段分布</h3>';
      var fbp = data.failureByPhase || [];
      if (!fbp.length) {
        html += '<p class="hint">没有记录到阶段失败。</p>';
      } else {
        var maxPhase = fbp[0].count;
        html += '<div class="stat-bars">';
        fbp.forEach(function (f) {
          html += '<div class="stat-bar-row">' +
            '<span class="stat-bar-date">' + esc(PHASE_LABELS[f.phase] || f.phase) + '</span>' +
            '<div class="stat-bar-track"><div class="stat-bar fail" style="width:' + Math.max(2, Math.round((f.count / maxPhase) * 100)) + '%"></div></div>' +
            '<span class="stat-bar-count">' + f.count + '</span>' +
            '</div>';
        });
        html += '</div>';
      }
      html += '</div>';
      app.innerHTML = html;
    }).catch(function (err) {
      app.innerHTML = '<div class="panel"><div class="error-box">' + esc(err.message) + '</div></div>';
    });
  }

  // ---------- 任务详情 ----------

  function renderDetail(jobId) {
    currentRefresh = function () { renderDetail(jobId); };
    lastDetailJobId = jobId;
    app.innerHTML = '<div class="panel"><p class="hint">加载中…</p></div>';
    Promise.all([
      api('/api/v1/jobs/' + jobId),
      loadConfig(),
      api('/api/v1/estimates').catch(function () { return null; }),
      api('/api/v1/templates').catch(function () { return null; }),
    ])
      .then(function (results) {
        renderDetailView(jobId, results[0], results[1], results[2], results[3]);
      })
      .catch(function (err) {
        app.innerHTML = '<div class="panel"><div class="error-box">' + esc(err.message) +
          '</div><a href="#/">返回任务列表</a></div>';
      });
  }

  function fmtSecs(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec + '秒';
    return Math.floor(sec / 60) + '分' + (sec % 60) + '秒';
  }

  function fmtEstimate(e) {
    if (!e) return null;
    if (e.avgSeconds < 60) return '预计 <1 分钟（近 ' + e.samples + ' 次平均）';
    return '预计 ~' + Math.round(e.avgSeconds / 60) + ' 分钟（近 ' + e.samples + ' 次平均）';
  }

  // 成本预估：costEstimate = {tokens:{script,storyboard,total}, seconds:{tts,lipSync,render,total}} | null
  function fmtCostEstimate(ce) {
    if (!ce) return null;
    var parts = [];
    var tokens = ce.tokens && ce.tokens.total;
    var secs = ce.seconds && ce.seconds.total;
    if (tokens != null) {
      parts.push('预计 ~' + Math.round(tokens).toLocaleString('en-US') + ' token');
    }
    if (secs != null) {
      parts.push('约 ' + (secs < 90 ? Math.round(secs) + ' 秒' : Math.round(secs / 60) + ' 分钟'));
    }
    return parts.length ? parts.join('，') : null;
  }

  // 版本对比单侧（A/B）：版本下拉 + 版本信息 + 视频
  function compareSideHtml(tag, vRec, completedVersions, selected) {
    var opts = completedVersions.map(function (v) {
      return '<option value="' + v.version + '"' + (v.version === selected ? ' selected' : '') + '>v' + v.version + '</option>';
    }).join('');
    var info = 'v' + vRec.version + ' · ' + (vRec.kind === 'rebuild' ? '重渲' : '全量') +
      ' · ' + (STATUS_LABELS[vRec.status] || vRec.status) +
      (vRec.finishedAt ? ' · ' + fmtTime(vRec.finishedAt) : '');
    return '<div class="compare-side">' +
      '<div class="btn-row" style="margin-bottom:6px">' +
      '<select id="compare-sel-' + tag + '" class="tpl-select">' + opts + '</select>' +
      '<span class="job-meta">' + esc(info) + '</span></div>' +
      '<video id="compare-video-' + tag + '" controls muted preload="metadata" src="' + withToken(vRec.preview.video) + '"></video>' +
      '</div>';
  }

  function renderDetailView(jobId, job, cfg, estimates, templates) {
    var active = isActive(job.status);
    var mediaReady = job.media && job.media.ready;
    var versions = job.versions || [];
    var latestRec = versions.length ? versions[versions.length - 1] : null;

    var html = '';

    // 头部操作条
    var nextVersion = (job.latestVersion || 0) + 1;
    var rerunDisabled = active || !job.configDirty;
    var rerunTitle = active
      ? '任务进行中'
      : (job.configDirty ? '复用未变更的阶段，新建 v' + nextVersion + ' 重跑' : '配置未变更');
    var fullEstText = (estimates && fmtEstimate(estimates.full)) || '全量约 15–30 分钟（含 GPU）';
    var rebuildEstText = (estimates && estimates.rebuild)
      ? 'Rebuild ' + fmtEstimate(estimates.rebuild)
      : 'Rebuild 仅本地渲染，不耗 GPU';
    html += '<div class="panel">' +
      '<div class="btn-row" style="justify-content:space-between">' +
      '<h2 style="margin:0">' + esc(job.outputName) + ' <span class="badge ' + esc(job.status) + '">' +
      esc(STATUS_LABELS[job.status] || job.status) + '</span></h2>' +
      '<a href="#/">← 返回列表</a>' +
      '</div>' +
      '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn btn-primary" id="act-run" ' + (active ? 'disabled title="任务进行中"' : '') + '>Run 全量</button>' +
      '<button class="btn" id="act-rebuild" ' + (active || !mediaReady
        ? 'disabled title="' + (active ? '任务进行中' : '缺少 audio.wav / lip_synced_raw.mp4，需先跑全量') + '"'
        : '') + '>Rebuild 复用媒体</button>' +
      '<button class="btn" id="act-rerun" ' + (rerunDisabled ? 'disabled ' : '') + 'title="' + esc(rerunTitle) + '">重建 v' + nextVersion + '</button>' +
      '<button class="btn" id="act-stop" ' + (active ? '' : 'disabled') + '>Stop</button>' +
      '<button class="btn" id="act-clone">Clone</button>' +
      '<button class="btn btn-danger" id="act-delete">Delete</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">' + esc(fullEstText) + ' · ' + esc(rebuildEstText) +
      (fmtCostEstimate(job.costEstimate) ? ' · ' + esc(fmtCostEstimate(job.costEstimate)) : '') + '</div>';

    // 失败重试：最新版本 failed 时显示（默认断点续跑，可指定阶段 FORCE 重跑）
    if (!active && latestRec && latestRec.status === 'failed') {
      var failedPhase = (job.phasesSummary && job.phasesSummary.currentPhase) || 'render';
      html += '<div class="btn-row" style="margin-top:10px">' +
        '<button class="btn" id="act-retry">重试（断点续跑）</button>' +
        '<select id="retry-phase" class="retry-phase-select">';
      PHASE_ORDER.forEach(function (phase) {
        html += '<option value="' + phase + '"' + (phase === failedPhase ? ' selected' : '') + '>' +
          esc(PHASE_LABELS[phase] || phase) + '（' + phase + '）</option>';
      });
      html += '</select>' +
        '<button class="btn" id="act-retry-phase">指定阶段重跑</button>' +
        '</div>';
    }
    html +=
      '<div id="delete-confirm" style="display:none;margin-top:12px" class="error-box">' +
      '确认删除该任务？ <label class="checkbox-field" style="display:inline-flex">' +
      '<input type="checkbox" id="delete-purge"> 同时删除产物（temp/ 与 output/）</label> ' +
      '<button class="btn btn-sm btn-danger" id="delete-yes">确认删除</button> ' +
      '<button class="btn btn-sm" id="delete-no">取消</button>' +
      '</div>' +
      (job.error ? '<div class="error-box" style="margin-top:12px">' + esc(job.error) + '</div>' : '') +
      '<div class="job-meta" style="margin-top:8px">创建 ' + esc(fmtTime(job.createdAt)) +
      ' · 开始 ' + esc(fmtTime(job.startedAt)) + ' · 结束 ' + esc(fmtTime(job.finishedAt)) +
      ' · 耗时 ' + esc(fmtDuration(job)) +
      (job.hostProfile ? ' · 主播 ' + esc(job.hostProfile) : '') + '</div>' +
      '</div>';

    // 版本选择：默认最新版本；chips 切换预览/下载到 ?version=N
    var selVersion = null;
    if (versions.length) {
      var wanted = detailVersionSel[jobId];
      versions.forEach(function (v) {
        if (v.version === wanted) selVersion = v;
      });
      if (!selVersion) selVersion = versions[versions.length - 1];
      detailVersionSel[jobId] = selVersion.version;
    }

    // 预览
    html += '<div class="panel preview"><h2>预览</h2>';
    if (versions.length) {
      html += '<div class="version-chips">';
      versions.forEach(function (v) {
        var tip = 'v' + v.version + ' · ' + (v.kind === 'rebuild' ? '重渲' : '全量') + ' · ' +
          (STATUS_LABELS[v.status] || v.status) +
          (v.finishedAt ? ' · 结束 ' + fmtTime(v.finishedAt) : (v.queuedAt ? ' · 排队 ' + fmtTime(v.queuedAt) : ''));
        html += '<button class="version-chip' + (selVersion && v.version === selVersion.version ? ' active' : '') +
          '" data-version="' + v.version + '" title="' + esc(tip) + '">v' + v.version + '</button>';
      });
      html += '</div>';
      if (selVersion) {
        html += '<div class="job-meta version-info">v' + selVersion.version +
          ' · ' + esc(selVersion.kind === 'rebuild' ? '重渲' : '全量') +
          ' · <span class="badge ' + esc(selVersion.status) + '">' + esc(STATUS_LABELS[selVersion.status] || selVersion.status) + '</span>' +
          ' · 排队 ' + esc(fmtTime(selVersion.queuedAt)) +
          ' · 开始 ' + esc(fmtTime(selVersion.startedAt)) +
          ' · 结束 ' + esc(fmtTime(selVersion.finishedAt)) + '</div>';
      }
    }
    var previewVideo = selVersion ? selVersion.preview.video : job.preview.video;
    var previewCover = selVersion ? selVersion.preview.cover : job.preview.cover;
    var downloadVideo = selVersion ? selVersion.outputs.video : job.outputs.video;
    var downloadCover = selVersion ? selVersion.outputs.cover : job.outputs.cover;
    var selHasOutput = selVersion ? selVersion.hasOutput : job.hasOutput;
    if (selHasOutput) {
      html += '<div class="preview-col"><div>' +
        '<video controls preload="metadata" poster="' + withToken(previewCover) + '" src="' + withToken(previewVideo) + '"></video>' +
        '<div class="btn-row" style="margin-top:8px">' +
        '<a class="btn btn-sm" href="' + withToken(downloadVideo) + '">下载视频</a>' +
        '<a class="btn btn-sm" href="' + withToken(downloadCover) + '">下载封面</a>' +
        '</div></div>' +
        '<div><img src="' + withToken(previewCover) + '" alt="封面"></div></div>';
    } else if (job.previewReady || previewReadyJobs[jobId]) {
      // 渐进式渲染：低清预览已就绪，成品渲染完成后由上方分支替换
      html += '<p class="hint">低清预览已就绪（成品仍在渲染中，完成后自动替换）：</p>' +
        '<video controls preload="metadata" src="' + withToken('/api/v1/jobs/' + jobId + '/preview') + '"></video>';
    } else if (selVersion) {
      html += '<p class="hint">v' + selVersion.version + ' 产物尚未生成。</p>';
    } else {
      html += '<p class="hint">产物尚未生成' + (mediaReady ? '（媒体已就绪，可 Rebuild）' : '') + '。</p>';
    }
    html += '</div>';

    // 定时任务：设置/查看/删除 cron 表达式，展示 trigger URL 供外部 webhook 调用
    html += '<div class="panel"><h2>定时任务</h2>';
    if (job.schedule) {
      var triggerUrl = location.origin + '/api/v1/trigger/' + encodeURIComponent(job.triggerToken || '');
      html += '<div class="job-meta" style="margin-bottom:8px">cron 表达式：<code>' + esc(job.schedule) + '</code></div>' +
        (job.triggerToken
          ? '<div class="field"><label>Trigger URL（POST 调用即触发一次执行）</label>' +
          '<input type="text" id="schedule-trigger-url" readonly value="' + esc(triggerUrl) + '"></div>' +
          '<div class="btn-row">' +
          '<button class="btn btn-sm" id="schedule-copy">复制 Trigger URL</button>' +
          '<button class="btn btn-sm btn-danger" id="schedule-delete">删除定时任务</button>' +
          '</div>'
          : '<div class="btn-row"><button class="btn btn-sm btn-danger" id="schedule-delete">删除定时任务</button></div>');
    } else {
      html += '<div class="field"><label>cron 表达式（如 <code>0 9 * * *</code> 每天 9 点执行）</label>' +
        '<input type="text" id="schedule-cron" placeholder="分 时 日 月 周" style="max-width:320px"></div>' +
        '<div class="btn-row"><button class="btn btn-sm btn-primary" id="schedule-save" ' + (active ? 'disabled' : '') +
        '>保存定时任务</button></div>';
    }
    html += '</div>';

    // 版本对比：≥2 个已完成版本时可展开；默认对比最近两个
    var completedVersions = versions.filter(function (v) { return v.status === 'completed' && v.hasOutput; });
    if (completedVersions.length >= 2) {
      var cs = compareSel[jobId];
      if (!cs) {
        cs = { open: false, a: null, b: null };
        compareSel[jobId] = cs;
      }
      if (!completedVersions.some(function (v) { return v.version === cs.a; })) {
        cs.a = completedVersions[completedVersions.length - 2].version;
      }
      if (!completedVersions.some(function (v) { return v.version === cs.b; })) {
        cs.b = completedVersions[completedVersions.length - 1].version;
      }
      html += '<div class="panel"><div class="btn-row" style="justify-content:space-between">' +
        '<h2 style="margin:0">版本对比</h2>' +
        '<button class="btn btn-sm" id="compare-toggle">' + (cs.open ? '收起' : '展开') + '</button>' +
        '</div>';
      if (cs.open) {
        var vA = null;
        var vB = null;
        versions.forEach(function (v) {
          if (v.version === cs.a) vA = v;
          if (v.version === cs.b) vB = v;
        });
        if (vA && vB) {
          html += '<div class="compare-grid">' +
            compareSideHtml('a', vA, completedVersions, cs.a) +
            compareSideHtml('b', vB, completedVersions, cs.b) +
            '</div>' +
            '<div class="btn-row" style="margin-top:10px">' +
            '<button class="btn btn-sm" id="compare-play">同步播放/暂停</button>' +
            '<input type="range" id="compare-slider" class="compare-slider" min="0" max="1000" value="0">' +
            '</div>';
        }
      }
      html += '</div>';
    }

    // 阶段步进器（每格显示耗时：completed_at−started_at；running 显示已进行时长）
    html += '<div class="panel"><h2>阶段进度' +
      (job.phasesSummary ? '（' + job.phasesSummary.completed + '/' + job.phasesSummary.total + '）' : '') + '</h2>' +
      '<div class="stepper">';
    PHASE_ORDER.forEach(function (phase) {
      var p = (job.phases && job.phases[phase]) || { status: 'pending' };
      var durText = null;
      if (p.started_at) {
        if (p.completed_at) {
          durText = '耗时 ' + fmtSecs((new Date(p.completed_at) - new Date(p.started_at)) / 1000);
        } else if (p.status === 'running') {
          durText = '已进行 ' + fmtSecs((Date.now() - new Date(p.started_at)) / 1000);
        }
      }
      html += '<div class="step ' + esc(p.status) + '">' +
        '<div class="step-name">' + esc(PHASE_LABELS[phase] || phase) + '</div>' +
        '<div class="step-status">' + esc(PHASE_STATUS_LABELS[p.status] || p.status) + '</div>' +
        (durText ? '<div class="step-time">' + esc(durText) + '</div>' : '') +
        (p.error ? '<div class="step-time" style="color:var(--danger)">' + esc(p.error) + '</div>' : '') +
        '</div>';
    });
    html += '</div></div>';

    // 日志
    html += '<div class="panel"><h2>日志（stdout 尾部）' +
      '<span class="hint">' + (active ? ' 3s 自动刷新' : '') + '</span></h2>' +
      '<div class="log-box" id="log-box">加载中…</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<a class="btn btn-sm" href="' + withToken(job.logs.stdout) + '" target="_blank">完整 stdout</a>' +
      '<a class="btn btn-sm" href="' + withToken(job.logs.stderr) + '" target="_blank">完整 stderr</a>' +
      '</div></div>';

    // 参数表单
    var overrides = deepClone(job.configOverrides) || {};
    var groups = fieldGroups(cfg.enums);
    var templateList = (templates && templates.templates) || [];
    html += '<div class="panel"><div class="btn-row" style="justify-content:space-between">' +
      '<h2 style="margin:0">参数（写入 configOverrides）</h2>' +
      '<label class="checkbox-field"><input type="checkbox" id="raw-toggle"> 高级 JSON 模式</label>' +
      '</div>' +
      '<div class="btn-row" style="margin-bottom:10px">' +
      '<select id="tpl-select" class="tpl-select"><option value="">选择模板…</option>' +
      templateList.map(function (t) { return '<option value="' + esc(t.name) + '">' + esc(t.name) + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn-sm" id="tpl-apply" ' + (active ? 'disabled' : '') + '>套用模板</button>' +
      '<button class="btn btn-sm" id="tpl-save">存为模板</button>' +
      '<button class="btn btn-sm" id="tpl-delete">删除模板</button>' +
      '</div>' +
      (active ? '<p class="hint">任务进行中，参数只读。</p>' : '') +
      '<div id="form-mode">';
    groups.forEach(function (group, gi) {
      html += '<h3>' + esc(group.title) + '</h3><div class="form-grid">';
      group.fields.forEach(function (f, fi) {
        var fieldId = 'f_' + gi + '_' + fi;
        var overrideVal = getPath(overrides, f.path);
        var defaultVal = getPath(cfg.profile, f.path);
        var effective = overrideVal !== undefined ? overrideVal : defaultVal;
        var hasOverride = overrideVal !== undefined;
        html += '<div class="override-row"><div class="field">' +
          '<label>' + esc(f.label) +
          (hasOverride ? '<span class="override-mark">已覆盖</span>' : '') +
          (defaultVal !== undefined && f.type !== 'checkbox' ? ' <span class="hint">默认 ' + esc(JSON.stringify(defaultVal)) + '</span>' : '') +
          '</label>';
        if (f.type === 'select') {
          html += '<select id="' + fieldId + '" data-path="' + esc(f.path) + '" data-type="select" ' + (active ? 'disabled' : '') + '>';
          f.options.forEach(function (opt) {
            html += '<option value="' + esc(opt.id) + '"' + (String(effective) === opt.id ? ' selected' : '') + '>' +
              esc(opt.label) + '（' + esc(opt.id) + '）</option>';
          });
          if (effective !== undefined && !f.options.some(function (o) { return o.id === String(effective); })) {
            html += '<option value="' + esc(effective) + '" selected>' + esc(effective) + '</option>';
          }
          html += '</select>';
        } else if (f.type === 'checkbox') {
          html += '<span class="checkbox-field"><input type="checkbox" id="' + fieldId + '" data-path="' + esc(f.path) +
            '" data-type="checkbox"' + (effective ? ' checked' : '') + (active ? ' disabled' : '') + '></span>';
        } else {
          html += '<input type="' + f.type + '" id="' + fieldId + '" data-path="' + esc(f.path) + '" data-type="' + f.type + '"' +
            (f.step ? ' step="' + f.step + '"' : '') + (f.min ? ' min="' + f.min + '"' : '') + (f.max ? ' max="' + f.max + '"' : '') +
            ' value="' + esc(effective === undefined ? '' : effective) + '"' + (active ? ' disabled' : '') + '>';
        }
        html += '</div>' +
          '<button class="btn btn-sm" data-reset="' + esc(f.path) + '"' + (active || !hasOverride ? ' disabled' : '') +
          ' title="清除该字段的覆盖，恢复默认">恢复默认</button></div>';
      });
      html += '</div>';
    });
    html += '<div class="btn-row" style="margin-top:12px">' +
      '<button class="btn btn-primary" id="save-config" ' + (active ? 'disabled' : '') + '>保存参数</button>' +
      '</div></div>' +
      '<div id="raw-mode" style="display:none">' +
      '<div class="field"><label>configOverrides JSON</label>' +
      '<textarea id="raw-json" rows="10" ' + (active ? 'disabled' : '') + '>' +
      esc(JSON.stringify(job.configOverrides || {}, null, 2)) + '</textarea></div>' +
      '<button class="btn btn-primary" id="save-raw" ' + (active ? 'disabled' : '') + '>保存 JSON</button>' +
      '</div></div>';

    // 文章编辑器
    html += '<div class="panel"><h2>文章</h2>' +
      (active ? '<p class="hint">任务进行中，文章只读。</p>' : '') +
      '<div class="field"><textarea id="article-edit" rows="12" ' + (active ? 'disabled' : '') + '>' +
      esc(job.articleText || '') + '</textarea></div>' +
      '<button class="btn" id="save-article" ' + (active ? 'disabled' : '') + '>保存文章</button>' +
      '</div>';

    // 口播稿微调：跑过至少一个版本才显示（读写最新版本的 script.txt）
    if ((job.latestVersion || 0) >= 1) {
      html += '<div class="panel"><h2>口播稿</h2>' +
        (active ? '<p class="hint">任务进行中，口播稿只读。</p>' : '') +
        '<div class="btn-row" style="margin-bottom:8px">' +
        '<button class="btn btn-sm" id="script-load">加载口播稿</button>' +
        '<select id="script-version" class="tpl-select" style="display:none" title="口播稿历史版本">' +
        '<option value="">最新版本</option></select>' +
        '<span class="hint" id="script-hint"></span>' +
        '</div>' +
        '<div class="field"><textarea id="script-edit" rows="8" ' + (active ? 'disabled' : '') +
        ' placeholder="点击「加载口播稿」读取当前版本的 script.txt"></textarea></div>' +
        '<div class="btn-row">' +
        '<button class="btn" id="script-save" ' + (active ? 'disabled' : '') + '>保存口播稿</button>' +
        '<button class="btn" id="script-rerun-subtitles" ' + (active ? 'disabled' : '') +
        ' title="复用旧音频，新稿重新对齐字幕，只重跑字幕及之后阶段">从字幕重跑（微调，不耗 GPU）</button>' +
        '<button class="btn" id="script-rerun-tts" ' + (active ? 'disabled' : '') +
        ' title="重新配音，从 tts 起重跑">从配音重跑（改动大，耗 GPU）</button>' +
        '</div></div>';
    }

    app.innerHTML = html;
    bindDetailActions(jobId, job, cfg, estimates, templates);
    refreshLog(job, active);

    // 运行中 3s 轮询任务状态（表单只读，重渲染无副作用）
    schedulePoll(function () { renderDetail(jobId); }, active);
  }

  function refreshLog(job, active) {
    fetch(withToken(job.logs.stdout)).then(function (res) {
      if (!res.ok) throw new Error('log not ready');
      return res.text();
    }).then(function (text) {
      var box = document.getElementById('log-box');
      if (!box) return;
      box.textContent = text.length > 12000 ? '…（截断）…\n' + text.slice(-12000) : (text || '（暂无日志）');
      box.scrollTop = box.scrollHeight;
    }).catch(function () {
      var box = document.getElementById('log-box');
      if (box) box.textContent = '（暂无日志）';
    });
  }

  function bindDetailActions(jobId, job, cfg, estimates, templates) {
    function act(path, confirmMsg) {
      if (confirmMsg && !confirm(confirmMsg)) return;
      api('/api/v1/jobs/' + jobId + '/' + path, { method: 'POST' })
        .then(function () { toast('已执行', 'ok'); renderDetail(jobId); })
        .catch(function (err) { toast(err.message, 'error'); });
    }

    document.getElementById('act-run').addEventListener('click', function () { act('run'); });
    document.getElementById('act-rebuild').addEventListener('click', function () { act('rebuild'); });
    document.getElementById('act-rerun').addEventListener('click', function () { act('run'); });
    document.getElementById('act-stop').addEventListener('click', function () { act('stop'); });

    // 定时任务：保存 / 删除 / 复制 trigger URL
    var schedSave = document.getElementById('schedule-save');
    if (schedSave) {
      schedSave.addEventListener('click', function () {
        var cron = document.getElementById('schedule-cron').value.trim();
        if (!cron) return toast('请填写 cron 表达式', 'error');
        api('/api/v1/jobs/' + jobId + '/schedule', { method: 'POST', body: { cron: cron } })
          .then(function () { toast('定时任务已保存', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }
    var schedDel = document.getElementById('schedule-delete');
    if (schedDel) {
      schedDel.addEventListener('click', function () {
        if (!confirm('确定删除定时任务？')) return;
        api('/api/v1/jobs/' + jobId + '/schedule', { method: 'DELETE' })
          .then(function () { toast('定时任务已删除', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }
    var schedCopy = document.getElementById('schedule-copy');
    if (schedCopy) {
      schedCopy.addEventListener('click', function () {
        var urlInput = document.getElementById('schedule-trigger-url');
        if (urlInput) copyText(urlInput.value, 'Trigger URL 已复制');
      });
    }

    // 失败重试：默认断点续跑；指定阶段则带 {phase} 定点重跑
    var retryBtn = document.getElementById('act-retry');
    if (retryBtn) retryBtn.addEventListener('click', function () { act('retry'); });
    var retryPhaseBtn = document.getElementById('act-retry-phase');
    if (retryPhaseBtn) {
      retryPhaseBtn.addEventListener('click', function () {
        var sel = document.getElementById('retry-phase');
        api('/api/v1/jobs/' + jobId + '/retry', { method: 'POST', body: { phase: sel ? sel.value : undefined } })
          .then(function () { toast('已排队重跑', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }

    // 版本 chips：切换预览/下载到所选版本（本地重渲染，不重新拉取）
    app.querySelectorAll('.version-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        detailVersionSel[jobId] = parseInt(chip.getAttribute('data-version'), 10);
        renderDetailView(jobId, job, cfg, estimates, templates);
      });
    });

    // 版本对比：展开/收起、A/B 选择、同步播放与拖动（A 为基准，漂移 >0.3s 对齐 B）
    var compareToggle = document.getElementById('compare-toggle');
    if (compareToggle) {
      compareToggle.addEventListener('click', function () {
        compareSel[jobId].open = !compareSel[jobId].open;
        renderDetailView(jobId, job, cfg, estimates, templates);
      });
      ['a', 'b'].forEach(function (tag) {
        var sel = document.getElementById('compare-sel-' + tag);
        if (sel) {
          sel.addEventListener('change', function () {
            compareSel[jobId][tag] = parseInt(sel.value, 10);
            renderDetailView(jobId, job, cfg, estimates, templates);
          });
        }
      });
      var videoA = document.getElementById('compare-video-a');
      var videoB = document.getElementById('compare-video-b');
      var slider = document.getElementById('compare-slider');
      var playBtn = document.getElementById('compare-play');
      if (videoA && videoB && slider && playBtn) {
        playBtn.addEventListener('click', function () {
          if (videoA.paused || videoB.paused) {
            [videoA, videoB].forEach(function (v) {
              var p = v.play();
              if (p && p.catch) p.catch(function () { /* 忽略自动播放限制 */ });
            });
          } else {
            videoA.pause();
            videoB.pause();
          }
        });
        slider.addEventListener('input', function () {
          var dur = videoA.duration;
          if (!dur || !isFinite(dur)) return;
          var t = (parseFloat(slider.value) / 1000) * dur;
          videoA.currentTime = t;
          videoB.currentTime = t;
        });
        videoA.addEventListener('timeupdate', function () {
          var dur = videoA.duration;
          if (dur && isFinite(dur)) {
            slider.value = String(Math.round((videoA.currentTime / dur) * 1000));
          }
          if (Math.abs(videoA.currentTime - videoB.currentTime) > 0.3) {
            videoB.currentTime = videoA.currentTime;
          }
        });
      }
    }
    document.getElementById('act-clone').addEventListener('click', function () {
      var name = prompt('新任务名（留空自动加 _copy）：', job.outputName + '_v2');
      if (name === null) return;
      api('/api/v1/jobs/' + jobId + '/clone', {
        method: 'POST',
        body: { outputName: name || undefined, run: false },
      }).then(function (clone) {
        toast('已克隆为新任务', 'ok');
        location.hash = '#/job/' + clone.jobId;
      }).catch(function (err) { toast(err.message, 'error'); });
    });

    document.getElementById('act-delete').addEventListener('click', function () {
      document.getElementById('delete-confirm').style.display = 'block';
    });
    document.getElementById('delete-no').addEventListener('click', function () {
      document.getElementById('delete-confirm').style.display = 'none';
    });
    document.getElementById('delete-yes').addEventListener('click', function () {
      var purge = document.getElementById('delete-purge').checked;
      api('/api/v1/jobs/' + jobId + (purge ? '?purge=1' : ''), { method: 'DELETE' })
        .then(function () {
          toast('已删除', 'ok');
          location.hash = '#/';
        })
        .catch(function (err) { toast(err.message, 'error'); });
    });

    // 参数表单：保存 = 收集表单字段写入 overrides 后整体 PATCH
    var saveBtn = document.getElementById('save-config');
    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        var overrides = deepClone(job.configOverrides) || {};
        app.querySelectorAll('[data-path]').forEach(function (input) {
          var path = input.getAttribute('data-path');
          var type = input.getAttribute('data-type');
          var value;
          if (type === 'checkbox') {
            value = input.checked;
          } else if (type === 'number') {
            if (input.value === '') return;
            value = parseFloat(input.value);
            if (isNaN(value)) return;
          } else {
            value = input.value;
          }
          setPath(overrides, path, value);
        });
        api('/api/v1/jobs/' + jobId, { method: 'PATCH', body: { configOverrides: overrides } })
          .then(function () { toast('参数已保存', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }

    // 恢复默认：删除 overrides 里对应 key 后立即 PATCH
    app.querySelectorAll('button[data-reset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var overrides = deepClone(job.configOverrides) || {};
        deletePath(overrides, btn.getAttribute('data-reset'));
        api('/api/v1/jobs/' + jobId, { method: 'PATCH', body: { configOverrides: overrides } })
          .then(function () { toast('已恢复默认', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    });

    // 配置模板：套用（深合并进当前 overrides 后 PATCH）/ 存为 / 删除
    var tplMap = {};
    ((templates && templates.templates) || []).forEach(function (t) { tplMap[t.name] = t.overrides; });
    var tplSelect = document.getElementById('tpl-select');
    document.getElementById('tpl-apply').addEventListener('click', function () {
      var name = tplSelect.value;
      if (!name || !tplMap[name]) return toast('请先选择模板', 'error');
      var merged = mergeOverrides(job.configOverrides || {}, tplMap[name]);
      api('/api/v1/jobs/' + jobId, { method: 'PATCH', body: { configOverrides: merged } })
        .then(function () { toast('已套用模板「' + name + '」', 'ok'); renderDetail(jobId); })
        .catch(function (err) { toast(err.message, 'error'); });
    });
    document.getElementById('tpl-save').addEventListener('click', function () {
      var name = prompt('模板名称（同名覆盖）：', '');
      if (name === null) return;
      name = name.trim();
      if (!name) return toast('模板名不能为空', 'error');
      api('/api/v1/templates', { method: 'POST', body: { name: name, overrides: job.configOverrides || {} } })
        .then(function () { toast('模板已保存', 'ok'); renderDetail(jobId); })
        .catch(function (err) { toast(err.message, 'error'); });
    });
    document.getElementById('tpl-delete').addEventListener('click', function () {
      var name = tplSelect.value;
      if (!name) return toast('请先选择模板', 'error');
      if (!confirm('确定删除模板「' + name + '」？')) return;
      api('/api/v1/templates/' + encodeURIComponent(name), { method: 'DELETE' })
        .then(function () { toast('模板已删除', 'ok'); renderDetail(jobId); })
        .catch(function (err) { toast(err.message, 'error'); });
    });

    var rawToggle = document.getElementById('raw-toggle');
    rawToggle.addEventListener('change', function () {
      document.getElementById('form-mode').style.display = rawToggle.checked ? 'none' : 'block';
      document.getElementById('raw-mode').style.display = rawToggle.checked ? 'block' : 'none';
    });

    document.getElementById('save-raw').addEventListener('click', function () {
      var parsed;
      try {
        parsed = JSON.parse(document.getElementById('raw-json').value || 'null');
      } catch (err) {
        return toast('JSON 格式错误: ' + err.message, 'error');
      }
      api('/api/v1/jobs/' + jobId, { method: 'PATCH', body: { configOverrides: parsed } })
        .then(function () { toast('已保存', 'ok'); renderDetail(jobId); })
        .catch(function (err) { toast(err.message, 'error'); });
    });

    document.getElementById('save-article').addEventListener('click', function () {
      var text = document.getElementById('article-edit').value;
      api('/api/v1/jobs/' + jobId, { method: 'PATCH', body: { articleText: text } })
        .then(function () { toast('文章已保存', 'ok'); })
        .catch(function (err) { toast(err.message, 'error'); });
    });

    // 口播稿：加载 / 版本切换 / 保存 / 两个重跑入口
    var scriptLoad = document.getElementById('script-load');
    if (scriptLoad) {
      var scriptTa = document.getElementById('script-edit');
      var scriptHint = document.getElementById('script-hint');
      var scriptVerSel = document.getElementById('script-version');
      var scriptSaveBtn = document.getElementById('script-save');
      var scriptRerunSub = document.getElementById('script-rerun-subtitles');
      var scriptRerunTts = document.getElementById('script-rerun-tts');

      // 历史版本只读；切回「最新版本」才可编辑/重跑
      function setScriptReadonly(ro) {
        scriptTa.readOnly = ro;
        [scriptSaveBtn, scriptRerunSub, scriptRerunTts].forEach(function (btn) {
          if (btn) btn.disabled = ro || isActive(job.status);
        });
      }

      // 版本列表响应兼容 {versions:[{version:N,...}]} / {versions:[N,...]} / [N,...]
      function normalizeScriptVersions(data) {
        var list = (data && (Array.isArray(data) ? data : data.versions)) || [];
        return list.map(function (v) {
          return typeof v === 'number' ? v : (v && v.version);
        }).filter(function (n) { return typeof n === 'number'; });
      }

      function loadScriptVersion() {
        var sel = scriptVersionSel[jobId] || '';
        var url = '/api/v1/jobs/' + jobId + '/script' + (sel ? '?version=' + encodeURIComponent(sel) : '');
        api(url).then(function (data) {
          scriptTa.value = (data && data.script) || '';
          if (sel) {
            setScriptReadonly(true);
            if (scriptHint) scriptHint.textContent = '历史版本 v' + sel + '（只读）；切回「最新版本」可编辑';
          } else {
            setScriptReadonly(false);
            if (scriptHint) scriptHint.textContent = '已加载最新口播稿';
          }
        }).catch(function (err) {
          if (scriptHint) scriptHint.textContent = err.message;
        });
      }

      scriptLoad.addEventListener('click', function () {
        // 顺带拉取历史版本列表填充下拉；接口不可用则仅加载最新
        api('/api/v1/jobs/' + jobId + '/script/versions').then(function (data) {
          var versions = normalizeScriptVersions(data);
          if (versions.length) {
            var cur = scriptVersionSel[jobId] || '';
            scriptVerSel.innerHTML = '<option value="">最新版本</option>' +
              versions.map(function (n) { return '<option value="' + n + '">v' + n + '</option>'; }).join('');
            scriptVerSel.value = cur;
            scriptVerSel.style.display = '';
          }
        }).catch(function () { /* 后端未提供版本列表时保持单版本 */ });
        loadScriptVersion();
      });

      scriptVerSel.addEventListener('change', function () {
        scriptVersionSel[jobId] = scriptVerSel.value;
        loadScriptVersion();
      });

      scriptSaveBtn.addEventListener('click', function () {
        if (scriptVersionSel[jobId]) return toast('历史版本只读，请切回「最新版本」再保存', 'error');
        api('/api/v1/jobs/' + jobId + '/script', {
          method: 'PUT',
          body: { script: scriptTa.value },
        })
          .then(function () { toast('口播稿已保存，可选择从字幕/配音重跑', 'ok'); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
      scriptRerunSub.addEventListener('click', function () {
        api('/api/v1/jobs/' + jobId + '/run', { method: 'POST', body: { fromPhase: 'subtitles' } })
          .then(function () { toast('已排队：从字幕重跑', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
      scriptRerunTts.addEventListener('click', function () {
        api('/api/v1/jobs/' + jobId + '/run', { method: 'POST', body: { fromPhase: 'tts' } })
          .then(function () { toast('已排队：从配音重跑', 'ok'); renderDetail(jobId); })
          .catch(function (err) { toast(err.message, 'error'); });
      });
    }
  }

  // ---------- 启动 ----------

  startSse();
  route();
})();
