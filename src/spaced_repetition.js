/**
 * Spaced Repetition utility for xplainer flashcards.
 *
 * Modified Leitner box system:
 *   - 5 boxes (0-4): box 0 = new/struggling, box 4 = mastered
 *   - Correct → box + 1 (max 4)
 *   - Wrong → box - 2 (min 0)
 *   - Priority: lower box = asked sooner; within same box, lower streak first
 *
 * Persistence: localStorage keyed by username + deck hash.
 * Attaches to window.Xplainer.sr namespace.
 */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (!window.Xplainer) window.Xplainer = {};
  if (window.Xplainer.sr) return; // idempotent

  const STORAGE_USER_KEY = "xplainer_user";
  const STORAGE_PREFIX = "xplainer_sr_";
  const MAX_BOX = 4;
  const MASTERY_BOX = 2;

  // --- Hashing ---

  /** djb2 string hash → unsigned 32-bit integer as hex string. */
  function hashString(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16);
  }

  /** Deck ID: hash of all card front texts sorted + count. */
  function deckId(cards) {
    if (!Array.isArray(cards) || !cards.length) return "empty";
    const fronts = cards.map(function (c) {
      return String(c.front || "").trim().toLowerCase();
    });
    fronts.sort();
    return "d" + hashString(fronts.join("\x00") + "\x00" + cards.length);
  }

  /** Card ID: hash of front text (trimmed, lowercased). */
  function cardId(frontText) {
    return "c" + hashString(String(frontText || "").trim().toLowerCase());
  }

  // --- User management ---

  function getUser() {
    try { return localStorage.getItem(STORAGE_USER_KEY) || null; }
    catch (e) { return null; }
  }

  function setUser(name) {
    try { localStorage.setItem(STORAGE_USER_KEY, String(name).trim()); }
    catch (e) { /* storage full or blocked */ }
  }

  function clearUser() {
    try { localStorage.removeItem(STORAGE_USER_KEY); }
    catch (e) { /* ignore */ }
  }

  // --- Data access ---

  function _storageKey(user) {
    return STORAGE_PREFIX + String(user).trim().toLowerCase();
  }

  /** Load all SR data for a user. Returns { [deckId]: { [cardId]: cardData } }. */
  function loadUserData(user) {
    if (!user) return {};
    try {
      const raw = localStorage.getItem(_storageKey(user));
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  /** Save all SR data for a user. */
  function saveUserData(user, data) {
    if (!user) return;
    try {
      localStorage.setItem(_storageKey(user), JSON.stringify(data));
    } catch (e) { /* storage full */ }
  }

  /** Get deck data for a specific deck. Returns { [cardId]: cardData }. */
  function getDeckData(user, deck) {
    var all = loadUserData(user);
    return all[deck] || {};
  }

  /** Save deck data, merging into existing user data. */
  function saveDeckData(user, deck, deckData) {
    var all = loadUserData(user);
    all[deck] = deckData;
    saveUserData(user, all);
  }

  // --- Card data helpers ---

  function emptyCardData() {
    return { box: 0, streak: 0, attempts: 0, correct: 0, lastSeen: 0 };
  }

  function getCardData(deckData, cid) {
    return deckData[cid] || emptyCardData();
  }

  // --- Algorithm ---

  /**
   * Record an answer and return updated card data.
   * rating: 0=wrong, 1=partial, 2=correct. Legacy boolean also accepted.
   * Does NOT mutate the input — returns a new object.
   */
  function recordAnswer(cardData, rating) {
    // Normalize legacy boolean
    if (rating === true) rating = 2;
    else if (rating === false) rating = 0;
    else rating = Math.max(0, Math.min(2, Math.round(Number(rating) || 0)));

    var d = Object.assign({}, cardData || emptyCardData());
    d.attempts += 1;
    d.lastSeen = Math.floor(Date.now() / 1000);
    if (rating >= 2) {
      // Correct: advance box, build streak
      d.correct += 1;
      d.streak += 1;
      d.box = Math.min(d.box + 1, MAX_BOX);
    } else if (rating === 1) {
      // Partial: box stays, streak resets (you sort of knew it)
      d.streak = 0;
    } else {
      // Wrong: box drops, streak resets
      d.streak = 0;
      d.box = Math.max(d.box - 2, 0);
    }
    return d;
  }

  /**
   * Priority score for a card. Higher = should be asked sooner.
   * Cards in lower boxes get highest priority.
   */
  function priority(cardData) {
    var d = cardData || emptyCardData();
    var boxScore = (MAX_BOX - d.box) * 100;
    var streakScore = (1 / (1 + d.streak)) * 50;
    var daysSince = d.lastSeen
      ? (Date.now() / 1000 - d.lastSeen) / 86400
      : 30; // never seen = treat as 30 days old
    var timeScore = Math.min(daysSince, 30) * 10; // cap at 30 days
    return boxScore + streakScore + timeScore;
  }

  /**
   * Sort cards by SR priority (highest priority first).
   * Shuffles within the same box level for variety.
   * Returns a new array (does not mutate input).
   *
   * @param {Array} cards - array of {front, back, id, ...} card objects
   * @param {Object} deckData - { [cardId]: cardData }
   * @returns {Array} sorted copy of cards
   */
  function sortByPriority(cards, deckData) {
    if (!Array.isArray(cards) || !cards.length) return [];
    var dd = deckData || {};
    // Assign priority + random tiebreaker within same box
    var scored = cards.map(function (card) {
      var cid = cardId(card.front);
      var cd = getCardData(dd, cid);
      return { card: card, prio: priority(cd), box: cd.box, rand: Math.random() };
    });
    scored.sort(function (a, b) {
      if (a.box !== b.box) return a.box - b.box; // lower box first
      if (Math.abs(a.prio - b.prio) > 0.01) return b.prio - a.prio; // higher prio first
      return a.rand - b.rand; // shuffle within band
    });
    return scored.map(function (s) { return s.card; });
  }

  /** Is this individual card "mastered" (box >= MASTERY_BOX)? */
  function isMastered(cardData) {
    return (cardData || emptyCardData()).box >= MASTERY_BOX;
  }

  /**
   * Is the full deck mastered for this drill session?
   * All cards must be at box >= MASTERY_BOX AND answered correctly at least once
   * in the current session (tracked by sessionAnswered set of card IDs).
   */
  function isDeckMastered(cards, deckData, sessionCorrect) {
    if (!Array.isArray(cards) || !cards.length) return true;
    var dd = deckData || {};
    var sc = sessionCorrect || new Set();
    for (var i = 0; i < cards.length; i++) {
      var cid = cardId(cards[i].front);
      var cd = getCardData(dd, cid);
      if (cd.box < MASTERY_BOX) return false;
      if (!sc.has(cid)) return false;
    }
    return true;
  }

  /**
   * Compute deck stats for display.
   * Returns { total, mastered, percent, studied (boolean: any data exists) }.
   */
  function deckStats(cards, deckData) {
    if (!Array.isArray(cards) || !cards.length) {
      return { total: 0, mastered: 0, percent: 0, studied: false };
    }
    var dd = deckData || {};
    var total = cards.length;
    var mastered = 0;
    var studied = false;
    for (var i = 0; i < cards.length; i++) {
      var cid = cardId(cards[i].front);
      var cd = dd[cid];
      if (cd) {
        studied = true;
        if (cd.box >= MASTERY_BOX) mastered++;
      }
    }
    return {
      total: total,
      mastered: mastered,
      percent: total ? Math.round((mastered / total) * 100) : 0,
      studied: studied,
    };
  }

  /** Box level color for mastery dot. */
  function boxColor(box) {
    switch (box) {
      case 0: return "#ef4444"; // red
      case 1: return "#f97316"; // orange
      case 2: return "#eab308"; // yellow
      case 3: return "#22c55e"; // green
      case 4: return "#3b82f6"; // blue
      default: return "#9ca3af"; // gray
    }
  }

  /** Box level label. */
  function boxLabel(box) {
    switch (box) {
      case 0: return "New";
      case 1: return "Learning";
      case 2: return "Familiar";
      case 3: return "Known";
      case 4: return "Mastered";
      default: return "Unknown";
    }
  }

  // --- Public API ---

  window.Xplainer.sr = {
    // User
    getUser: getUser,
    setUser: setUser,
    clearUser: clearUser,

    // Hashing
    hashString: hashString,
    deckId: deckId,
    cardId: cardId,

    // Data
    getDeckData: getDeckData,
    saveDeckData: saveDeckData,
    getCardData: getCardData,
    emptyCardData: emptyCardData,

    // Algorithm
    recordAnswer: recordAnswer,
    priority: priority,
    sortByPriority: sortByPriority,
    isMastered: isMastered,
    isDeckMastered: isDeckMastered,
    deckStats: deckStats,

    // Display helpers
    boxColor: boxColor,
    boxLabel: boxLabel,

    // Constants
    MAX_BOX: MAX_BOX,
    MASTERY_BOX: MASTERY_BOX,
  };
})();
