// ABOUTME: JavaScript for interactive Macintosh desktop pattern showcase
// ABOUTME: Handles pattern loading, tiling display, and user interactions with Mac Plus virtual screen

class MacPatternShowcase {
  constructor() {
    this.patterns = [];
    this.currentPattern = null;
    this.patternsGrid = document.getElementById("patternsGrid");
    this.desktop = document.getElementById("desktop");
    this.ctx = this.desktop.getContext("2d");
    this.patternInfo = document.getElementById("patternInfo");
    this.resetButton = document.getElementById("resetButton");
    this.themeToggle = document.getElementById("themeToggle");

    this.init();
  }

  async init() {
    this.initTheme();
    await this.loadPatterns();
    this.createPatternGrid();
    this.setupEventListeners();
    this.setupTooltip();
    this.setupCopyButton();
    this.initializeWithRandomPattern();
  }

  initTheme() {
    // Get saved theme or default to system preference
    const savedTheme = localStorage.getItem("color-scheme");
    const systemPrefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;

    if (savedTheme) {
      this.setTheme(savedTheme);
    } else if (systemPrefersDark) {
      this.setTheme("dark");
    } else {
      this.setTheme("light");
    }

    // Listen for system theme changes
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", (e) => {
        if (!localStorage.getItem("color-scheme")) {
          this.setTheme(e.matches ? "dark" : "light");
        }
      });
  }

  setTheme(theme) {
    document.body.style.colorScheme = theme;
    document.body.className = theme === "dark" ? "dark-theme" : "light-theme";
    localStorage.setItem("color-scheme", theme);
  }

  toggleTheme() {
    const currentTheme =
      localStorage.getItem("color-scheme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    const newTheme = currentTheme === "dark" ? "light" : "dark";
    this.setTheme(newTheme);

    // Update the page background pattern with new theme colors
    this.updatePageBackgroundForTheme();
  }

  async loadPatterns() {
    // Load all 38 patterns (000-037)
    for (let i = 0; i < 38; i++) {
      const patternNum = i.toString().padStart(3, "0");
      try {
        const pbmData = await this.fetchPbmData(patternNum);
        const binaryPattern = this.parsePbmToBinary(pbmData);
        this.patterns.push({
          id: i,
          number: patternNum,
          pbmData: pbmData,
          binaryPattern: binaryPattern,
        });
      } catch (error) {
        console.warn(`Failed to load pattern ${patternNum}:`, error);
      }
    }
  }

  async fetchPbmData(patternNum) {
    try {
      const response = await fetch(`patterns/pattern_${patternNum}.pbm`);
      return await response.text();
    } catch (error) {
      console.warn(`Could not load PBM data for pattern ${patternNum}`);
      return "PBM data unavailable";
    }
  }

  parsePbmToBinary(pbmData) {
    // Parse NetPBM P1 format (plain ASCII bitmap)
    const lines = pbmData.trim().split("\n");
    const binaryPattern = [];

    // Skip header lines (P1, comments starting with #, dimensions)
    let dataStartIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === "P1" || line.startsWith("#")) {
        continue;
      }
      if (line.match(/^\d+\s+\d+$/)) {
        // Found dimensions line, data starts next
        dataStartIndex = i + 1;
        break;
      }
    }

    // Parse 8 rows of pattern data
    for (let row = 0; row < 8; row++) {
      const rowData = [];
      if (dataStartIndex + row < lines.length) {
        const bits = lines[dataStartIndex + row].trim().split(/\s+/);
        for (let col = 0; col < 8; col++) {
          // In PBM: 0=white, 1=black (same as our binary representation)
          rowData.push(parseInt(bits[col] || "0", 10));
        }
      } else {
        // Fallback for missing data
        for (let col = 0; col < 8; col++) {
          rowData.push(0);
        }
      }
      binaryPattern.push(rowData);
    }

    return binaryPattern;
  }

  createPageBackgroundPattern(pattern) {
    // Create a "fat bits" background pattern - scale 8x8 for chunky pixelation
    const scale = 4;
    const canvasSize = 8 * scale; // 32px
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext("2d");

    const computedStyle = getComputedStyle(document.body);
    const darkColor = computedStyle
      .getPropertyValue("--pattern-bg-dark")
      .trim();
    const lightColor = computedStyle
      .getPropertyValue("--pattern-bg-light")
      .trim();

    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const bit = pattern.binaryPattern[y][x];
        ctx.fillStyle = bit ? darkColor : lightColor;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }

    return { dataUrl: canvas.toDataURL(), size: canvasSize };
  }

  renderPatternToCanvas(pattern) {
    // 1. Synchronize canvas resolution with its display size
    // This is the key fix to prevent browser scaling and anti-aliasing.
    if (
      this.desktop.width !== this.desktop.clientWidth ||
      this.desktop.height !== this.desktop.clientHeight
    ) {
      this.desktop.width = this.desktop.clientWidth;
      this.desktop.height = this.desktop.clientHeight;
    }

    // 2. Disable canvas smoothing for pixel-perfect rendering
    // This must be done *after* any potential resize, as resizing resets the context.
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.webkitImageSmoothingEnabled = false;
    this.ctx.mozImageSmoothingEnabled = false;
    this.ctx.msImageSmoothingEnabled = false;

    // Clear canvas with white background
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);

    if (!pattern || !pattern.binaryPattern) return;

    // 3. Create the pattern on an 8x8 off-screen canvas
    const patternCanvas = document.createElement("canvas");
    patternCanvas.width = 8;
    patternCanvas.height = 8;
    const patternCtx = patternCanvas.getContext("2d");

    // Draw the 8x8 tile from binary data
    const imageData = patternCtx.createImageData(8, 8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const index = (y * 8 + x) * 4;
        const color = pattern.binaryPattern[y][x] === 1 ? 0 : 255; // Black or White
        imageData.data[index] = color; // R
        imageData.data[index + 1] = color; // G
        imageData.data[index + 2] = color; // B
        imageData.data[index + 3] = 255; // A
      }
    }
    patternCtx.putImageData(imageData, 0, 0);

    // 4. Use the canvas pattern to fill the main display
    const canvasPattern = this.ctx.createPattern(patternCanvas, "repeat");
    this.ctx.fillStyle = canvasPattern;
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
  }

  createPatternGrid() {
    this.patterns.forEach((pattern) => {
      const patternElement = document.createElement("div");
      patternElement.className = "pattern-item";
      patternElement.dataset.patternId = pattern.id;

      // Create visual pattern preview directly from binary data
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const ctx = canvas.getContext("2d");

      const imageData = ctx.createImageData(8, 8);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const index = (y * 8 + x) * 4;
          const color = pattern.binaryPattern[y][x] === 1 ? 0 : 255;
          imageData.data[index] = color; // R
          imageData.data[index + 1] = color; // G
          imageData.data[index + 2] = color; // B
          imageData.data[index + 3] = 255; // A
        }
      }
      ctx.putImageData(imageData, 0, 0);

      // Scale up the canvas for better visibility
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.classList.add("pixelated");

      patternElement.appendChild(canvas);

      // Add hover and click handlers
      patternElement.addEventListener("mouseenter", () => {
        this.previewPattern(pattern);
      });

      patternElement.addEventListener("mouseleave", () => {
        if (this.currentPattern) {
          // Return to the selected pattern
          this.renderPatternToCanvas(this.currentPattern);
          this.updatePatternInfo(this.currentPattern, true);
        } else {
          this.clearPreview();
        }
      });

      patternElement.addEventListener("click", () => {
        this.selectPattern(pattern, patternElement);
      });

      this.patternsGrid.appendChild(patternElement);
    });
  }

  setupEventListeners() {
    this.resetButton.addEventListener("click", () => {
      this.resetDisplay();
    });

    this.themeToggle.addEventListener("click", () => {
      this.toggleTheme();
    });
  }

  setupCopyButton() {
    const copyBtn = document.getElementById("copyPbmBtn");
    copyBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const text = copyBtn.getAttribute("data-copy");
      if (text) {
        this.copyToClipboard(text, copyBtn);
      }
    });
  }

  setPageBackground(pattern) {
    const { dataUrl, size } = this.createPageBackgroundPattern(pattern);
    document.body.style.backgroundImage = `url(${dataUrl})`;
    document.body.style.backgroundRepeat = "repeat";
    document.body.style.backgroundSize = `${size}px ${size}px`;
  }

  updatePageBackgroundForTheme() {
    // Regenerate the current pattern background with new theme colors
    if (this.currentPattern) {
      this.setPageBackground(this.currentPattern);
    }
  }

  initializeWithRandomPattern() {
    if (this.patterns.length > 0) {
      const randomPattern =
        this.patterns[Math.floor(Math.random() * this.patterns.length)];
      this.currentPattern = randomPattern;
      this.setPageBackground(randomPattern);
    }
  }

  previewPattern(pattern) {
    this.renderPatternToCanvas(pattern);
    this.updatePatternInfo(pattern, false);
  }

  selectPattern(pattern, element) {
    // Remove active class from all pattern items
    document.querySelectorAll(".pattern-item").forEach((item) => {
      item.classList.remove("active");
    });

    // Add active class to selected item
    element.classList.add("active");

    this.currentPattern = pattern;
    this.renderPatternToCanvas(pattern);
    this.updatePatternInfo(pattern, true);
    this.setPageBackground(pattern);
  }

  clearPreview() {
    if (!this.currentPattern) {
      // Clear canvas with white background
      this.ctx.fillStyle = "#ffffff";
      this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
      this.updatePatternInfo(null, false);
    }
  }

  updatePatternInfo(pattern, isSelected) {
    const patternStatus = document.getElementById("patternStatus");
    const patternPreview = document.getElementById("patternPreview");
    const pbmContent = document.getElementById("pbmContent");
    const copyBtn = document.getElementById("copyPbmBtn");

    if (pattern) {
      const status = isSelected ? "Selected" : "Previewing";
      const displayNumber = parseInt(pattern.number, 10).toString();

      // Create PBM representation
      const pbmLines = pattern.binaryPattern
        .map((row) => row.join(" "))
        .join("\n");
      const pbm = "P1\n8 8\n" + pbmLines;

      // Update DOM elements
      patternStatus.innerHTML = `<strong>${status}: Pattern ${displayNumber}</strong>`;
      pbmContent.textContent = pbm;
      copyBtn.setAttribute("data-copy", pbm);
      patternPreview.style.display = "block";
    } else {
      // Clear pattern info
      patternStatus.textContent =
        "Click a pattern to preview on the 512×384 display";
      patternPreview.style.display = "none";
    }
  }

  setupTooltip() {
    const trigger = document.querySelector(".pbm-label");
    const tooltip = document.getElementById("pbmTooltip");

    if (!trigger || !tooltip) return;

    let showTimeout;
    let hideTimeout;

    const showTooltip = () => {
      clearTimeout(hideTimeout);
      showTimeout = setTimeout(() => {
        tooltip.setAttribute("aria-hidden", "false");
        tooltip.classList.add("visible");
        this.positionTooltip(trigger, tooltip);
      }, 500); // 500ms delay for show
    };

    const hideTooltip = () => {
      clearTimeout(showTimeout);
      hideTimeout = setTimeout(() => {
        tooltip.setAttribute("aria-hidden", "true");
        tooltip.classList.remove("visible");
      }, 300); // 300ms delay for hide
    };

    const immediateHide = () => {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
      tooltip.setAttribute("aria-hidden", "true");
      tooltip.classList.remove("visible");
    };

    // Mouse events
    trigger.addEventListener("mouseenter", showTooltip);
    trigger.addEventListener("mouseleave", hideTooltip);

    // Allow hovering over tooltip content
    tooltip.addEventListener("mouseenter", () => clearTimeout(hideTimeout));
    tooltip.addEventListener("mouseleave", hideTooltip);

    // Keyboard events
    trigger.addEventListener("focus", showTooltip);
    trigger.addEventListener("blur", hideTooltip);

    // Escape key to close
    document.addEventListener("keydown", (e) => {
      if (
        e.key === "Escape" &&
        tooltip.getAttribute("aria-hidden") === "false"
      ) {
        immediateHide();
        trigger.focus();
      }
    });
  }

  positionTooltip(trigger, tooltip) {
    const triggerRect = trigger.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Reset positioning
    tooltip.style.left = "";
    tooltip.style.right = "";
    tooltip.style.top = "";
    tooltip.style.bottom = "";

    // Calculate preferred position (above and centered)
    let left = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    let top = triggerRect.top - tooltipRect.height - 8;

    // Adjust if tooltip goes off screen horizontally
    if (left < 8) {
      left = 8;
    } else if (left + tooltipRect.width > viewportWidth - 8) {
      left = viewportWidth - tooltipRect.width - 8;
    }

    // Adjust if tooltip goes off screen vertically (position below instead)
    if (top < 8) {
      top = triggerRect.bottom + 8;
      tooltip.classList.add("below");
    } else {
      tooltip.classList.remove("below");
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  copyToClipboard(text, button) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        const originalText = button.innerHTML;
        button.innerHTML = "✓";
        button.style.color = "#4CAF50";
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = "";
        }, 1000);
      })
      .catch(() => {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);

        const originalText = button.innerHTML;
        button.innerHTML = "✓";
        button.style.color = "#4CAF50";
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.color = "";
        }, 1000);
      });
  }

  resetDisplay() {
    this.currentPattern = null;
    // Clear canvas with white background
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.desktop.width, this.desktop.height);
    this.updatePatternInfo(null, false);

    // Clear page background pattern
    document.body.style.backgroundImage = "";
    document.body.style.backgroundRepeat = "";
    document.body.style.backgroundSize = "";

    // Remove active class from all pattern items
    document.querySelectorAll(".pattern-item").forEach((item) => {
      item.classList.remove("active");
    });
  }
}

// Initialize the showcase when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
  new MacPatternShowcase();
});
