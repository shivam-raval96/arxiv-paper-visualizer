/**
 * settings.js — Settings modal: visual preferences + OpenAI key + cluster relabeling
 *
 * Settings are applied immediately but NOT persisted (except dark mode preference
 * which is stored in localStorage for convenience).
 */

const Settings = (() => {

  // Live visual settings — canvas.js reads these
  const prefs = {
    pointSize:    5,
    pointOpacity: 1.0,
    showLabels:   true,
    darkMode:     false,
  };

  // Session-only OpenAI key (never written to storage)
  let _openaiKey = '';

  // ── Init ─────────────────────────────────────────────────────────────────────

  function init() {
    // Restore dark mode from localStorage
    if (localStorage.getItem('darkMode') === 'true') {
      prefs.darkMode = true;
      _applyDarkMode(true);
      document.getElementById('dark-mode-toggle').checked = true;
    }

    _bindEvents();
  }

  function _bindEvents() {
    // Open / close
    document.getElementById('settings-btn').addEventListener('click', open);
    document.getElementById('settings-close').addEventListener('click', close);
    document.getElementById('settings-overlay').addEventListener('click', close);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('settings-modal').classList.contains('hidden')) {
        close();
      }
    });

    // Point size
    const sizeInput = document.getElementById('point-size-input');
    const sizeVal   = document.getElementById('point-size-val');
    sizeInput.addEventListener('input', () => {
      prefs.pointSize = parseInt(sizeInput.value, 10);
      sizeVal.textContent = sizeInput.value;
      Canvas.render();
    });

    // Point opacity
    const opacInput = document.getElementById('point-opacity-input');
    const opacVal   = document.getElementById('point-opacity-val');
    opacInput.addEventListener('input', () => {
      prefs.pointOpacity = parseInt(opacInput.value, 10) / 100;
      opacVal.textContent = opacInput.value + '%';
      Canvas.render();
    });

    // Show labels
    document.getElementById('show-labels-toggle').addEventListener('change', e => {
      prefs.showLabels = e.target.checked;
      Canvas.render();
    });

    // Dark mode
    document.getElementById('dark-mode-toggle').addEventListener('change', e => {
      prefs.darkMode = e.target.checked;
      localStorage.setItem('darkMode', prefs.darkMode);
      _applyDarkMode(prefs.darkMode);
      Canvas.render();
    });

    // OpenAI key show/hide toggle
    document.getElementById('openai-key-toggle').addEventListener('click', () => {
      const inp = document.getElementById('openai-key-input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('openai-key-input').addEventListener('input', e => {
      _openaiKey = e.target.value.trim();
    });

    // Relabel button
    document.getElementById('relabel-btn').addEventListener('click', _relabel);

    // GitHub token show/hide toggle
    document.getElementById('gh-token-toggle').addEventListener('click', () => {
      const inp = document.getElementById('gh-token-input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Restore saved token into input field
    const savedToken = Shared.loadTokenFromStorage();
    if (savedToken) {
      document.getElementById('gh-token-input').value = savedToken;
    }

    // Save token button
    document.getElementById('gh-token-save-btn').addEventListener('click', () => {
      const token = document.getElementById('gh-token-input').value.trim();
      Shared.setToken(token);
      _setGhStatus(token ? 'success' : 'error', token ? 'Token saved.' : 'Token cleared.');
      UI.updateSharedSyncBar();
    });
  }

  // ── Open / Close ──────────────────────────────────────────────────────────────

  function open() {
    document.getElementById('settings-modal').classList.remove('hidden');
    document.getElementById('settings-overlay').classList.remove('hidden');
  }

  function close() {
    document.getElementById('settings-modal').classList.add('hidden');
    document.getElementById('settings-overlay').classList.add('hidden');
  }

  // ── Dark mode ─────────────────────────────────────────────────────────────────

  function _applyDarkMode(on) {
    document.documentElement.classList.toggle('dark-mode', on);
  }

  // ── OpenAI cluster relabeling ─────────────────────────────────────────────────

  async function _relabel() {
    if (!_openaiKey) {
      _setStatus('error', 'Enter your OpenAI API key first.');
      return;
    }
    if (!APP.clusters || APP.clusters.length === 0) {
      _setStatus('error', 'No cluster data loaded.');
      return;
    }

    _setStatus('loading', 'Generating labels…');
    document.getElementById('relabel-btn').disabled = true;

    try {
      // Build one prompt per cluster
      const updated = await Promise.all(APP.clusters.map(async cluster => {
        // Gather paper titles in this cluster
        const titles = APP.allPapers
          .filter(p => p.cluster_id === cluster.id)
          .map(p => p.title)
          .slice(0, 20);

        const label = await _callOpenAI(titles);
        return { ...cluster, label };
      }));

      APP.clusters = updated;
      Canvas.render();
      _setStatus('success', `Relabeled ${updated.length} clusters.`);

    } catch (err) {
      _setStatus('error', `Failed: ${err.message}`);
    } finally {
      document.getElementById('relabel-btn').disabled = false;
    }
  }

  async function _callOpenAI(titles) {
    const prompt =
      'You are a research topic labeler. Given these arXiv paper titles from a semantic cluster, ' +
      'reply with ONLY a concise 2-4 word topic label. No explanation, no punctuation.\n\n' +
      titles.map(t => `- ${t}`).join('\n');

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_openaiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 15,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }

    const data = await res.json();
    return data.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
  }

  function _setStatus(type, msg) {
    const el = document.getElementById('relabel-status');
    el.className = `settings-status settings-status-${type}`;
    el.textContent = msg;
    el.classList.remove('hidden');
    if (type === 'success') setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function _setGhStatus(type, msg) {
    const el = document.getElementById('gh-token-status');
    el.className = `settings-status settings-status-${type}`;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
  }

  // ── Public ────────────────────────────────────────────────────────────────────

  return { init, prefs, getOpenAIKey: () => _openaiKey };
})();
