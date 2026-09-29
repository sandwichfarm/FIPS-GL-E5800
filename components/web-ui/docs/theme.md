# Theme CSS Variables Reference

## Overview

The GL.iNet admin panel uses CSS custom properties (variables) for theming.
All `gl-` components automatically inherit these variables, so custom plugin
styles integrate with the active theme without additional configuration.

When writing custom CSS in your plugin, use these variables instead of
hard-coded color values to ensure your UI adapts to both light and dark themes.

---

## Background Variables

| Variable | Description |
|----------|-------------|
| `--card-bg` | Card component background |
| `--menu-bg` | Sidebar menu background |
| `--content-bg` | Main content area background |
| `--controller-bg` | Control/toolbar area background |
| `--hover-bg` | Hover state background for interactive elements |
| `--table-bg` | Table background |
| `--tooltip-bg` | Tooltip background |

---

## Text Variables

| Variable | Description |
|----------|-------------|
| `--title-color` | Page and section title text |
| `--text-color` | Primary body text |
| `--menu-color` | Sidebar menu item text |
| `--menu-active-color` | Active/selected sidebar menu item text |
| `--btn-color` | Button text |
| `--nav-text-color` | Navigation bar text |
| `--hint-color` | Hint and placeholder text |
| `--label-color` | Form label text |

---

## Status Variables

Each status color has a base value plus `-hover` and `-disabled` variants.

| Variable | Description |
|----------|-------------|
| `--error-color` | Error/danger state |
| `--error-color-hover` | Error hover state |
| `--error-color-disabled` | Error disabled state |
| `--warning-color` | Warning state |
| `--warning-color-hover` | Warning hover state |
| `--warning-color-disabled` | Warning disabled state |
| `--success-color` | Success state |
| `--success-color-hover` | Success hover state |
| `--success-color-disabled` | Success disabled state |
| `--info-color` | Informational state |
| `--info-color-hover` | Info hover state |
| `--info-color-disabled` | Info disabled state |

---

## Component Variables

| Variable | Description |
|----------|-------------|
| `--card-border` | Card border color |
| `--table-border` | Table cell/row border color |
| `--menu-border` | Sidebar menu divider/border color |
| `--input-border` | Form input border color |
| `--shadow-color` | Box shadow color |
| `--btn-bg` | Button background color |
| `--switch-bg` | Toggle switch background (off state) |

---

## Usage in Custom CSS

Reference variables with the standard `var()` function:

```css
.my-plugin-container {
  background-color: var(--card-bg);
  color: var(--text-color);
  border: 1px solid var(--card-border);
  border-radius: 8px;
  padding: 16px;
}

.my-plugin-status-ok {
  color: var(--success-color);
}

.my-plugin-status-error {
  color: var(--error-color);
}

.my-plugin-label {
  color: var(--label-color);
  font-size: 14px;
}
```

---

## Usage in Vue Single-File Components

In a `.vue` file, use the variables inside a `<style>` block:

```vue
<style scoped>
.info-row {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px solid var(--table-border);
  color: var(--text-color);
}

.info-label {
  color: var(--label-color);
  font-weight: 500;
}

.info-value {
  color: var(--title-color);
}
</style>
```

---

## Fallback Values

You can provide fallback values in case a variable is not defined in the
current theme:

```css
.my-element {
  color: var(--text-color, #333333);
  background: var(--card-bg, #ffffff);
}
```

---

## Notes

- Variables are set on the `:root` element and cascade to all components.
- The admin panel ships with at least a light and dark theme. Custom themes
  may define additional or different variable values.
- These variables were identified through reverse engineering. Additional
  undocumented variables may exist.
- Avoid overriding these variables in your plugin CSS unless you intentionally
  want to create a locally different appearance.
