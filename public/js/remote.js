/**
 * StreamFlow IPTV - D-Pad & Remote Control & Gestures Navigation
 * Allows 100% remote-control navigation with keyboard arrows, TV remotes & iOS gestures
 */
const RemoteNav = {
  currentFocused: null,
  activeSection: 'channels', // 'sidebar', 'categories', 'channels', 'player'
  swipeStartX: 0,
  swipeStartY: 0,

  init(appController) {
    this.app = appController;
    this.bindKeyboard();
    this.bindTouchGestures();
  },

  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // If typing in an input field, do not hijack arrows unless Esc or Enter
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) {
        if (e.key === 'Escape' || e.key === 'Enter') {
          document.activeElement.blur();
          this.setFocus(this.currentFocused || document.querySelector('.focusable'));
        }
        return;
      }

      const isPlayerOpen = !document.getElementById('playerView').classList.contains('hidden');

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.nextChannel();
          } else {
            this.navigateSpatial('up');
          }
          break;

        case 'ArrowDown':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.prevChannel();
          } else {
            this.navigateSpatial('down');
          }
          break;

        case 'ArrowLeft':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.toggleChannelDrawer();
          } else {
            this.navigateSpatial('left');
          }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.player.showOsdTemporarily();
          } else {
            this.navigateSpatial('right');
          }
          break;

        case 'Enter':
          e.preventDefault();
          if (this.currentFocused) {
            this.currentFocused.click();
          }
          break;

        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.closePlayer();
          } else {
            this.app.closeModals();
          }
          break;

        case ' ':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.player.togglePlayPause();
          }
          break;

        case 'f':
        case 'F':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.player.toggleFullscreen();
          }
          break;

        case 'm':
        case 'M':
          e.preventDefault();
          if (isPlayerOpen) {
            this.app.player.toggleMute();
          }
          break;
      }
    });
  },

  bindTouchGestures() {
    const playerContainer = document.getElementById('playerContainer');
    if (!playerContainer) return;

    playerContainer.addEventListener('touchstart', (e) => {
      this.swipeStartX = e.changedTouches[0].screenX;
      this.swipeStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    playerContainer.addEventListener('touchend', (e) => {
      const diffX = e.changedTouches[0].screenX - this.swipeStartX;
      const diffY = e.changedTouches[0].screenY - this.swipeStartY;

      // Detect swipe gestures on mobile iOS
      if (Math.abs(diffX) > 80 && Math.abs(diffY) < 60) {
        if (diffX > 0) {
          // Swipe right -> Prev channel
          this.app.prevChannel();
        } else {
          // Swipe left -> Next channel
          this.app.nextChannel();
        }
      } else if (diffY > 100 && Math.abs(diffX) < 60) {
        // Swipe down -> Exit player
        this.app.closePlayer();
      }
    }, { passive: true });
  },

  navigateSpatial(direction) {
    const focusables = Array.from(document.querySelectorAll('.focusable:not([disabled]):not(.hidden)'));
    if (!focusables.length) return;

    if (!this.currentFocused || !document.body.contains(this.currentFocused)) {
      this.setFocus(focusables[0]);
      return;
    }

    const currentRect = this.currentFocused.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestElement = null;
    let minDistance = Infinity;

    focusables.forEach(el => {
      if (el === this.currentFocused) return;
      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;

      let isCandidate = false;

      if (direction === 'up' && dy < -10) isCandidate = true;
      if (direction === 'down' && dy > 10) isCandidate = true;
      if (direction === 'left' && dx < -10) isCandidate = true;
      if (direction === 'right' && dx > 10) isCandidate = true;

      if (isCandidate) {
        // Weight aligned distance to prefer straight lines over diagonals
        const dist = (direction === 'up' || direction === 'down')
          ? Math.abs(dy) + Math.abs(dx) * 2.5
          : Math.abs(dx) + Math.abs(dy) * 2.5;

        if (dist < minDistance) {
          minDistance = dist;
          bestElement = el;
        }
      }
    });

    if (bestElement) {
      this.setFocus(bestElement);
    }
  },

  setFocus(el) {
    if (!el) return;
    if (this.currentFocused) {
      this.currentFocused.classList.remove('tv-focused');
    }
    this.currentFocused = el;
    el.classList.add('tv-focused');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }
};
