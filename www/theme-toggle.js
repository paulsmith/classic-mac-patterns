class ThemeToggle extends HTMLElement {
  connectedCallback() {
    this.currentTheme =
      localStorage.getItem("color-scheme") ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    document.body.style.colorScheme = this.currentTheme;

    this.addEventListener("click", (event) => {
      if (event.target.closest("button")) this.toggleTheme();
    });

    this.addEventListener("theme-toggle:request", (event) => {
        event.detail.callback(this.currentTheme);
    });
  }

  toggleTheme() {
    const currentTheme = this.currentTheme;
    const newTheme = this.currentTheme === "dark" ? "light" : "dark";
    this.currentTheme = newTheme;
    document.body.style.colorScheme = newTheme;
    localStorage.setItem("color-scheme", newTheme);
    const event = new CustomEvent("theme-toggle:toggled", {
      bubbles: true,
      detail: { currentTheme: currentTheme, newTheme: newTheme },
    });
    this.dispatchEvent(event);
  }
}

customElements.define("theme-toggle", ThemeToggle);
