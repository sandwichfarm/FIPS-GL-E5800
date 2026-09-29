# GL.iNet Vue Components Reference

The cross-model portable contract contains `gl-button`, `gl-card`,
`gl-line-chart`, `gl-tips`, and `gl-title`. Their global registrations are verified
in the official MT3000 4.8.1, AXT1800 4.8.3, SFT1200 4.8.3, and MT6000 4.9.1
admin bundles. The larger catalog below remains fingerprint-specific and must not
be treated as universally portable.

> Extracted from GL-MT3000 firmware 4.8.1 by inspecting `Vue.options.components`
> in the running official admin UI. The verified registry contains 52 UI
> components plus the `RouterLink` and `RouterView` helpers.
> The admin panel is Vue 2.x with Element UI 2.x included.

---

## How component names work

Some registry keys use **kebab-case** (`gl-button`) and others use **PascalCase**
(`GlCheckbox`). Use the canonical kebab-case tag in plugin templates. Vue 2 resolves
`<gl-checkbox>` to the `GlCheckbox` registry key, and kebab-case also works in DOM
templates where HTML lowercases element names.

**Not available to plugins:** `gl-btn`, `gl-alert`, `gl-message-fade` — these exist in the
app bundle but are not in the global registry. A string or CSS class in the bundle is
not component availability evidence.

Global availability also does not mean that every component is standalone. Child
components such as `gl-checkbox`, `gl-collapse`, `gl-dropdown-item`, `gl-radio`,
`gl-toggle-item`, `gl-table-column`, `el-menu-item`, `el-option`, and `el-tab-pane`
depend on their corresponding parent component. Router-specific components can also
depend on the Vuex store, RPC globals, or hardware state.

---

## Layout

### gl-title

Page title header.

| Prop | Type | Description |
|------|------|-------------|
| `title` | String | The heading text |

```vue
<gl-title title="My Plugin" />
```

---

### gl-card

Card container. The main layout building block.

| Prop | Type | Description |
|------|------|-------------|
| `title` | String | Optional card title |
| `footer` | String | Footer text |
| `badge` | String | Badge text |
| `state` | String | Card state styling |
| `footerClass` | String | CSS class for footer |
| `iconClass` | String | CSS class for icon |

| Slot | Description |
|------|-------------|
| default | Card body |
| footer | Footer area |

```vue
<gl-card>
  <p>Card body content.</p>
</gl-card>
```

#### SDK card layout utilities

The firmware component keeps its visible body in an internal container and does
not expose a height prop. Import the SDK stylesheet once in every independently
built view, then opt cards into the public layout classes:

```vue
<template>
  <div class="dashboard-grid">
    <gl-card class="gl-sdk4-card gl-sdk4-card--fill">
      <div class="gl-sdk4-card__grow">Card body</div>
    </gl-card>
  </div>
</template>

<style src="@gl-sdk4-plugin-kit/gl-card.css"></style>
```

- `gl-sdk4-card` normalizes sizing around the firmware card body.
- `gl-sdk4-card--fill` makes the card and its body fill the grid row.
- `gl-sdk4-card__grow` makes one slot child consume the remaining body height.

The `@gl-sdk4-plugin-kit` alias is provided by `glplugin build`; keep it in a
custom webpack configuration as shown in the generated template. Plugins should
not target `.gl-card-wrapper` or `.container` directly.

---

### gl-drawer

Side panel overlay for detail views and settings.

No confirmed props — controlled via `v-if` or `v-show` binding.

```vue
<gl-drawer v-if="showDrawer">
  <p>Drawer content.</p>
</gl-drawer>
```

---

### GlCollapse / GlCollapseGroup

Accordion for collapsible sections. Registered as PascalCase.

```vue
<GlCollapseGroup>
  <GlCollapse title="Section One">
    <p>Content here.</p>
  </GlCollapse>
</GlCollapseGroup>
```

---

## Buttons and Controls

### gl-button

Standard button. **Not `gl-btn`** — that is a local component unavailable to plugins.

| Prop | Type | Description |
|------|------|-------------|
| `type` | String | `"primary"`, `"default"`, `"danger"` |
| `cssClass` | String | Additional CSS class |
| `loading` | Boolean | Shows spinner, disables click |
| `disabled` | Boolean | Disables the button |
| `plain` | Boolean | Outlined/plain style |
| `round` | String | Rounded corners |
| `textTransform` | String | CSS text-transform value |

```vue
<gl-button type="primary" :loading="saving" @click="save">
  Save Settings
</gl-button>
```

---

### gl-switch

Toggle switch for boolean values.

| Prop | Type | Description |
|------|------|-------------|
| `value` | Boolean | Current state (v-model) |
| `disabled` | Boolean | Disables the switch |
| `activeColor` | String | Color when on |
| `inactiveColor` | String | Color when off |
| `width` | Number | Width in px |

```vue
<gl-switch v-model="enabled" />
```

---

### GlToggle / GlToggleItem

Tab-style switcher. Registered as PascalCase.

```vue
<GlToggle v-model="activeTab">
  <GlToggleItem value="tab1">Tab One</GlToggleItem>
  <GlToggleItem value="tab2">Tab Two</GlToggleItem>
</GlToggle>
```

---

### gl-link

Styled anchor.

| Prop | Type | Description |
|------|------|-------------|
| `href` | String | Link URL |
| `type` | String | Link style |

```vue
<gl-link href="https://www.gl-inet.com">GL.iNet</gl-link>
```

---

### GlDropdown / GlDropdownItem

Dropdown menu. Registered as PascalCase.

```vue
<GlDropdown>
  <GlDropdownItem @click="action1">Action One</GlDropdownItem>
  <GlDropdownItem @click="action2">Action Two</GlDropdownItem>
</GlDropdown>
```

---

## Form Inputs

### el-input

Text input. This is an **Element UI** component bundled with the admin panel.

| Prop | Type | Description |
|------|------|-------------|
| `value` | String/Number | Input value (v-model) |
| `type` | String | `"text"`, `"textarea"`, `"password"`, `"number"` |
| `placeholder` | String | Placeholder text |
| `disabled` | Boolean | Disabled state |
| `clearable` | Boolean | Show clear button |
| `showPassword` | Boolean | Toggle password visibility |
| `size` | String | `"large"`, `"small"`, `"mini"` |
| `prefixIcon` | String | Icon class for prefix |
| `suffixIcon` | String | Icon class for suffix |
| `readonly` | Boolean | Read-only state |

```vue
<el-input v-model="name" placeholder="Enter name" clearable />
```

---

### el-select

Dropdown select. Element UI component.

| Prop | Type | Description |
|------|------|-------------|
| `value` | any | Selected value (v-model) |
| `placeholder` | String | Placeholder text |
| `disabled` | Boolean | Disabled state |
| `clearable` | Boolean | Allow clearing |
| `filterable` | Boolean | Allow typing to filter |

Use with `ElOption`:

```vue
<el-select v-model="selected" placeholder="Choose...">
  <ElOption label="Option A" value="a" />
  <ElOption label="Option B" value="b" />
</el-select>
```

---

### el-form-item

Form field wrapper with label and validation. Element UI component.

```vue
<ElForm :model="form" label-width="120px">
  <el-form-item label="Username" prop="username">
    <el-input v-model="form.username" />
  </el-form-item>
</ElForm>
```

---

### gl-private

Password input with show/hide toggle.

| Prop | Type | Description |
|------|------|-------------|
| `value` | String | Password value (v-model) |

```vue
<gl-private v-model="password" />
```

---

### gl-search-input

Search input with icon and clear button.

```vue
<gl-search-input v-model="query" />
```

---

### gl-cascader

Cascading/hierarchical selector.

| Prop | Type | Description |
|------|------|-------------|
| `openDelay` | Number | Delay before opening (ms) |

```vue
<gl-cascader :options="cascadeOptions" v-model="selected" />
```

---

### GlCheckbox / GlCheckboxGroup

Checkbox and checkbox group. Registered as PascalCase.

```vue
<GlCheckboxGroup v-model="selectedItems">
  <GlCheckbox label="a">Option A</GlCheckbox>
  <GlCheckbox label="b">Option B</GlCheckbox>
</GlCheckboxGroup>
```

---

### GlRadio / GlRadioGroup

Radio button and radio group. Registered as PascalCase.

```vue
<GlRadioGroup v-model="choice">
  <GlRadio label="opt1">Option 1</GlRadio>
  <GlRadio label="opt2">Option 2</GlRadio>
</GlRadioGroup>
```

---

### gl-time-pick

Time picker input.

```vue
<gl-time-pick v-model="selectedTime" />
```

---

### gl-week-select

Day-of-week selector for scheduling.

```vue
<gl-week-select v-model="selectedDays" />
```

---

### gl-upload-card

File upload with drag-and-drop.

```vue
<gl-upload-card @change="handleFile" />
```

---

## Data Display

### gl-table / gl-table-column

Data table. Props extracted from runtime:

**gl-table:**

| Prop | Type | Description |
|------|------|-------------|
| `data` | Array | Row data |
| `border` | Boolean | Show borders |
| `stripe` | Boolean | Striped rows |
| `height` | String/Number | Fixed height |
| `emptyText` | String | Text when empty |

**gl-table-column:**

| Prop | Type | Description |
|------|------|-------------|
| `prop` | String | Key in row data |
| `label` | String | Column header |
| `width` | String/Number | Fixed width |
| `minWidth` | String/Number | Minimum width |
| `sortable` | Boolean/String | Enable sorting |
| `formatter` | Function | Cell value formatter |

```vue
<gl-table :data="rows">
  <gl-table-column prop="name" label="Name" sortable />
  <gl-table-column prop="value" label="Value" />
</gl-table>
```

---

### gl-percent-circle

Circular percentage indicator.

| Prop | Type | Description |
|------|------|-------------|
| `percent` | Number | Value 0-100 |

```vue
<gl-percent-circle :percent="75" />
```

---

### gl-line-chart

Firmware-provided Chart.js line chart. The verified native contract is identical
on GL-MT3000 4.8.1 and GL-MT6000 4.9.1.

| Prop | Type | Default | Description |
|---|---|---|---|
| `id` | String, Number | `""` | Optional canvas ID suffix |
| `labels` | Array | `[]` | X-axis labels |
| `value` | Array | `[]` | Single dataset values |
| `values` | Array | `[]` | Multiple dataset arrays; takes precedence over `value` |
| `datasetLabels` | Array | `[]` | Dataset legend labels |
| `backgroundColor` | String, Array | `""` | Dataset background colors |
| `borderColor` | String, Array | `""` | Dataset line colors |
| `borderWidth` | Number | `2` | Dataset line width |
| `height` | String, Number | `75` | Chart height in pixels |
| `fill` | Boolean | `true` | Fill datasets to the origin |
| `x` | Object | `{ display: false }` | Chart.js X scale options |
| `y` | Object | `{ display: false, min: 0 }` | Chart.js Y scale options |
| `plugins` | Object | `{}` | Chart.js plugin options |

```vue
<gl-line-chart
  :labels="labels"
  :value="latency"
  :border-color="'#1785ff'"
  :height="210"
  :x="{ display: true }"
  :y="{ display: true, min: 0, max: 200 }"
/>
```

The native component depends on input identity when data and options change.
Use the tested `GlStableLineChart` adapter for polling views, stable scales, or
timeline overlays. See [Native Charts](charts.md).

---

### gl-battery

Battery level icon.

| Prop | Type | Description |
|------|------|-------------|
| `size` | Number | Icon size |
| `vertical` | Boolean | Vertical orientation |
| `theme` | String | Color theme |

```vue
<gl-battery :size="24" />
```

---

### gl-wireless-signal

Wi-Fi signal strength icon.

```vue
<gl-wireless-signal :level="3" />
```

---

### gl-qrcode

QR code generator.

```vue
<gl-qrcode :value="qrData" />
```

---

### gl-ellipsis-tooltip

Truncates text with hover tooltip.

| Prop | Type | Description |
|------|------|-------------|
| `placement` | String | `"top"`, `"bottom"`, `"left"`, `"right"` |

```vue
<gl-ellipsis-tooltip placement="top">
  Very long text that gets truncated...
</gl-ellipsis-tooltip>
```

---

## Feedback

### gl-tips

Inline tip block.

**Important:** Pass text via the `:tips` prop, not slot content. Slot content renders empty.

| Prop | Type | Description |
|------|------|-------------|
| `tips` | String | The message text |
| `state` | String | `"info"`, `"warning"`, `"error"`, `"success"` |
| `sign` | String | Icon style (`"none"` to hide) |
| `iconClass` | String | Custom icon class |

```vue
<gl-tips state="warning" tips="Changes require a reboot." />
<gl-tips v-if="error" state="error" :tips="error" />
```

---

### gl-guide-icon

Help icon with tooltip on hover.

| Prop | Type | Description |
|------|------|-------------|
| `content` | String | Tooltip text |

```vue
<gl-guide-icon content="This controls the DNS server." />
```

---

### $message (programmatic)

Toast notification. Not a component — called via `this.$message()`.

```js
this.$message({ type: 'success', message: 'Settings saved.' });
this.$message({ type: 'error', message: 'Operation failed.' });
```

---

### $alert (programmatic)

Alert dialog. Called via `this.$alert()`.

```js
this.$alert('Are you sure?', 'Confirm', {
  confirmButtonText: 'OK',
  callback: function(action) { /* ... */ }
});
```

---

### gl-pwd-strength

Password strength indicator.

```vue
<gl-pwd-strength :password="newPassword" />
```

---

## Element UI Components

The admin panel bundles Element UI 2.x. These components are globally available:

| Component | Tag | Purpose |
|-----------|-----|---------|
| ElDialog | `<ElDialog>` | Modal dialog |
| ElForm | `<ElForm>` | Form wrapper with validation |
| el-form-item | `<el-form-item>` | Form field wrapper |
| el-input | `<el-input>` | Text/textarea/password input |
| el-select | `<el-select>` | Dropdown select |
| ElOption | `<ElOption>` | Select option |
| ElTabs / ElTabPane | `<ElTabs>` | Tab panels |
| ElTooltip | `<ElTooltip>` | Hover tooltip |
| ElPopover | `<ElPopover>` | Click/hover popover |
| ElSlider | `<ElSlider>` | Range slider |
| ElPagination | `<ElPagination>` | Page navigation |
| ElMenu / ElMenuItem | `<ElMenu>` | Navigation menu |
| ElSubmenu | `<ElSubmenu>` | Nested menu item |

See [Element UI 2.x docs](https://element.eleme.io/#/en-US/component/) for full API.

---

## Other GL.iNet Components

| Component | Tag | Purpose |
|-----------|-----|---------|
| GlDraggableSort | `<GlDraggableSort>` | Drag-and-drop reordering |
| GlScanWifi | `<GlScanWifi>` | Wi-Fi scanning trigger |
| GlWifiList | `<GlWifiList>` | Wi-Fi network list for selection |

---

## Complete Globally Registered Component List

Firmware 4.8.1, GL-MT3000. Extracted via `Object.keys(Vue.options.components)`:

**GL.iNet registry keys (36):**
```
gl-battery          GlCheckboxGroup   GlDropdownItem       gl-qrcode
gl-button           GlCollapse        gl-ellipsis-tooltip  GlRadio
gl-card             GlCollapseGroup   gl-guide-icon        GlRadioGroup
gl-cascader         GlDraggableSort   gl-line-chart        GlScanWifi
GlCheckbox          gl-drawer         gl-link              gl-search-input
GlDropdown          gl-percent-circle gl-private           gl-pwd-strength
gl-switch           gl-table          gl-table-column      gl-time-pick
gl-tips             gl-title          GlToggle             GlToggleItem
gl-upload-card      gl-week-select     GlWifiList           gl-wireless-signal
```

**Element UI registry keys (16):**
```
ElDialog         el-input          ElOption          ElSubmenu
ElForm           ElMenu            ElPagination      ElTabPane
el-form-item     ElMenuItem        ElPopover         ElTabs
                 ElMenuItemGroup   el-select         ElTooltip
                                    ElSlider
```

The two additional global Vue Router helpers are `RouterLink` and `RouterView`.
They are reported separately because they are routing infrastructure, not UI-kit
components.

**NOT globally registered (local only, unavailable to plugins):**
```
gl-btn           gl-alert          gl-message-fade
```

## Firmware Differences

The verified GL-MT3000 4.9.0 beta6 registry contains 57 UI components plus the
same two Vue Router helpers. It adds five components and removes none:

```
gl-agree-check   gl-number-input   gl-otp-input   gl-select-timezone   gl-steps
```

Known prop-level changes between the inspected 4.8.1 and 4.9.0 beta6 builds:

| Component | Change in 4.9.0 beta6 |
|---|---|
| `GlDraggableSort` | Added `group` |
| `GlScanWifi` | Removed `clientList` |
| `gl-ellipsis-tooltip` | Added `isDisabled` |
| `gl-wireless-signal` | Added `signalRangs` |

These differences are compatibility evidence, not a stable vendor API guarantee.

## Extraction Contract

`glplugin extract root@<router-ip>` computes SHA-256 over the decompressed admin
bundle. If that fingerprint matches a runtime-verified catalog, the output contains:

- `componentRegistry.status: "verified"`
- exact `registryKey`, canonical `tag`, origin, and parent requirement metadata
- UI components and Vue Router helpers in separate arrays
- the legacy `components` field populated only with verified canonical UI tags

For an unknown fingerprint, `componentRegistry.status` is `unknown` and
`components` is empty. `literalComponentRegistrations` is retained only as an
incomplete review aid; it must not be published as the global registry. This is
intentional: statically finding `gl-*` strings previously mixed CSS classes and local
view internals into the component list while missing PascalCase and Element UI keys.

On the inspected 4.8.1 bundle, the old string regex returned 49 names. Only 29
resolved to real global UI tags, 20 were CSS/local/internal names, and 23 real global
UI tags were absent from its output. This audit is why unknown fingerprints now fail
closed instead of returning a plausible-looking component count.

---

## Notes

- Use CSS variables for theming: `--error-color`, `--warning-color`, `--success-color`,
  `--title-color`, `--text-color`, `--hint-color`, `--card-bg`, `--table-border`, etc.
- Props documented above were extracted via `Vue.options.components[name].options.props` at runtime.
- See `docs/theme.md` for the full list of CSS variables.
- Use `glplugin extract root@<router-ip>` to identify a verified firmware catalog or
  collect explicitly unverified diagnostics for a new bundle.
