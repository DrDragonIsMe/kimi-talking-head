/* 薪灵视频后台 SPA —— 原生 JS + fetch，hash 路由，无构建步骤 */
(function () {
  'use strict';

  var app = document.getElementById('app');
  var pollTimer = null;
  var configCache = null;

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

  function api(path, options) {
    options = options || {};
    if (options.body && typeof options.body === 'object') {
      options.body = JSON.stringify(options.body);
      options.headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    }
    return fetch(path, options).then(function (res) {
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

  function clearPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // 只在页面有运行中任务时开启 3s 轮询
  function schedulePoll(fn, active) {
    clearPoll();
    if (active) {
      pollTimer = setInterval(fn, 3000);
    }
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
    if (hash === '#/new') return renderNew();
    var m = hash.match(/^#\/job\/([0-9a-f-]{36})$/i);
    if (m) return renderDetail(m[1]);
    app.innerHTML = '<div class="panel"><p>未知页面，<a href="#/">返回任务列表</a></p></div>';
  }

  window.addEventListener('hashchange', route);

  // ---------- 任务列表 ----------

  function renderList() {
    app.innerHTML = '<div class="panel"><p class="hint">加载中…</p></div>';
    api('/api/v1/jobs?limit=100').then(function (data) {
      var jobs = data.jobs || [];
      var html = '<div class="panel">' +
        '<div class="btn-row" style="justify-content:space-between;margin-bottom:12px">' +
        '<h2 style="margin:0">任务列表（' + data.total + '）</h2>' +
        '<a class="btn btn-primary" href="#/new">新建任务</a>' +
        '</div>';

      if (!jobs.length) {
        html += '<p class="hint">还没有任务，点击右上角"新建任务"开始。</p>';
      } else {
        html += '<table class="job-table"><thead><tr>' +
          '<th>任务</th><th>状态</th><th>进度</th><th>创建时间</th><th>耗时</th><th>操作</th>' +
          '</tr></thead><tbody>';
        jobs.forEach(function (j) {
          var phases = j.phases || { completed: 0, total: 9, currentPhase: null };
          var pct = Math.round((phases.completed / phases.total) * 100);
          var phaseText = phases.completed + '/' + phases.total +
            (phases.currentPhase ? ' · ' + (PHASE_LABELS[phases.currentPhase] || phases.currentPhase) : '');
          var queueText = j.queuePosition ? '（队列第 ' + j.queuePosition + ' 位）' : '';
          html += '<tr>' +
            '<td><a class="job-name" href="#/job/' + j.jobId + '">' + esc(j.outputName) + '</a>' +
            '<div class="job-meta">' + esc(j.kind === 'rebuild' ? '重渲' : '全量') + queueText + '</div></td>' +
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
        });
        html += '</tbody></table>';
      }
      html += '</div>';
      app.innerHTML = html;

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
      '<textarea id="new-article" rows="14" placeholder="# 文章标题&#10;&#10;正文…"></textarea></div>' +
      '<div class="field"><label>高级配置（可选，JSON overrides，例如 {"content_overlay":{"subtitles":{"dna":"loud"}}}）</label>' +
      '<textarea id="new-config" rows="4" placeholder="留空使用默认配置"></textarea></div>' +
      '<div class="btn-row">' +
      '<button class="btn btn-primary" id="new-run">创建并运行</button>' +
      '<button class="btn" id="new-draft">存为草稿</button>' +
      '<a class="btn" href="#/">取消</a>' +
      '</div></div>';

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

    function submit(run) {
      var name = document.getElementById('new-name').value.trim();
      var article = document.getElementById('new-article').value;
      var configText = document.getElementById('new-config').value.trim();
      if (!article.trim()) return toast('请填写文章内容', 'error');
      var config = null;
      if (configText) {
        try {
          config = JSON.parse(configText);
        } catch (err) {
          return toast('高级配置 JSON 格式错误: ' + err.message, 'error');
        }
      }
      api('/api/v1/jobs', {
        method: 'POST',
        body: { outputName: name || undefined, articleText: article, config: config, run: run },
      }).then(function (job) {
        toast(run ? '已创建并排队' : '草稿已保存', 'ok');
        location.hash = '#/job/' + job.jobId;
      }).catch(function (err) { toast(err.message, 'error'); });
    }

    document.getElementById('new-run').addEventListener('click', function () { submit(true); });
    document.getElementById('new-draft').addEventListener('click', function () { submit(false); });
  }

  // ---------- 任务详情 ----------

  function renderDetail(jobId) {
    app.innerHTML = '<div class="panel"><p class="hint">加载中…</p></div>';
    Promise.all([api('/api/v1/jobs/' + jobId), loadConfig()])
      .then(function (results) {
        renderDetailView(jobId, results[0], results[1]);
      })
      .catch(function (err) {
        app.innerHTML = '<div class="panel"><div class="error-box">' + esc(err.message) +
          '</div><a href="#/">返回任务列表</a></div>';
      });
  }

  function renderDetailView(jobId, job, cfg) {
    var active = isActive(job.status);
    var mediaReady = job.media && job.media.ready;

    var html = '';

    // 头部操作条
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
      '<button class="btn" id="act-stop" ' + (active ? '' : 'disabled') + '>Stop</button>' +
      '<button class="btn" id="act-clone">Clone</button>' +
      '<button class="btn btn-danger" id="act-delete">Delete</button>' +
      '</div>' +
      '<div id="delete-confirm" style="display:none;margin-top:12px" class="error-box">' +
      '确认删除该任务？ <label class="checkbox-field" style="display:inline-flex">' +
      '<input type="checkbox" id="delete-purge"> 同时删除产物（temp/ 与 output/）</label> ' +
      '<button class="btn btn-sm btn-danger" id="delete-yes">确认删除</button> ' +
      '<button class="btn btn-sm" id="delete-no">取消</button>' +
      '</div>' +
      (job.error ? '<div class="error-box" style="margin-top:12px">' + esc(job.error) + '</div>' : '') +
      '<div class="job-meta" style="margin-top:8px">创建 ' + esc(fmtTime(job.createdAt)) +
      ' · 开始 ' + esc(fmtTime(job.startedAt)) + ' · 结束 ' + esc(fmtTime(job.finishedAt)) +
      ' · 耗时 ' + esc(fmtDuration(job)) + '</div>' +
      '</div>';

    // 预览
    html += '<div class="panel preview"><h2>预览</h2>';
    if (job.hasOutput) {
      html += '<div class="preview-col"><div>' +
        '<video controls preload="metadata" poster="' + job.preview.cover + '" src="' + job.preview.video + '"></video>' +
        '<div class="btn-row" style="margin-top:8px">' +
        '<a class="btn btn-sm" href="' + job.outputs.video + '">下载视频</a>' +
        '<a class="btn btn-sm" href="' + job.outputs.cover + '">下载封面</a>' +
        '</div></div>' +
        '<div><img src="' + job.preview.cover + '" alt="封面"></div></div>';
    } else {
      html += '<p class="hint">产物尚未生成' + (mediaReady ? '（媒体已就绪，可 Rebuild）' : '') + '。</p>';
    }
    html += '</div>';

    // 阶段步进器
    html += '<div class="panel"><h2>阶段进度' +
      (job.phasesSummary ? '（' + job.phasesSummary.completed + '/' + job.phasesSummary.total + '）' : '') + '</h2>' +
      '<div class="stepper">';
    PHASE_ORDER.forEach(function (phase) {
      var p = (job.phases && job.phases[phase]) || { status: 'pending' };
      html += '<div class="step ' + esc(p.status) + '">' +
        '<div class="step-name">' + esc(PHASE_LABELS[phase] || phase) + '</div>' +
        '<div class="step-status">' + esc(PHASE_STATUS_LABELS[p.status] || p.status) + '</div>' +
        (p.started_at ? '<div class="step-time">' + esc(fmtTime(p.started_at)) + '</div>' : '') +
        (p.completed_at ? '<div class="step-time">→ ' + esc(fmtTime(p.completed_at)) + '</div>' : '') +
        (p.error ? '<div class="step-time" style="color:var(--danger)">' + esc(p.error) + '</div>' : '') +
        '</div>';
    });
    html += '</div></div>';

    // 日志
    html += '<div class="panel"><h2>日志（stdout 尾部）' +
      '<span class="hint">' + (active ? ' 3s 自动刷新' : '') + '</span></h2>' +
      '<div class="log-box" id="log-box">加载中…</div>' +
      '<div class="btn-row" style="margin-top:8px">' +
      '<a class="btn btn-sm" href="' + job.logs.stdout + '" target="_blank">完整 stdout</a>' +
      '<a class="btn btn-sm" href="' + job.logs.stderr + '" target="_blank">完整 stderr</a>' +
      '</div></div>';

    // 参数表单
    var overrides = deepClone(job.configOverrides) || {};
    var groups = fieldGroups(cfg.enums);
    html += '<div class="panel"><div class="btn-row" style="justify-content:space-between">' +
      '<h2 style="margin:0">参数（写入 configOverrides）</h2>' +
      '<label class="checkbox-field"><input type="checkbox" id="raw-toggle"> 高级 JSON 模式</label>' +
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

    app.innerHTML = html;
    bindDetailActions(jobId, job, cfg);
    refreshLog(job, active);

    // 运行中 3s 轮询任务状态（表单只读，重渲染无副作用）
    schedulePoll(function () { renderDetail(jobId); }, active);
  }

  function refreshLog(job, active) {
    fetch(job.logs.stdout).then(function (res) {
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

  function bindDetailActions(jobId, job, cfg) {
    function act(path, confirmMsg) {
      if (confirmMsg && !confirm(confirmMsg)) return;
      api('/api/v1/jobs/' + jobId + '/' + path, { method: 'POST' })
        .then(function () { toast('已执行', 'ok'); renderDetail(jobId); })
        .catch(function (err) { toast(err.message, 'error'); });
    }

    document.getElementById('act-run').addEventListener('click', function () { act('run'); });
    document.getElementById('act-rebuild').addEventListener('click', function () { act('rebuild'); });
    document.getElementById('act-stop').addEventListener('click', function () { act('stop'); });
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
  }

  // ---------- 启动 ----------

  route();
})();
