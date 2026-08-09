// ---------------------------------------------------------------------------
// ui.js - the DOM layer: title screen, settings, results, arrival summary,
// pause overlay. The in-game HUD is drawn on canvas; this is everything else.
// ---------------------------------------------------------------------------

class UI {
  constructor(game) {
    this.game = game;
    this.el = {};
    for (const id of ['loading', 'loadingText', 'title', 'results', 'arrived', 'pause',
      'resultsBody', 'resultsHeadline', 'arrivedBody', 'liveryRow', 'lapsRow',
      'difficultyRow', 'assistRow', 'qualityRow', 'startBtn', 'driveBtn', 'resultsDrive',
      'resultsRestart', 'arrivedRestart', 'arrivedDrive', 'resumeBtn', 'quitBtn']) {
      this.el[id] = document.getElementById(id);
    }
    this.bind();
  }

  bind() {
    const g = () => this.game;

    this.el.startBtn.addEventListener('click', () => {
      g().audio.start();
      g().startRace();
    });
    this.el.driveBtn.addEventListener('click', () => {
      g().audio.start();
      g().startDriveHome();
    });
    this.el.resultsDrive.addEventListener('click', () => g().startDriveHome());
    this.el.resultsRestart.addEventListener('click', () => g().startRace());
    this.el.arrivedRestart.addEventListener('click', () => {
      this.showTitle();
      g().state = 'menu';
      g().setupMenuScene();
    });
    this.el.arrivedDrive.addEventListener('click', () => g().startDriveHome());
    this.el.resumeBtn.addEventListener('click', () => {
      g().paused = false;
      this.setPaused(false);
    });
    this.el.quitBtn.addEventListener('click', () => {
      g().paused = false;
      this.setPaused(false);
      g().state = 'menu';
      g().setupMenuScene();
      this.showTitle();
    });

    // Livery swatches.
    LIVERY_PRESETS.forEach((livery, i) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      const [r, gg, bb] = livery.paint.map((c) => Math.round(Math.pow(c, 1 / 2.2) * 255));
      b.style.background = `rgb(${r},${gg},${bb})`;
      b.title = livery.name;
      b.addEventListener('click', () => {
        this.game.settings.playerLivery = i;
        this.refreshSelection();
      });
      this.el.liveryRow.appendChild(b);
    });

    this.makeOptions(this.el.lapsRow, [['2', 2], ['3', 3], ['5', 5], ['8', 8]],
      (v) => { this.game.settings.laps = v; }, () => this.game.settings.laps);
    this.makeOptions(this.el.difficultyRow,
      [['Rookie', 0.25], ['Amateur', 0.55], ['Pro', 0.80], ['Ace', 1.0]],
      (v) => { this.game.settings.difficulty = v; }, () => this.game.settings.difficulty);
    this.makeOptions(this.el.assistRow, [['On', true], ['Off', false]],
      (v) => { this.game.settings.assists = v; }, () => this.game.settings.assists);
    this.makeOptions(this.el.qualityRow, [['High', 'high'], ['Fast', 'fast']],
      (v) => {
        this.game.settings.quality = v;
        const r = this.game.renderer;
        r.settings.shadows = v === 'high';
        r.settings.bloom = v === 'high' ? 0.55 : 0.3;
        r.settings.particles = v === 'high';
      }, () => this.game.settings.quality);

    this.refreshSelection();
  }

  makeOptions(row, options, setter, getter) {
    row._options = options;
    row._setter = setter;
    row._getter = getter;
    for (const [label, value] of options) {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = label;
      b.addEventListener('click', () => {
        setter(value);
        this.refreshSelection();
      });
      b._value = value;
      row.appendChild(b);
    }
  }

  refreshSelection() {
    for (const row of [this.el.lapsRow, this.el.difficultyRow, this.el.assistRow, this.el.qualityRow]) {
      const current = row._getter();
      for (const b of row.children) b.classList.toggle('active', b._value === current);
    }
    Array.from(this.el.liveryRow.children).forEach((b, i) => {
      b.classList.toggle('active', i === this.game.settings.playerLivery);
    });
  }

  setLoading(text) {
    this.el.loading.classList.remove('hidden');
    this.el.loadingText.textContent = text;
  }

  hideAll() {
    for (const id of ['loading', 'title', 'results', 'arrived', 'pause']) {
      this.el[id].classList.add('hidden');
    }
  }

  showTitle() {
    this.hideAll();
    this.el.title.classList.remove('hidden');
  }

  setPaused(on) {
    this.el.pause.classList.toggle('hidden', !on);
  }

  showResults(results, playerPos, laps) {
    this.hideAll();
    this.el.results.classList.remove('hidden');
    const ordinal = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'][playerPos] || `${playerPos}th`;
    this.el.resultsHeadline.textContent =
      playerPos === 1 ? `Win! ${ordinal} place` : `Finished ${ordinal}`;

    const rows = results.map((r) => {
      const gap = r.total === null ? '—'
        : (r.pos === 1 ? formatTime(r.total) : `+${(r.gap || 0).toFixed(3)}`);
      return `<tr class="${r.isPlayer ? 'me' : ''}">
        <td class="pos">${r.pos}</td>
        <td>${r.name}</td>
        <td class="num">${gap}</td>
        <td class="num">${r.best ? formatTime(r.best) : '—'}</td>
      </tr>`;
    }).join('');
    this.el.resultsBody.innerHTML = `
      <table>
        <thead><tr><th>#</th><th>Driver</th><th>Race</th><th>Best lap</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="note">${laps} laps completed. Now for the drive home — mind the speed limits.</p>`;
  }

  showArrived(summary) {
    this.hideAll();
    this.el.arrived.classList.remove('hidden');
    const grade = summary.rating >= 90 ? 'Exemplary'
      : summary.rating >= 75 ? 'Good drive'
        : summary.rating >= 55 ? 'A bit ragged'
          : 'You should take the bus';
    const mins = Math.floor(summary.time / 60);
    const secs = Math.floor(summary.time % 60);
    this.el.arrivedBody.innerHTML = `
      <div class="bigscore">${summary.rating}<span>/100</span></div>
      <div class="grade">${grade}</div>
      <ul class="stats">
        <li><span>Journey time</span><strong>${mins}m ${String(secs).padStart(2, '0')}s</strong></li>
        <li><span>Distance driven</span><strong>${(summary.distance / 1000).toFixed(2)} km</strong></li>
      </ul>
      <p class="note">The garage light is on and the engine is ticking as it cools.</p>`;
  }
}
