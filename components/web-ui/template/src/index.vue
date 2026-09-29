<template>
  <div class="__PLUGIN_ID__-wrapper">
    <gl-title :title="$t('__I18N_KEY__.title')" />
    <gl-card class="gl-sdk4-card">
      <h2 class="plugin-title">__PLUGIN_TITLE__</h2>
      <p class="plugin-copy">
        Plugin is working. Edit <code>src/index.vue</code> to get started.
      </p>
    </gl-card>
  </div>
</template>

<script>
export default {
  name: '__PLUGIN_ID__',
};
</script>

<style src="@gl-sdk4-plugin-kit/gl-card.css"></style>

<style scoped>
.__PLUGIN_ID__-wrapper {
  padding: 20px 0;
}
.plugin-title {
  color: var(--title-color);
  margin: 0 0 12px;
}
.plugin-copy {
  color: var(--text-color);
  line-height: 1.8;
}
code {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-size: 13px;
  padding: 2px 6px;
}
</style>
