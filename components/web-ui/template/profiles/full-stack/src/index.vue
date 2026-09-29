<template>
  <div class="__PLUGIN_ID__-wrapper">
    <gl-title :title="$t('__I18N_KEY__.title')" />

    <gl-card class="gl-sdk4-card">
      <gl-tips state="info" :tips="$t('__I18N_KEY__.description')" />

      <div v-if="loading" class="backend-state">
        {{ $t('__I18N_KEY__.loading') }}
      </div>

      <div v-else-if="error" class="backend-state backend-state--error">
        {{ $t('__I18N_KEY__.failed') }}: {{ error }}
      </div>

      <div v-else class="backend-result">
        <div class="result-row">
          <span>{{ $t('__I18N_KEY__.backend') }}</span>
          <strong>{{ result.backend }}</strong>
        </div>
        <div class="result-row">
          <span>{{ $t('__I18N_KEY__.configuration') }}</span>
          <strong>{{ result.enabled ? $t('__I18N_KEY__.enabled') : $t('__I18N_KEY__.disabled') }}</strong>
        </div>
        <div class="result-row">
          <span>{{ $t('__I18N_KEY__.uptime') }}</span>
          <strong>{{ formatUptime(result.uptimeSeconds) }}</strong>
        </div>
      </div>

      <gl-button type="primary" :loading="loading" @click="loadBackend">
        {{ $t('__I18N_KEY__.refresh') }}
      </gl-button>
    </gl-card>
  </div>
</template>

<script>
import { createAdminSessionHeaders } from '@gl-sdk4-plugin-kit/admin-session';

export default {
  name: '__PLUGIN_ID__',
  data() {
    return {
      loading: false,
      error: '',
      result: {},
    };
  },
  created() {
    this.loadBackend();
  },
  methods: {
    async loadBackend() {
      this.loading = true;
      this.error = '';
      try {
        var response = await fetch('/cgi-bin/gl-sdk4-ui-__PLUGIN_ID__', {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: createAdminSessionHeaders(window, { Accept: 'application/json' }),
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        var payload = await response.json();
        if (payload.status !== 'ok') throw new Error(payload.error || 'invalid_response');
        this.result = payload;
      } catch (error) {
        this.error = error && error.message ? error.message : String(error);
      } finally {
        this.loading = false;
      }
    },
    formatUptime(value) {
      var seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds < 0) return '--';
      var days = Math.floor(seconds / 86400);
      var hours = Math.floor((seconds % 86400) / 3600);
      var minutes = Math.floor((seconds % 3600) / 60);
      return days + 'd ' + hours + 'h ' + minutes + 'm';
    },
  },
};
</script>

<style src="@gl-sdk4-plugin-kit/gl-card.css"></style>

<style scoped>
.__PLUGIN_ID__-wrapper {
  padding: 20px 0;
}
.backend-state,
.backend-result {
  margin: 20px 0;
}
.backend-state {
  color: var(--label-color);
}
.backend-state--error {
  color: var(--error-color);
}
.result-row {
  align-items: center;
  border-bottom: 1px solid var(--table-border);
  color: var(--label-color);
  display: flex;
  justify-content: space-between;
  padding: 12px 0;
}
.result-row strong {
  color: var(--text-color);
}
</style>
