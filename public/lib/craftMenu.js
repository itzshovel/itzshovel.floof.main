import { getPetalIcon, petalTooltip } from "./renders.js";
import { state, sendChatMessage, onChatMessage, captureChatMessage } from "./net.js";

(function () {
  var hoverEntry = null;
  var btn, panel, tip, tipCanvas, fsBtn;
  var isFullscreen = false;

  var craftSlots = [0, 0, 0, 0, 0];
  var craftPetalIdx = null;
  var craftRarity = null;

  var craftResult = null;
  var craftResultToken = 0;
  var CRAFT_RESULT_TTL_MS = 5000;

  var searchQuery = '';

  var fastCraft = false;
  try { fastCraft = localStorage.getItem('craftMenuFastCraft') === 'true'; } catch (_) {}
  function setFastCraft(val) {
    fastCraft = !!val;
    try { localStorage.setItem('craftMenuFastCraft', String(fastCraft)); } catch (_) {}
  }

  function dlog()   { if (_debugMode) console.log.apply(console, ['[CraftMenu]'].concat([].slice.call(arguments))); }
  function dwarn()  { if (_debugMode) console.warn.apply(console, ['[CraftMenu]'].concat([].slice.call(arguments))); }
  function derror() { if (_debugMode) console.error.apply(console, ['[CraftMenu]'].concat([].slice.call(arguments))); }

  function getCraftPetalName(s, petalIdx) {
    return (s && s.petalConfigs && s.petalConfigs[petalIdx] && s.petalConfigs[petalIdx].name) || '';
  }

  var PETAL_NAME_SHORTHAND = {
    'Third Eye': 'Teye',
    'Beetle Egg': 'Begg',
    'Ant Egg': 'Aegg',
    'Yin Yang': 'Yyang',
    'Magic Leaf': 'Mleaf',
    'Golden Leaf': 'Gleaf',
    'Blood Stinger': 'Bstinger',
    'Venomous Stinger': 'Vstinger',
    'Hornet Egg': 'Hegg',
    'Leech Egg': 'Legg',
    'Lily Pad': 'Lpad',
    'Mecha Missile': 'Mmissile',
    'Tesla Coil': 'Tcoil',
    'Red Coral': 'Rcoral',
    'Blue Coral': 'Bcoral',
    'Pillbug Egg': 'Pegg',
    'Shiny Wing': 'Swing',
    'Fire Spellbook': 'Fspell',
  };

  var liveCraftRates = null;
  var craftRatesFetching = false;

  var CRAFT_RATE_LINE_RE = /^([^:]+?):\s*([\d.]+)%(?:\s*$|\s*\|\s*PRNG\s+starts\s+at\s+attempt:\s*(\d+))/;

  function fetchCraftRates() {
    if (liveCraftRates || craftRatesFetching) return;
    if (typeof captureChatMessage !== 'function') return;
    if (typeof sendChatMessage !== 'function') return;
    var s = state;
    if (!s || !s.socket || s.socket.readyState !== WebSocket.OPEN) return;

    var lobby = detectLobby(s);
    if (!lobby || lobby.name !== 'Desert Maze') return;
    craftRatesFetching = true;
    var p = captureChatMessage(
      function (e) {
        return e.type === 1 && CRAFT_RATE_LINE_RE.test(e.message);
      },

      { count: 32, idleMs: 800, timeoutMs: 20000 }
    );
    if (!sendChatMessage('/craft')) {
      craftRatesFetching = false;
      return;
    }
    p.then(function (lines) {
      var rates = {};
      for (var i = 0; i < lines.length; i++) {
        var m = CRAFT_RATE_LINE_RE.exec(lines[i].message);
        if (m) rates[m[1].trim()] = parseFloat(m[2]);
      }
      if (Object.keys(rates).length) {
        liveCraftRates = rates;
        if (panel && panel.style.display !== 'none') render();
      } else {
        dwarn('/craft response empty; using hardcoded rates');
      }
    }).catch(function (err) {
      derror('craft rate fetch failed', err);
    }).finally(function () {
      craftRatesFetching = false;
    });
  }

  function getCraftRate(tierName) {
    if (liveCraftRates && liveCraftRates[tierName] != null) return liveCraftRates[tierName];
    var preset = detectLobby(state);
    if (preset && preset.rates && preset.rates[tierName] != null) return preset.rates[tierName];
    return CRAFT_SUCCESS_RATES[tierName];
  }

  var pityRates = {};
  var pityInitialized = false;

  var _pendingBotPitySends = [];
  var PITY_SEND_TIMEOUT_MS = 10000;

  var _pityCurrentTier = null;
  var _pityCurrentSinglePetal = null;
  var _pitySuppressingCurrent = false;
  var _pityLastMessageAt = 0;
  var PITY_WINDOW_MS = 2500;
  var pityInterceptorStarted = false;

  var _loginAt = 0;
  var _lastUsername = null;
  var POST_LOGIN_PITY_DELAY_MS = 1500;

  var DESERT_PITY_MIN_TIER_IDX = 3;
  var PITY_INIT_POLL_MS = 2500;
  var PITY_HEADER_RE = /^All\s+pity\s+for\s+(.+?):/i;

  var PITY_SINGLE_HEADER_RE = /^(.+?)\s+pity:\s*(?:([\d.]+)%\s*\(\+([\d.]+)\s*pity\))?\s*$/i;

  var PITY_RATE_ONLY_RE = /^([\d.]+)%\s*\(\+([\d.]+)\s*pity\)\s*$/i;

  var PITY_LINE_RE = /^([^:]+?):\s*([\d.]+)%\s*\(\+([\d.]+)\s*pity\)/i;

  function startPityInterceptor() {
    if (pityInterceptorStarted) return;
    if (typeof captureChatMessage !== 'function') return;
    pityInterceptorStarted = true;

    captureChatMessage(function (e) {
      var msg = String(e.message || '');
      var now = performance.now();

      while (_pendingBotPitySends.length > 0 &&
             now - _pendingBotPitySends[0] > PITY_SEND_TIMEOUT_MS) {
        _pendingBotPitySends.shift();
      }

      if (_pityLastMessageAt > 0 && now - _pityLastMessageAt > PITY_WINDOW_MS) {
        _pityCurrentTier = null;
        _pityCurrentSinglePetal = null;
        _pitySuppressingCurrent = false;
      }

      var headerMatch = PITY_HEADER_RE.exec(msg);
      if (headerMatch) {
        _pityLastMessageAt = now;
        _pityCurrentTier = headerMatch[1].trim();
        _pityCurrentSinglePetal = null;
        if (!pityRates[_pityCurrentTier]) pityRates[_pityCurrentTier] = {};
        if (_pendingBotPitySends.length > 0) {
          _pendingBotPitySends.shift();
          _pitySuppressingCurrent = true;
          return true;
        }
        _pitySuppressingCurrent = false;
        return false;
      }

      var singleHeader = PITY_SINGLE_HEADER_RE.exec(msg);
      if (singleHeader) {
        _pityLastMessageAt = now;
        var headerPrefix = singleHeader[1].trim();
        var inlineRate = singleHeader[2] != null ? parseFloat(singleHeader[2]) : null;
        var sNow = state;
        var ttn = null, pn = null;
        if (sNow && sNow.tiers) {
          for (var ti = 0; ti < sNow.tiers.length; ti++) {
            var ttname = sNow.tiers[ti].name;
            if (headerPrefix.indexOf(ttname + ' ') === 0) {
              ttn = ttname;
              pn = headerPrefix.substring(ttname.length + 1).trim();
              break;
            }
          }
        }
        if (!ttn) {
          var sp = headerPrefix.split(/\s+/);
          ttn = sp[0];
          pn = sp.slice(1).join(' ');
        }
        if (ttn && pn) {
          if (!pityRates[ttn]) pityRates[ttn] = {};
          if (inlineRate != null) pityRates[ttn][pn] = inlineRate;
          _pityCurrentTier = ttn;
          _pityCurrentSinglePetal = { tier: ttn, petal: pn };
        }
        if (_pendingBotPitySends.length > 0) {
          _pendingBotPitySends.shift();
          _pitySuppressingCurrent = true;
          return true;
        }
        _pitySuppressingCurrent = false;
        return false;
      }

      var rateOnly = PITY_RATE_ONLY_RE.exec(msg);
      if (rateOnly && _pityCurrentSinglePetal) {
        _pityLastMessageAt = now;
        var splitRate = parseFloat(rateOnly[1]);
        pityRates[_pityCurrentSinglePetal.tier][_pityCurrentSinglePetal.petal] = splitRate;
        return _pitySuppressingCurrent;
      }

      var lineMatch = PITY_LINE_RE.exec(msg);
      if (lineMatch && _pityCurrentTier && !_pityCurrentSinglePetal) {
        _pityLastMessageAt = now;
        pityRates[_pityCurrentTier][lineMatch[1].trim()] = parseFloat(lineMatch[2]);
        return _pitySuppressingCurrent;
      }

      if (/^(?:Current\s+Attempt|Attempts\s+for\s+PRNG):/i.test(msg)) {
        _pityLastMessageAt = now;
        return _pitySuppressingCurrent;
      }
      return false;
    }, { count: 1000000000, idleMs: 1000000000, timeoutMs: 1000000000 });
    dlog('pity interceptor active');
  }

  function fetchPityForTier(targetTier, petalName) {
    if (typeof sendChatMessage !== 'function') return;
    var s = state;
    if (!s || !s.socket || s.socket.readyState !== WebSocket.OPEN) return;
    var lobby = detectLobby(s);
    if (!lobby || lobby.name !== 'Desert Maze') return;
    startPityInterceptor();
    var cmd = '/pity ' + targetTier + (petalName ? ' ' + petalName : '');
    _pendingBotPitySends.push(performance.now());
    if (!sendChatMessage(cmd)) {

      _pendingBotPitySends.pop();
    }
  }

  function fetchInitialPity() {
    if (pityInitialized) return;

    if (_loginAt === 0) return;
    if (performance.now() - _loginAt < POST_LOGIN_PITY_DELAY_MS) return;
    var s = state;
    if (!s || !s.inventory || !s.tiers) return;
    if (!s.socket || s.socket.readyState !== WebSocket.OPEN) return;
    var lobby = detectLobby(s);
    if (!lobby || lobby.name !== 'Desert Maze') return;
    var highestIdx = -1;
    for (var i = s.tiers.length - 1; i >= 0; i--) {
      var tn = s.tiers[i].name;
      var inv = s.inventory[tn];
      if (!inv) continue;
      var hasAny = false;
      for (var k in inv) { if (inv[k] > 0) { hasAny = true; break; } }
      if (hasAny) { highestIdx = i; break; }
    }
    if (highestIdx < 0) return;

    if (highestIdx < DESERT_PITY_MIN_TIER_IDX) {
      dlog('highest owned tier: ' + s.tiers[highestIdx].name +
        ' (idx ' + highestIdx + ') — below Epic threshold, /pity skipped');
      return;
    }
    pityInitialized = true;
    dlog('highest owned tier: ' + s.tiers[highestIdx].name +
      ' (idx ' + highestIdx + '); fetching initial pity');
    fetchPityForTier(s.tiers[highestIdx].name);
    if (highestIdx - 1 >= 0) fetchPityForTier(s.tiers[highestIdx - 1].name);
  }

  function firePityRefresh(petalIdx, fromRarity) {
    if (petalIdx == null || fromRarity == null) {
      dlog('firePityRefresh: missing petalIdx/fromRarity', petalIdx, fromRarity);
      return;
    }
    var s = state;
    if (!s || !s.tiers) return;
    var lobby = detectLobby(s);
    if (!lobby || lobby.name !== 'Desert Maze') {
      dlog('firePityRefresh skipped: not Desert Maze');
      return;
    }

    var materialTier = s.tiers[fromRarity];
    if (!materialTier) {
      dlog('firePityRefresh: no materialTier for fromRarity', fromRarity);
      return;
    }
    var petalName = getCraftPetalName(s, petalIdx);
    if (!petalName) {
      dlog('firePityRefresh: no petalName for petalIdx', petalIdx);
      return;
    }
    dlog('Pity Update: ' + materialTier.name + ' ' + petalName);
    fetchPityForTier(materialTier.name, petalName);
  }

  var CRAFT_SUCCESS_RATES = {
    'Common': 100,
    'Uncommon': 64,
    'Rare': 32,
    'Epic': 16,
    'Legendary': 8,
    'Mythic': 4,
    'Ultra': 2,
    'Super': 1,
    'Ancient': 0.5,
    'Omega': 0.4,
    'Eternal': 0.3,
    'Unique': 0.2,
    'Hyper': 0.1,
    'Galaxium': 0.09,
    'Millom': 0.08,
    'Fictional': 0.07,
    'Transcestrial': 0.05,
    'Chaos': 0.01,
    'Absiorcadinary': 0.009,
    'Absolute Fictional': 0.008,
    'Nullified': 0.007,
    'Hyperfixation': 0.006,
    'Atlantical': 0.001,
    'Alpha': 0.0003,
    'Finalist': 0.0008,
    'Epsilation': 0.0007,
    'Improbable': 0.0006,
    'Izolational': 0.0005,
    'Chronodynamic': 0.0001,
    'Multiversal': 0.00001,
  };

  var LOBBY_PRESETS = [
    {
      name: 'Line Maze',
      short: 'Line',
      tiers: [
        'Common', 'Unusual', 'Rare', 'Epic', 'Legendary', 'Mythic',
        'Ultra', 'Super', 'Omega', 'Eternal', 'Unique',
        'Devastating', 'Dreadful', 'Enigmatic', 'Cataclysmic',
      ],
      rates: {
        'Unusual': 100,
        'Rare': 64,
        'Epic': 48,
        'Legendary': 32,
        'Mythic': 24,
        'Ultra': 16,
        'Super': 12,
        'Omega': 8,
        'Eternal': 6,
        'Unique': 4,
        'Devastating': 2,
        'Dreadful': 1,
        'Enigmatic': 0.5,
        'Cataclysmic': 0.1,
      },
    },
    {
      name: 'Desert Maze',
      short: 'Desert',
      tiers: [
        'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic',
        'Ultra', 'Super', 'Ancient', 'Omega', 'Eternal', 'Unique',
        'Hyper', 'Galaxium', 'Millom', 'Fictional', 'Transcestrial',
        'Chaos', 'Absiorcadinary', 'Absolute Fictional', 'Nullified',
        'Hyperfixation', 'Atlantical', 'Alpha', 'Finalist', 'Epsilation',
        'Improbable', 'Izolational', 'Chronodynamic', 'Multiversal',
      ],
      rates: null,
    },
  ];

  function detectLobby(s) {
    if (!s || !Array.isArray(s.tiers)) return null;
    var names = s.tiers.map(function (t) { return t && t.name; });
    for (var i = 0; i < LOBBY_PRESETS.length; i++) {
      var preset = LOBBY_PRESETS[i];
      if (preset.tiers.length !== names.length) continue;
      var ok = true;
      for (var j = 0; j < preset.tiers.length; j++) {
        if (preset.tiers[j] !== names[j]) { ok = false; break; }
      }
      if (ok) return preset;
    }
    return null;
  }

  var EXPAND_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M9 7 L14 2 M10 2 L14 2 L14 6"/>' +
    '<path d="M7 9 L2 14 M2 10 L2 14 L6 14"/></svg>';
  var COLLAPSE_SVG =
    '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" ' +
    'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M14 2 L9 7 M9 3 L9 7 L13 7"/>' +
    '<path d="M2 14 L7 9 M3 9 L7 9 L7 13"/></svg>';

  function injectStyles() {
    if (document.getElementById('craftMenuStyles')) return;
    var st = document.createElement('style');
    st.id = 'craftMenuStyles';
    st.textContent =
      '#craftMenuPanel ::-webkit-scrollbar{width:10px;height:10px;}' +
      '#craftMenuPanel ::-webkit-scrollbar-track{background:rgba(0,0,0,0.12);border-radius:4px;}' +
      '#craftMenuPanel ::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.35);border-radius:4px;}' +
      '#craftMenuPanel ::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,0.55);}' +
      '#craftMenuPanel ::-webkit-scrollbar-corner{background:transparent;}' +

      '@keyframes craftMenuSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}' +
      '.craftMenuSpinning{animation:craftMenuSpin 0.5s linear infinite;transform-origin:center center;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function applyPanelSize() {
    if (!panel) return;
    if (isFullscreen) {
      panel.style.width = '95vw';
      panel.style.maxWidth = 'none';
      panel.style.height = '95vh';
      panel.style.maxHeight = '95vh';
      panel.style.left = '2.5vw';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.top = '2.5vh';
    } else {
      panel.style.width = '632px';
      panel.style.maxWidth = '632px';
      panel.style.height = 'auto';
      panel.style.maxHeight = '45vh';
      panel.style.left = '5px';
      panel.style.right = 'auto';
      panel.style.bottom = '65px';
      panel.style.top = 'auto';
    }
  }

  function computeIconSize(nRarities) {
    if (!isFullscreen) return 56;
    var available = window.innerWidth * 0.95 - 32;
    var maxPerCol = Math.floor((available - (nRarities - 1) * 5) / nRarities);
    return Math.max(24, Math.min(56, maxPerCol));
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    applyPanelSize();
    render();
  }

  var _lastTiersSig = null;
  function updateButtonVisibility() {
    if (!btn) return;
    var s = state;

    var currentUsername = s && s.username;
    if (currentUsername && currentUsername !== _lastUsername) {
      _lastUsername = currentUsername;
      _loginAt = performance.now();
      pityInitialized = false;
      dlog('login detected (' + currentUsername +
        '); /pity init scheduled for ' + POST_LOGIN_PITY_DELAY_MS + 'ms later');
    }
    var names = (s && Array.isArray(s.tiers)) ? s.tiers.map(function (t) { return t && t.name; }) : null;
    var sig = names ? names.join('|') : null;
    var lobby = detectLobby(s);
    if (sig !== _lastTiersSig) {
      _lastTiersSig = sig;
      dlog('tiers update; matched preset=' + (lobby && lobby.name) + '; tiers=', names);

      pityInitialized = false;
    }
    var shouldShow = !!lobby;
    var newDisplay = shouldShow ? '' : 'none';
    if (btn.style.display !== newDisplay) {
      btn.style.display = newDisplay;
      if (!shouldShow) {
        if (panel) panel.style.display = 'none';
        if (tip) tip.style.display = 'none';
        hoverEntry = null;
      }
    }
  }

  function inject() {
    try {
      injectStyles();
      var c = document.getElementById('bottomButtons');
      if (!c) return;
      if (document.getElementById('craftMenuButton')) return;

      btn = document.createElement('button');
      btn.id = 'craftMenuButton';
      btn.tabIndex = -1;
      btn.style.width = '40px';
      btn.style.height = '40px';
      btn.style.backgroundColor = 'rgba(219,157,90,0.5)';
      btn.style.border = '3px solid #6e4924';
      btn.style.display = 'none';

      panel = document.createElement('div');
      panel.id = 'craftMenuPanel';

      panel.style.cssText =
        'position:fixed;display:none;flex-direction:column;' +
        'background:#db9d5a;border-radius:8px;border:4px solid #6e4924;' +
        'padding:8px;z-index:9999;font-family:Ubuntu,sans-serif;color:#fff;' +
        'overflow:hidden;box-sizing:border-box;';
      applyPanelSize();
      document.body.appendChild(panel);

      tip = document.createElement('div');
      tip.id = 'craftMenuTooltip';
      tip.style.cssText =
        'position:fixed;pointer-events:none;display:none;z-index:99999;' +
        'background:transparent;';
      tipCanvas = document.createElement('canvas');
      tip.appendChild(tipCanvas);
      document.body.appendChild(tip);

      btn.addEventListener('click', togglePanel);
      c.appendChild(btn);

      document.addEventListener('keydown', function (e) {
        if (e.key !== 'c' && e.key !== 'C') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (!btn || btn.style.display === 'none') return;
        var ae = document.activeElement;
        if (ae) {
          var tag = ae.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ae.isContentEditable) return;
        }
        e.preventDefault();
        togglePanel();
      });

      setupCraftChatLogger();
      injectFastCraftToggle();

      updateButtonVisibility();
      setInterval(updateButtonVisibility, 500);

      setInterval(fetchInitialPity, PITY_INIT_POLL_MS);
    } catch (err) {
      derror('inject failed', err);
    }
  }

  var fastCraftInjectAttempts = 0;
  function injectFastCraftToggle() {
    if (document.getElementById('fastCraftCheckbox')) return;
    var menu = document.querySelector('#menus #optionsMenu');
    if (!menu) {
      if (fastCraftInjectAttempts++ < 50) setTimeout(injectFastCraftToggle, 200);
      return;
    }
    var label = document.createElement('label');
    label.setAttribute('for', 'fastCraftCheckbox');
    label.textContent = 'Fast Craft:';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = 'fastCraftCheckbox';
    cb.name = 'fastCraftCheckbox';
    cb.checked = fastCraft;
    cb.addEventListener('change', function () { setFastCraft(cb.checked); });
    menu.appendChild(label);
    menu.appendChild(cb);
    menu.appendChild(document.createElement('br'));
  }

  function setupCraftChatLogger() {
    dlog('craft chat listener registered');
    onChatMessage(function (evt) {

      if (!evt) return;
      var msg = String(evt.message || '');

      function scheduleResult(prev, build) {
        if (!craftResult || craftResult.type !== 'pending') return;
        var result = build();
        if (fastCraft) {
          setCraftResult(result);
          return;
        }
        var tokenAtSchedule = craftResultToken;
        setTimeout(function () {
          if (craftResultToken !== tokenAtSchedule) return;
          if (!craftResult || craftResult.type !== 'pending') return;
          setCraftResult(result);
        }, FALL_DURATION_MS);
      }

      var ok = /Crafted\s+(\d+)\b[^()]*\((\d+)\s*left/i.exec(msg);
      if (ok) {
        var gained = parseInt(ok[1], 10);
        dlog('craft success (Desert), crafted ' + gained + ', ' + ok[2] + ' left');
        var prevS = craftResult || {};
        scheduleResult(prevS, function () {
          return {
            type: 'success',
            delta: gained,
            petalIdx: prevS.petalIdx,
            fromRarity: prevS.fromRarity,
            slots: prevS.slots,
          };
        });
        firePityRefresh(prevS.petalIdx, prevS.fromRarity);
        return;
      }

      var lineMulti = /Mass\s*craft[^|]*?Success:\s*(\d+)\s*\|\s*(?:cosumed|consumed):\s*(\d+)/i.exec(msg);
      if (lineMulti) {
        var gained = parseInt(lineMulti[1], 10);
        var consumedMulti = parseInt(lineMulti[2], 10);
        if (gained > 0) {
          dlog('craft success (Line multi), crafted ' + gained);
          var prevS = craftResult || {};
          scheduleResult(prevS, function () {
            return {
              type: 'success',
              delta: gained,
              petalIdx: prevS.petalIdx,
              fromRarity: prevS.fromRarity,
              slots: prevS.slots,
            };
          });
        } else {
          var attemptsMulti = Math.max(1, Math.round(consumedMulti / 5));
          dlog('craft failed (Line multi, 0 gained), consumed ' + consumedMulti + ', ~' + attemptsMulti + ' attempts');
          var prevF = craftResult || {};
          scheduleResult(prevF, function () {
            return {
              type: 'fail',
              attempts: attemptsMulti,
              petalIdx: prevF.petalIdx,
              fromRarity: prevF.fromRarity,
              slots: prevF.slots,
            };
          });
        }
        return;
      }

      if (/^Crafted\s+[A-Za-z]/.test(msg) && !/\(/.test(msg) && !/Mass\s*craft/i.test(msg)) {
        dlog('craft success (Line single), crafted 1');
        var prevS = craftResult || {};
        scheduleResult(prevS, function () {
          return {
            type: 'success',
            delta: 1,
            petalIdx: prevS.petalIdx,
            fromRarity: prevS.fromRarity,
            slots: prevS.slots,
          };
        });
        return;
      }

      var fail = /[Cc]raft[^()]*?fail[^()]*?(\d+)\s*attempt[^()]*\((\d+)\s*left/i.exec(msg);
      if (fail) {
        var attempts = parseInt(fail[1], 10);
        dlog('craft failed (Desert), ' + fail[2] + ' left');

        var prevF = craftResult || {};
        scheduleResult(prevF, function () {
          return {
            type: 'fail',
            attempts: attempts,
            petalIdx: prevF.petalIdx,
            fromRarity: prevF.fromRarity,
            slots: prevF.slots,
          };
        });
        firePityRefresh(prevF.petalIdx, prevF.fromRarity);
        return;
      }

      var lineFail = /Craft\s*failed!?\s*You\s+(?:cosumed|consumed)\s+(\d+)/i.exec(msg);
      if (lineFail) {
        var consumed = parseInt(lineFail[1], 10);

        var attempts = Math.max(1, Math.round(consumed / 5));
        dlog('craft failed (Line), consumed ' + consumed + ', ~' + attempts + ' attempts');
        var prevF = craftResult || {};
        scheduleResult(prevF, function () {
          return {
            type: 'fail',
            attempts: attempts,
            petalIdx: prevF.petalIdx,
            fromRarity: prevF.fromRarity,
            slots: prevF.slots,
          };
        });
        return;
      }

    });
  }

  function togglePanel() {
    if (!panel) return;
    if (panel.style.display === 'none') {
      render();
      panel.style.display = 'flex';
    } else {
      panel.style.display = 'none';
      hoverEntry = null;
      tip.style.display = 'none';
    }
  }

  function clearCraft() {
    craftSlots = [0, 0, 0, 0, 0];
    craftPetalIdx = null;
    craftRarity = null;
  }

  function setCraftResult(result) {
    var t = ++craftResultToken;
    craftResult = result;
    if (panel && panel.style.display !== 'none') render();

    if (result && result.type === 'success') return;
    setTimeout(function () {
      if (craftResultToken === t) {
        craftResult = null;
        if (panel && panel.style.display !== 'none') render();
      }
    }, CRAFT_RESULT_TTL_MS);
  }

  function loadCraft(petalIdx, rarity, owned, shift) {

    if (craftResult && craftResult.type !== 'pending') {
      craftResult = null;
      craftResultToken++;
    }

    if (_simNextOutcome != null) {
      dlog('re-stage cleared pending SimCraft outcome:', _simNextOutcome);
      _simNextOutcome = null;
    }
    if (shift) {
      craftPetalIdx = petalIdx;
      craftRarity = rarity;
      var per = Math.floor(owned / 5);
      var rem = owned - per * 5;
      var counts = [per, per, per, per, per];
      var idxs = [0, 1, 2, 3, 4];
      for (var i = idxs.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = idxs[i]; idxs[i] = idxs[j]; idxs[j] = t;
      }
      for (var k = 0; k < rem; k++) counts[idxs[k]]++;
      craftSlots = counts;
      return;
    }

    var sameTarget = craftPetalIdx === petalIdx && craftRarity === rarity && craftPetalIdx != null;
    if (sameTarget) {
      var staged = 0;
      for (var s = 0; s < 5; s++) staged += craftSlots[s];
      if (owned - staged >= 5) {
        for (var ii = 0; ii < 5; ii++) craftSlots[ii]++;
      }
    } else {
      craftPetalIdx = petalIdx;
      craftRarity = rarity;
      craftSlots = [1, 1, 1, 1, 1];
    }
  }

  function doCraft() {
    if (craftPetalIdx == null || craftRarity == null) return;
    var s = state;
    if (!s) return;
    var total = 0;
    for (var i = 0; i < 5; i++) total += craftSlots[i];
    if (total === 0) return;

    if (_simNextOutcome != null) {
      var simOutcome = _simNextOutcome === 'roll' ? undefined : _simNextOutcome;
      _simNextOutcome = null;
      var sim = _runSimulation(craftPetalIdx, craftRarity, total, simOutcome);
      dlog('Craft Simulation Results:', sim);
      return;
    }
    var tierName = (s.tiers[craftRarity] || {}).name || '';
    var petalName = getCraftPetalName(s, craftPetalIdx);

    var lobbyForCraft = detectLobby(s);
    var craftPetalToken = petalName;
    if (lobbyForCraft && lobbyForCraft.name === 'Line Maze' &&
        PETAL_NAME_SHORTHAND[petalName]) {
      craftPetalToken = PETAL_NAME_SHORTHAND[petalName];
    }
    sendChatMessage('/craft ' + tierName + ' ' + craftPetalToken + ' ' + total);

    orbitLastPositions = [];
    setCraftResult({
      type: 'pending',
      delta: total,
      petalIdx: craftPetalIdx,
      fromRarity: craftRarity,
      slots: craftSlots.slice(),
      startedAt: performance.now(),
    });

    var snapshot = JSON.stringify(s.inventory);
    var deadline = Date.now() + 3000;
    var poll = setInterval(function () {
      var st = state;
      var fresh = JSON.stringify(st && st.inventory);
      if (fresh !== snapshot || Date.now() > deadline) {
        clearInterval(poll);
        clearCraft();

        if (panel && panel.style.display !== 'none' && !craftResult) {
          render();
        }
      }
    }, 100);
  }

  var STAR_CENTER = { x: 130, y: 100 };
  var STAR_OUTER = 65;
  var STAR_INNER = 48;
  var STAR_POINTS = [];
  for (var _sk = 0; _sk < 10; _sk++) {
    var _sa = (-Math.PI / 2) + _sk * (Math.PI / 5);
    var _sr = (_sk % 2 === 0) ? STAR_OUTER : STAR_INNER;
    STAR_POINTS.push({
      x: STAR_CENTER.x + _sr * Math.cos(_sa),
      y: STAR_CENTER.y + _sr * Math.sin(_sa),
    });
  }

  function starPoint(progress) {
    var t = (progress - Math.floor(progress)) * 10;
    var i0 = Math.floor(t) % 10;
    var localT = t - Math.floor(t);
    var p0 = STAR_POINTS[(i0 + 9) % 10];
    var p1 = STAR_POINTS[i0];
    var p2 = STAR_POINTS[(i0 + 1) % 10];
    var p3 = STAR_POINTS[(i0 + 2) % 10];
    var t2 = localT * localT;
    var t3 = t2 * localT;
    return {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * localT + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * localT + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    };
  }

  var orbitRAF = null;
  var orbitLastPositions = [];

  var orbitCurrentProgress = 0;

  var easeRAF = null;
  function stopOrbitAnimation() {
    if (orbitRAF) cancelAnimationFrame(orbitRAF);
    orbitRAF = null;
  }
  function stopEaseAnimation() {
    if (easeRAF) cancelAnimationFrame(easeRAF);
    easeRAF = null;
  }

  var ORBIT_DURATION_MS = 1800;

  var FALL_DURATION_MS = 333;

  var EASE_DURATION_MS = 333;

  var SUCCESS_SPIRAL_SWEEP = Math.PI / 2;
  function startOrbitAnimation(container) {
    stopOrbitAnimation();

    if (fastCraft) { orbitRAF = null; return; }

    var slots = container.querySelectorAll('[data-craft-orbit]');
    if (!slots.length) {
      orbitRAF = null;
      return;
    }
    var start = performance.now();
    function tick(now) {
      if (!craftResult || craftResult.type !== 'pending') {
        orbitRAF = null;
        return;
      }
      var progress = ((now - start) / ORBIT_DURATION_MS) % 1;
      orbitCurrentProgress = progress;
      for (var i = 0; i < slots.length; i++) {
        var p = (progress + i / 5) % 1;
        var pt = starPoint(p);
        var tx = pt.x - 25, ty = pt.y - 25;
        slots[i].style.transform = 'translate(' + tx + 'px,' + ty + 'px)';

        orbitLastPositions[i] = { x: tx, y: ty };
      }
      orbitRAF = requestAnimationFrame(tick);
    }
    orbitRAF = requestAnimationFrame(tick);
  }

  function mixWithWhite(hex, amount) {
    var m = /^#?([\da-fA-F]{6})$/.exec(hex || '');
    if (!m) return '#ffffff';
    var n = parseInt(m[1], 16);
    var r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    r = Math.round(r + (255 - r) * amount);
    g = Math.round(g + (255 - g) * amount);
    b = Math.round(b + (255 - b) * amount);
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  function startEaseAnimation(container, type) {
    stopEaseAnimation();
    if (!craftResult || (craftResult.type !== 'success' && craftResult.type !== 'fail')) {
      return;
    }
    var slots = container.querySelectorAll('[data-craft-ease]');
    if (!slots.length) {

      craftResult._easeComplete = true;
      return;
    }
    var startTime = craftResult._easeStartTime;
    if (!startTime) {
      startTime = performance.now();
      craftResult._easeStartTime = startTime;
    }

    var slotProgresses = [];
    for (var i = 0; i < 5; i++) {
      slotProgresses[i] = (orbitCurrentProgress + i / 5) % 1;
    }
    var tokenAtSchedule = craftResultToken;
    function tick(now) {
      if (craftResultToken !== tokenAtSchedule) { easeRAF = null; return; }
      if (!craftResult || (craftResult.type !== 'success' && craftResult.type !== 'fail')) {
        easeRAF = null;
        return;
      }
      var p = Math.min(1, (now - startTime) / EASE_DURATION_MS);
      var inv = 1 - p;
      var eased = 1 - inv * inv;
      if (type === 'fail') {
        for (var i = 0; i < slots.length; i++) {
          var pStart = slotProgresses[i];
          var pCurrent = (pStart + 0.2 * eased) % 1;
          var pt = starPoint(pCurrent);
          slots[i].style.transform = 'translate(' + (pt.x - 25) + 'px,' + (pt.y - 25) + 'px)';
        }
      } else {

        for (var i = 0; i < slots.length; i++) {
          var sp = orbitLastPositions[i];
          if (!sp) continue;
          var rx = sp.x + 25 - STAR_CENTER.x;
          var ry = sp.y + 25 - STAR_CENTER.y;
          var startAngle = Math.atan2(ry, rx);
          var startRadius = Math.sqrt(rx * rx + ry * ry);
          var angle = startAngle + SUCCESS_SPIRAL_SWEEP * eased;
          var radius = startRadius * (1 - eased);
          var x = STAR_CENTER.x + radius * Math.cos(angle) - 25;
          var y = STAR_CENTER.y + radius * Math.sin(angle) - 25;
          slots[i].style.transform = 'translate(' + x + 'px,' + y + 'px)';
        }
      }
      if (p < 1) {
        easeRAF = requestAnimationFrame(tick);
      } else {
        easeRAF = null;
        craftResult._easeComplete = true;
        if (panel && panel.style.display !== 'none') render();
      }
    }
    easeRAF = requestAnimationFrame(tick);
  }

  function spawnSuccessBurst(container, cx, cy, baseColor) {
    var N = 28;
    var c0 = baseColor || '#ffd860';
    var COLORS = [c0, mixWithWhite(c0, 0.35), mixWithWhite(c0, 0.65), '#ffffff'];
    var duration = 900;
    for (var i = 0; i < N; i++) {
      var size = 3 + Math.random() * 5;
      var angle = (i / N) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      var dist = 50 + Math.random() * 60;
      var dx = Math.cos(angle) * dist;
      var dy = Math.sin(angle) * dist;
      var color = COLORS[Math.floor(Math.random() * COLORS.length)];
      var p = document.createElement('div');
      p.style.cssText =
        'position:absolute;width:' + size + 'px;height:' + size + 'px;' +
        'background:' + color + ';border-radius:50%;pointer-events:none;' +
        'left:' + (cx - size / 2) + 'px;top:' + (cy - size / 2) + 'px;' +
        'opacity:1;will-change:transform,opacity;' +
        'transition:transform ' + duration + 'ms cubic-bezier(0.12,0.72,0.28,1),' +
                   'opacity ' + duration + 'ms ease-out;';
      container.appendChild(p);
      (function (particle, tx, ty) {
        requestAnimationFrame(function () {
          particle.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
          particle.style.opacity = '0';
        });
        setTimeout(function () {
          if (particle.parentNode) particle.parentNode.removeChild(particle);
        }, duration + 50);
      })(p, dx, dy);
    }
  }

  function renderCraftArea(getIcon) {
    var box = document.createElement('div');

    box.style.cssText =
      'position:relative;height:200px;background:transparent;' +
      'margin-bottom:8px;flex:0 0 auto;overflow:hidden;' +
      'border-bottom:1px solid #000;';

    var detected = detectLobby(state);
    if (detected && detected.short) {
      var chip = document.createElement('div');
      chip.textContent = 'Current rarity set: ' + detected.short;
      chip.style.cssText =
        'position:absolute;top:6px;right:8px;' +
        'background:rgba(0,0,0,0.28);color:rgba(255,255,255,0.92);' +
        'font:bold 11px Ubuntu,sans-serif;' +
        'padding:2px 7px;border-radius:4px;pointer-events:none;';
      box.appendChild(chip);
    }

    var SLOT = 50;
    var slotPositions = [
      { left: 105, top: 10  },
      { left: 167, top: 55  },
      { left: 143, top: 128 },
      { left: 67,  top: 128 },
      { left: 43,  top: 55  },
    ];
    var EMPTY_BG = '#a06d3e';

    var hasSnap = craftResult && Array.isArray(craftResult.slots);
    var snapSlots = hasSnap ? craftResult.slots : craftSlots;
    var snapPetalIdx = hasSnap ? craftResult.petalIdx : craftPetalIdx;
    var snapRarity = hasSnap ? craftResult.fromRarity : craftRarity;

    var orbiting = craftResult && craftResult.type === 'pending';
    var merging = craftResult && craftResult.type === 'success';
    var failed = craftResult && craftResult.type === 'fail';

    var easeComplete = (merging || failed) && craftResult._easeComplete;
    var easing = (merging || failed) && !easeComplete && !fastCraft;
    if ((merging || failed) && fastCraft && !craftResult._easeComplete) {

      craftResult._easeComplete = true;
      easeComplete = true;
      easing = false;
    }
    var firstFinalFrame = merging && easeComplete && !craftResult._mergeStarted;
    if (firstFinalFrame) craftResult._mergeStarted = true;

    if (!merging || easing) {
      for (var i = 0; i < 5; i++) {
        var slot = document.createElement('div');

        var filled = !failed && snapSlots[i] > 0 && snapPetalIdx != null && snapRarity != null;
        var clickable = filled && !craftResult;

        var initLeft = slotPositions[i].left, initTop = slotPositions[i].top;
        if (easing && orbitLastPositions[i]) {
          initLeft = orbitLastPositions[i].x;
          initTop = orbitLastPositions[i].y;
        }
        slot.style.cssText =
          'position:absolute;left:0;top:0;transition:none;' +
          'width:' + SLOT + 'px;height:' + SLOT + 'px;background:' + EMPTY_BG + ';' +
          'border-radius:8px;cursor:' + (clickable ? 'pointer' : 'default') + ';' +
          'transform:translate(' + initLeft + 'px,' + initTop + 'px);' +
          ((orbiting && filled) || easing ? 'will-change:transform;' : '');
        if (orbiting && filled) slot.setAttribute('data-craft-orbit', String(i));

        if (easing) slot.setAttribute('data-craft-ease', String(i));

        if (filled) {
          var sc = document.createElement('canvas');
          sc.width = SLOT; sc.height = SLOT;
          sc.style.cssText = 'width:' + SLOT + 'px;height:' + SLOT + 'px;display:block;';
          var sctx = sc.getContext('2d');
          try {
            sctx.drawImage(getIcon(snapPetalIdx, snapRarity), 0, 0, SLOT, SLOT);
          } catch (_) {}
          sctx.fillStyle = '#fff';
          sctx.strokeStyle = '#000';
          sctx.lineWidth = 2;
          sctx.font = 'bold 12px Ubuntu';
          sctx.textAlign = 'right';
          sctx.textBaseline = 'top';
          var t = 'x' + snapSlots[i];
          sctx.strokeText(t, SLOT - 4, 4);
          sctx.fillText(t, SLOT - 4, 4);
          slot.appendChild(sc);

          if (clickable) {
            slot.addEventListener('click', function () {

              clearCraft();
              render();
            });
          }

          (function (pi, ri, el) {
            el.addEventListener('mouseenter', function () {
              hoverEntry = { index: pi, rarity: ri };
              showTooltip(el);
            });
            el.addEventListener('mouseleave', function () {
              if (hoverEntry && hoverEntry.index === pi && hoverEntry.rarity === ri) {
                hoverEntry = null;
                tip.style.display = 'none';
              }
            });
          })(snapPetalIdx, snapRarity, slot);
        }

        box.appendChild(slot);
      }
    }

    if (merging && easeComplete && snapPetalIdx != null && snapRarity != null) {
      var resultRarity = snapRarity + 1;
      var st = state;
      var resultTier = st && st.tiers && st.tiers[resultRarity];
      if (resultTier) {
        var centerSlot = document.createElement('div');
        centerSlot.style.cssText =
          'position:absolute;' +
          'left:' + (STAR_CENTER.x - SLOT / 2) + 'px;' +
          'top:' + (STAR_CENTER.y - SLOT / 2) + 'px;' +
          'width:' + SLOT + 'px;height:' + SLOT + 'px;background:' + EMPTY_BG + ';' +
          'border-radius:8px;cursor:pointer;';

        centerSlot.addEventListener('click', function () {
          craftResult = null;
          craftResultToken++;
          clearCraft();
          render();
        });
        var csc = document.createElement('canvas');
        csc.width = SLOT; csc.height = SLOT;
        csc.style.cssText = 'width:' + SLOT + 'px;height:' + SLOT + 'px;display:block;';
        var csctx = csc.getContext('2d');
        try {
          csctx.drawImage(getIcon(snapPetalIdx, resultRarity), 0, 0, SLOT, SLOT);
        } catch (_) {}
        csctx.fillStyle = '#fff';
        csctx.strokeStyle = '#000';
        csctx.lineWidth = 2;
        csctx.font = 'bold 12px Ubuntu';
        csctx.textAlign = 'right';
        csctx.textBaseline = 'top';
        var cct = 'x' + craftResult.delta;
        csctx.strokeText(cct, SLOT - 4, 4);
        csctx.fillText(cct, SLOT - 4, 4);
        centerSlot.appendChild(csc);

        (function (pi, ri, el) {
          el.addEventListener('mouseenter', function () {
            hoverEntry = { index: pi, rarity: ri };
            showTooltip(el);
          });
          el.addEventListener('mouseleave', function () {
            if (hoverEntry && hoverEntry.index === pi && hoverEntry.rarity === ri) {
              hoverEntry = null;
              tip.style.display = 'none';
            }
          });
        })(snapPetalIdx, resultRarity, centerSlot);
        box.appendChild(centerSlot);
      }
    }

    if (firstFinalFrame) {
      var burstStateRef = state;
      var burstTier = burstStateRef && burstStateRef.tiers && burstStateRef.tiers[snapRarity + 1];
      var burstColor = (burstTier && burstTier.color) || '#ffd860';
      spawnSuccessBurst(box, STAR_CENTER.x, STAR_CENTER.y, burstColor);
    }

    if (orbiting) {
      startOrbitAnimation(box);
      stopEaseAnimation();
    } else if (easing) {
      stopOrbitAnimation();
      startEaseAnimation(box, merging ? 'success' : 'fail');
    } else {
      stopOrbitAnimation();
      stopEaseAnimation();
    }

    var craftBtn = document.createElement('button');
    craftBtn.textContent = 'Craft';
    craftBtn.style.cssText =
      'position:absolute;left:260px;top:80px;background:#cfcfcf;' +
      'border:2px solid #000;border-radius:6px;padding:4px 18px;' +
      'font-family:Ubuntu,sans-serif;font-weight:bold;font-size:14px;' +
      'cursor:pointer;color:#000;';
    craftBtn.addEventListener('click', doCraft);
    box.appendChild(craftBtn);

    var rateText = '?';
    if (craftRarity != null) {
      var st = state;

      var nextTier = st && st.tiers && st.tiers[craftRarity + 1];
      var tn = nextTier && nextTier.name;
      if (tn) {
        var pname = craftPetalIdx != null ? getCraftPetalName(st, craftPetalIdx) : null;
        var pityRate = pname && pityRates[tn] && pityRates[tn][pname];
        if (pityRate != null) {
          rateText = String(pityRate);
        } else {
          var rate = getCraftRate(tn);
          if (rate != null) rateText = String(rate);
        }
      }
    }
    var sr = document.createElement('div');
    sr.textContent = rateText + '% success rate';
    sr.style.cssText =
      'position:absolute;left:245px;top:125px;color:#fff;font-weight:bold;' +
      'font-size:13px;font-family:Ubuntu,sans-serif;' +
      'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;';
    box.appendChild(sr);

    if (craftResult) {
      var color, text;
      if (craftResult.type === 'success') {
        color = '#4ade80';
        text = 'Success. +' + craftResult.delta;
      } else if (craftResult.type === 'fail') {
        color = '#ff6b6b';
        text = 'Failed after ' + craftResult.attempts + ' attempt(s).';
      } else {
        color = '#fff';
        text = 'Crafting...';
      }
      var rDiv = document.createElement('div');
      rDiv.textContent = text;
      rDiv.style.cssText =
        'position:absolute;left:370px;top:90px;color:' + color + ';' +
        'font-weight:bold;font-size:20px;font-family:Ubuntu,sans-serif;' +
        'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;';
      box.appendChild(rDiv);
    }

    return box;
  }

  function render() {
    try {
      var s = state;
      var getIcon = getPetalIcon;

      var oldWrap = document.getElementById('craftMenuGridWrapper');
      var savedScrollTop = oldWrap ? oldWrap.scrollTop : 0;
      var savedScrollLeft = oldWrap ? oldWrap.scrollLeft : 0;

      panel.innerHTML = '';

      var headerBar = document.createElement('div');
      headerBar.style.cssText =
        'display:flex;align-items:center;gap:8px;' +
        'margin-bottom:6px;flex:0 0 auto;';

      var title = document.createElement('div');
      title.textContent = 'Crafting';
      title.style.cssText = 'font-weight:bold;font-size:14px;flex:0 0 auto;';
      headerBar.appendChild(title);

      var searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search petals...';
      searchInput.value = searchQuery;
      searchInput.id = 'craftMenuSearch';
      searchInput.style.cssText =
        'flex:1 1 auto;max-width:240px;background:#222;color:#fff;' +
        'border:1px solid #555;border-radius:4px;padding:3px 6px;' +
        'font-family:Ubuntu,sans-serif;font-size:12px;outline:none;';
      searchInput.addEventListener('input', function () {
        searchQuery = searchInput.value;

        var pos = searchInput.selectionStart;
        render();
        var fresh = document.getElementById('craftMenuSearch');
        if (fresh) {
          fresh.focus();
          if (typeof pos === 'number') {
            try { fresh.setSelectionRange(pos, pos); } catch (_) {}
          }
        }
      });

      searchInput.addEventListener('keydown', function (e) { e.stopPropagation(); });
      headerBar.appendChild(searchInput);

      var spacer = document.createElement('div');
      spacer.style.cssText = 'flex:1 1 auto;';
      headerBar.appendChild(spacer);

      fsBtn = document.createElement('button');
      fsBtn.innerHTML = isFullscreen ? COLLAPSE_SVG : EXPAND_SVG;
      fsBtn.title = isFullscreen ? 'Return to compact view' : 'Show all rarities at once';
      fsBtn.setAttribute('aria-label', isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen');
      fsBtn.style.cssText =
        'background:transparent;border:1px solid rgba(255,255,255,0.3);' +
        'color:#fff;cursor:pointer;border-radius:4px;padding:3px 5px;' +
        'display:inline-flex;align-items:center;justify-content:center;' +
        'line-height:0;';
      fsBtn.addEventListener('click', toggleFullscreen);
      headerBar.appendChild(fsBtn);

      panel.appendChild(headerBar);

      if (!s || !s.inventory || !s.tiers || !s.petalConfigs || typeof getIcon !== 'function') {
        var e = document.createElement('div');
        e.textContent = 'Inventory is empty.';
        e.style.cssText =
          'flex:1 1 auto;display:flex;align-items:center;justify-content:center;' +
          'color:#fff;font-size:16px;font-weight:bold;' +
          'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;';
        panel.appendChild(e);
        return;
      }

      fetchCraftRates();

      panel.appendChild(renderCraftArea(getIcon));

      var petalIdxSet = new Set();
      Object.keys(s.inventory).forEach(function (tn) {
        var petals = s.inventory[tn] || {};
        Object.keys(petals).forEach(function (pid) {
          if (petals[pid] > 0) petalIdxSet.add(Number(pid));
        });
      });
      var petalIndices = Array.from(petalIdxSet);
      petalIndices.sort(function (a, b) {
        var an = (s.petalConfigs[a] || {}).name || '';
        var bn = (s.petalConfigs[b] || {}).name || '';
        return an.localeCompare(bn);
      });

      var emptyInventory = !petalIndices.length;

      if (searchQuery) {
        var q = searchQuery.toLowerCase();
        petalIndices = petalIndices.filter(function (idx) {
          var name = ((s.petalConfigs[idx] || {}).name || '').toLowerCase();
          return name.indexOf(q) !== -1;
        });
      }

      if (!petalIndices.length) {
        var emp = document.createElement('div');
        emp.textContent = emptyInventory ? 'Inventory is empty.' : 'No petals match "' + searchQuery + '".';
        emp.style.cssText =
          'flex:1 1 auto;display:flex;align-items:center;justify-content:center;' +
          'color:#fff;font-size:16px;font-weight:bold;' +
          'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;';
        panel.appendChild(emp);
        return;
      }

      var nRarities = s.tiers.length;
      var SIZE = computeIconSize(nRarities);

      var gridWrapper = document.createElement('div');
      gridWrapper.id = 'craftMenuGridWrapper';
      gridWrapper.style.cssText = 'flex:1 1 auto;overflow-x:scroll;overflow-y:auto;min-height:0;';
      panel.appendChild(gridWrapper);

      var grid = document.createElement('div');
      grid.style.cssText =
        'display:grid;grid-template-columns:repeat(' + nRarities + ',' + SIZE + 'px);' +
        'gap:5px;align-items:center;width:max-content;';
      gridWrapper.appendChild(grid);

      s.tiers.forEach(function (tier) {
        var th = document.createElement('div');
        th.textContent = tier.name || '';
        th.style.cssText =
          'font-size:10px;color:' + (tier.color || '#fff') + ';' +
          'font-weight:bold;text-align:center;' +
          'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;' +
          'text-shadow:1px 1px 0 #000,-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;';
        grid.appendChild(th);
      });

      var stagedTotal = 0;
      for (var st = 0; st < 5; st++) stagedTotal += craftSlots[st];

      petalIndices.forEach(function (petalIdx) {
        s.tiers.forEach(function (tier, rarIdx) {
          var owned = (s.inventory[tier.name] || {})[petalIdx] || 0;
          var staged = (petalIdx === craftPetalIdx && rarIdx === craftRarity) ? stagedTotal : 0;
          var displayed = owned - staged;
          if (displayed > 0) {
            var icon = document.createElement('canvas');
            icon.width = SIZE;
            icon.height = SIZE;

            var canCraft = displayed >= 5;
            icon.style.cssText =
              'width:' + SIZE + 'px;height:' + SIZE + 'px;' +
              'cursor:' + (canCraft ? 'pointer' : 'default') + ';' +
              (canCraft ? '' : 'filter:grayscale(1);opacity:0.55;');
            var ctx = icon.getContext('2d');
            try {
              var src = getIcon(petalIdx, rarIdx);
              ctx.drawImage(src, 0, 0, SIZE, SIZE);
            } catch (_) {}
            if (displayed > 1) {
              ctx.fillStyle = '#fff';
              ctx.strokeStyle = '#000';
              ctx.lineWidth = 2;
              ctx.font = 'bold ' + Math.round(SIZE * 0.25) + 'px Ubuntu';
              ctx.textAlign = 'right';
              ctx.textBaseline = 'top';
              var txt = displayed > 1000
                ? 'x' + (displayed / 1000).toFixed(1) + 'k'
                : 'x' + displayed;
              ctx.strokeText(txt, SIZE - 4, 4);
              ctx.fillText(txt, SIZE - 4, 4);
            }
            (function (pi, ri, ownedCount, canClick) {
              icon.addEventListener('mouseenter', function () {
                hoverEntry = { index: pi, rarity: ri };
                showTooltip(icon);
              });
              icon.addEventListener('mouseleave', function () {
                if (hoverEntry && hoverEntry.index === pi && hoverEntry.rarity === ri) {
                  hoverEntry = null;
                  tip.style.display = 'none';
                }
              });
              if (canClick) {
                icon.addEventListener('click', function (ev) {

                  loadCraft(pi, ri, ownedCount, !!ev.shiftKey);
                  render();
                });
              }
            })(petalIdx, rarIdx, owned, canCraft);
            grid.appendChild(icon);
          } else {
            var ph = document.createElement('div');
            ph.style.cssText =
              'width:' + SIZE + 'px;height:' + SIZE + 'px;' +
              'background:#a06d3e;border-radius:6px;' +
              'border:1px solid rgba(0,0,0,0.1);';
            grid.appendChild(ph);
          }
        });
      });

      gridWrapper.scrollTop = savedScrollTop;
      gridWrapper.scrollLeft = savedScrollLeft;

      if (isFullscreen) {
        var gridWidth = grid.offsetWidth;
        var panelChrome = 8 * 2 + 4 * 2 + 12;
        var desired = gridWidth + panelChrome;
        if (desired < 632) desired = 632;
        var maxWidth = window.innerWidth * 0.95;
        if (desired > maxWidth) desired = maxWidth;
        panel.style.width = desired + 'px';
        panel.style.left = ((window.innerWidth - desired) / 2) + 'px';
      }
    } catch (err) {
      derror('render failed', err);
    }
  }

  function showTooltip(target) {
    try {
      if (!hoverEntry) return;
      var fn = petalTooltip;
      if (typeof fn !== 'function') return;
      var img = fn(hoverEntry.index, hoverEntry.rarity);
      if (!img) return;
      var bw = 320;
      var bh = Math.round(bw * img.height / img.width);
      tipCanvas.width = img.width;
      tipCanvas.height = img.height;
      var tctx = tipCanvas.getContext('2d');
      tctx.clearRect(0, 0, img.width, img.height);
      tctx.drawImage(img, 0, 0);
      tipCanvas.style.width = bw + 'px';
      tipCanvas.style.height = bh + 'px';
      tip.style.display = 'block';

      var rect = null;
      if (target && target.getBoundingClientRect) {
        rect = target.getBoundingClientRect();
      } else {
        var wrapper = document.getElementById('craftMenuGridWrapper');
        if (wrapper) rect = wrapper.getBoundingClientRect();
      }
      if (rect) {
        var tw = tip.offsetWidth || bw;
        var th = tip.offsetHeight || bh;
        var x = rect.right + 8;
        if (x + tw > window.innerWidth - 2) x = rect.left - tw - 8;
        if (x < 2) x = 2;
        var y = rect.top;
        if (y + th > window.innerHeight - 2) y = window.innerHeight - th - 2;
        if (y < 2) y = 2;
        tip.style.left = x + 'px';
        tip.style.top = y + 'px';
      }
    } catch (err) {
      derror('tooltip show failed', err);
    }
  }

  var _debugMode = false;

  var _simNextOutcome = null;

  function CraftDebug(on) {
    _debugMode = !!on;
    if (_debugMode) {

      globalThis.SimCraft = SimCraft;
    } else {
      _simNextOutcome = null;
      try { delete globalThis.SimCraft; } catch (_) { globalThis.SimCraft = undefined; }
    }
    return _debugMode;
  }

  function _runSimulation(petalIdx, rarityIdx, count, outcome) {
    var s = state;
    var pname = (s && s.petalConfigs && s.petalConfigs[petalIdx]) ? s.petalConfigs[petalIdx].name : null;
    var targetTier = s.tiers[rarityIdx + 1];
    var targetTierName = targetTier ? targetTier.name : null;
    var forced = outcome === 'success' || outcome === 'fail';
    var attemptsCount = Math.max(1, Math.floor(count / 5));
    var pity = targetTierName && pityRates[targetTierName] && pityRates[targetTierName][pname];
    var rateUsed = pity != null ? pity : (targetTierName ? getCraftRate(targetTierName) : null);
    if (rateUsed == null) rateUsed = 50;
    var p = rateUsed / 100;
    var successes = 0;
    if (forced) {
      if (outcome === 'success') successes = Math.max(1, Math.round(attemptsCount * p));
    } else {
      var pAnySuccess = p < 1e-10
        ? Math.min(1, attemptsCount * p)
        : 1 - Math.pow(1 - p, attemptsCount);
      if (Math.random() < pAnySuccess) {
        var expected = attemptsCount * p;
        successes = Math.max(1, Math.round(expected + (Math.random() - 0.5) * Math.sqrt(expected + 1)));
        if (successes > attemptsCount) successes = attemptsCount;
        outcome = 'success';
        dlog('Simulated craft: succeeded.');
      } else {
        outcome = 'fail';
        dlog('Simulated craft: failed in ' + attemptsCount + ' attempt(s).');
      }
    }
    var counts = craftSlots.slice();
    orbitLastPositions = [];
    setCraftResult({
      type: 'pending',
      delta: count,
      petalIdx: petalIdx,
      fromRarity: rarityIdx,
      slots: counts,
      startedAt: performance.now(),
    });
    clearCraft();
    var token = craftResultToken;
    setTimeout(function () {
      if (craftResultToken !== token) return;
      if (!craftResult || craftResult.type !== 'pending') return;
      if (outcome === 'fail') {
        setCraftResult({ type: 'fail', attempts: attemptsCount, petalIdx: petalIdx, fromRarity: rarityIdx, slots: counts });
      } else {
        setCraftResult({ type: 'success', delta: successes, petalIdx: petalIdx, fromRarity: rarityIdx, slots: counts });
      }
    }, FALL_DURATION_MS);
    return { outcome: outcome, forced: forced, rate: rateUsed, successes: successes, attempts: attemptsCount, targetTier: targetTierName };
  }

  function SimCraft(petalName, rarityName, count) {
    if (!_debugMode) {
      console.warn('[CraftMenu] SimCraft requires debug mode. Call CraftDebug(true) first.');
      return null;
    }
    var s = state;
    if (!s || !s.petalConfigs || !s.tiers) {
      console.warn('[CraftMenu] SimCraft: no game state'); return null;
    }
    count = +count || 5;

    var outcome = null;
    var doAutoCraft = true;
    for (var ai = 3; ai < arguments.length; ai++) {
      var v = arguments[ai];
      if (typeof v === 'boolean') {
        doAutoCraft = v;
      } else if (typeof v === 'string') {
        var low = v.toLowerCase();
        if (low === 'true') doAutoCraft = true;
        else if (low === 'false') doAutoCraft = false;
        else if (low === 'success' || low === 'fail') outcome = low;
      }
    }

    var petalIdx = -1;
    for (var i = 0; i < s.petalConfigs.length; i++) {
      if (s.petalConfigs[i] && s.petalConfigs[i].name === petalName) { petalIdx = i; break; }
    }
    if (petalIdx < 0) {
      console.warn('[CraftMenu] SimCraft: petal not found:', petalName); return null;
    }

    var rarityIdx = -1;
    for (var j = 0; j < s.tiers.length; j++) {
      if (s.tiers[j] && s.tiers[j].name === rarityName) { rarityIdx = j; break; }
    }
    if (rarityIdx < 0) {
      console.warn('[CraftMenu] SimCraft: rarity not found:', rarityName); return null;
    }

    var per = Math.floor(count / 5);
    var rem = count - per * 5;
    var counts = [per, per, per, per, per];
    for (var k = 0; k < rem; k++) counts[k]++;
    craftSlots = counts.slice();
    craftPetalIdx = petalIdx;
    craftRarity = rarityIdx;

    if (!doAutoCraft) {

      _simNextOutcome = (outcome === 'success' || outcome === 'fail') ? outcome : 'roll';
      if (panel && panel.style.display === 'none') panel.style.display = 'flex';
      render();
      dlog('SimCraft loaded (' + petalName + ', ' + rarityName + ', ' + count + ')');
      return {
        petalName: petalName,
        rarityName: rarityName,
        count: count,
        staged: true,
        autoCraft: false,
        pendingOutcome: _simNextOutcome,
      };
    }

    _simNextOutcome = null;
    var sim = _runSimulation(petalIdx, rarityIdx, count, outcome);
    if (panel && panel.style.display === 'none') panel.style.display = 'flex';
    render();
    dlog('SimCraft started:', petalName, rarityName, 'count=' + count, 'outcome=' + sim.outcome);
    return {
      petalName: petalName,
      rarityName: rarityName,
      targetTier: sim.targetTier,
      count: count,
      outcome: sim.outcome,
      forced: sim.forced,
      rate: sim.rate,
      successes: sim.successes,
      attempts: sim.attempts,
      autoCraft: true,
    };
  }

  globalThis.CraftDebug = CraftDebug;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
