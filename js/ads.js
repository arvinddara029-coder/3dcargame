// =====================================================================
//  CrazyGamesAdManager — ads-only CrazyGames SDK integration.
//
//  Scope (intentionally minimal): video ads (midgame interstitials +
//  rewarded), adblock detection, and the gameplayStart/gameplayStop
//  signals CrazyGames requires around active gameplay and ad requests.
//  No user accounts, no cloud saves, no data module, no banners,
//  no purchases — the game stays fully standalone and offline-capable.
//
//  Safety contract:
//  - init() never throws and the game never waits for it.
//  - If the SDK is missing/blocked/fails, every method degrades to a
//    no-op and gameplay continues exactly as before.
//  - Rewards are granted ONLY from the adFinished callback.
//  - Interstitials fire only at natural breaks (between completed runs),
//    never during driving, never in the first minute of a session, and
//    never more often than CrazyGames' ~3-minute midgame interval.
// =====================================================================

const SDK_WAIT_TIMEOUT = 10;      // s — max wait for the SDK <script> to appear
const SDK_POLL_INTERVAL = 0.15;   // s — bounded poll, stops as soon as it exists
const INIT_TIMEOUT = 10;          // s — cap on SDK.init()
const INTERSTITIAL_MIN_GAP = 180; // s — CrazyGames enforces ~3 min between midgame ads
const SESSION_GRACE = 60;         // s — no interstitial during the first minute

class CrazyGamesAdManager {
  constructor() {
    this.status = 'idle'; // idle | waiting | ready | unavailable | failed
    this.adblock = false;
    this.busy = false;    // an ad request is in flight — blocks duplicate requests
    this.inGameplay = false;
    this.runEnded = false; // a run finished → the next race start is a valid ad break
    this.sessionStart = this._now();
    this.lastAdAt = -1e9;
    this.stats = { interstitials: 0, interstitialErrors: 0, rewarded: 0, rewardedGranted: 0, rewardedFailed: 0 };
    this._mute = null;
    this._unmute = null;
    this._initPromise = null;
  }

  _now() {
    return (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()) / 1000;
  }

  setAudioHooks(mute, unmute) {
    // The game registers audio ducking; the manager calls these from the
    // SDK's adStarted/adFinished/adError callbacks (a CrazyGames requirement).
    this._mute = mute;
    this._unmute = unmute;
  }

  // Starts SDK initialization in the background. Safe to call once; never
  // throws. Until it resolves with 'ready', every ad request is a no-op.
  init() {
    if (this._initPromise) return this._initPromise;
    this.status = 'waiting';
    this._initPromise = (async () => {
      try {
        const sdk = await this._waitForSdk();
        if (!sdk) {
          this.status = 'unavailable';
          console.info('[ads] CrazyGames SDK not present — running without ads.');
          return this.status;
        }
        await this._withTimeout(Promise.resolve(sdk.init()), INIT_TIMEOUT, 'SDK.init timed out');
        this.sdk = sdk;
        try { this.adblock = Boolean(await sdk.ad.hasAdblock()); } catch { this.adblock = false; }
        this.status = 'ready';
        console.info(`[ads] CrazyGames SDK ready (environment: ${sdk.environment || 'unknown'}${this.adblock ? ', adblock detected' : ''}).`);
      } catch (error) {
        this.status = 'failed';
        console.warn('[ads] CrazyGames SDK unavailable — running without ads:', (error && error.message) || error);
      }
      return this.status;
    })();
    return this._initPromise;
  }

  async _waitForSdk() {
    const deadline = this._now() + SDK_WAIT_TIMEOUT;
    while (typeof window === 'undefined' || !window.CrazyGames || !window.CrazyGames.SDK) {
      if (this._now() >= deadline) return null;
      await new Promise(r => setTimeout(r, SDK_POLL_INTERVAL * 1000));
    }
    return window.CrazyGames.SDK;
  }

  _withTimeout(promise, seconds, label) {
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => setTimeout(() => reject(new Error(label)), seconds * 1000)),
    ]);
  }

  get ready() { return this.status === 'ready' && this.sdk; }

  // The game calls this when a run finishes (wreck). It marks the NEXT
  // race start as a natural ad break — interstitials never fire at the
  // very first game start or from the menu without a completed run.
  markRunEnded() {
    this.runEnded = true;
  }

  // --- gameplay lifecycle signals (required around gameplay and before ads) ---
  gameplayStart() {
    this.runEnded = false; // a new run began; the pending break opportunity is consumed
    if (!this.ready || this.inGameplay) return;
    this.inGameplay = true;
    try { this.sdk.game.gameplayStart(); } catch (e) { console.warn('[ads] gameplayStart failed:', (e && e.message) || e); }
  }

  gameplayStop() {
    if (!this.ready || !this.inGameplay) return;
    this.inGameplay = false;
    try { this.sdk.game.gameplayStop(); } catch (e) { console.warn('[ads] gameplayStop failed:', (e && e.message) || e); }
  }

  // --- interstitials: natural breaks between completed runs only ---
  // Calls onDone() EXACTLY once — after the ad (finished or failed), or
  // immediately when no ad is appropriate. The next run must always start.
  maybeShowInterstitial(onDone) {
    let called = false;
    const finish = () => { if (!called) { called = true; onDone(); } };
    if (!this.ready || this.busy || !this.runEnded ||
        this._now() - this.lastAdAt < INTERSTITIAL_MIN_GAP ||
        this._now() - this.sessionStart < SESSION_GRACE) return finish();
    this.busy = true;
    this.stats.interstitials++;
    this.gameplayStop(); // requirement: never request ads during active gameplay
    const requestedAt = this._now();
    try {
      this.sdk.ad.requestAd('midgame', {
        adStarted: () => { if (this._mute) this._mute(); },
        adFinished: () => this._adSettled(requestedAt, finish),
        adError: (error) => {
          this.stats.interstitialErrors++;
          console.warn('[ads] interstitial skipped:', (error && error.code) || error);
          this._adSettled(requestedAt, finish);
        },
      });
    } catch (error) {
      console.warn('[ads] interstitial request threw:', (error && error.message) || error);
      this._adSettled(requestedAt, finish);
    }
  }

  // --- rewarded ads: the reward fires ONLY on adFinished ---
  canOfferRewarded() { return this.ready && !this.adblock && !this.busy; }

  requestRewarded({ onReward, onDone } = {}) {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; if (onDone) onDone(ok); } };
    if (!this.canOfferRewarded()) { this.stats.rewardedFailed++; return finish(false); }
    this.busy = true;
    this.stats.rewarded++;
    this.gameplayStop();
    const requestedAt = this._now();
    try {
      this.sdk.ad.requestAd('rewarded', {
        adStarted: () => { if (this._mute) this._mute(); },
        adFinished: () => this._adSettled(requestedAt, () => {
          // adFinished = the ad was watched completely — only now grant it.
          this.stats.rewardedGranted++;
          if (onReward) onReward();
          finish(true);
        }),
        adError: (error) => {
          this.stats.rewardedFailed++;
          console.warn('[ads] rewarded unavailable:', (error && error.code) || error);
          this._adSettled(requestedAt, () => finish(false)); // no reward on skip/fail
        },
      });
    } catch (error) {
      this.stats.rewardedFailed++;
      console.warn('[ads] rewarded request threw:', (error && error.message) || error);
      this._adSettled(requestedAt, () => finish(false));
    }
  }

  // Shared tail for every ad outcome: unmute, clear the busy guard, remember
  // the request time (keeps our client-side gap in sync with CrazyGames' own
  // cooldown, which counts rewarded and preroll ads too), then resume the game.
  _adSettled(requestedAt, finish) {
    if (this._unmute) this._unmute();
    this.busy = false;
    this.lastAdAt = requestedAt;
    finish();
  }
}

export const ads = new CrazyGamesAdManager();
