/**
 * Model Picker — browser half.
 *
 * Shadows the composer's model seat (`conversation.input.model`) at priority -1
 * and replaces the two-row drilled menu with one two-pane dialog: a searchable,
 * grouped list on the left and a detail card on the right.
 *
 * The list is the shipped per-session `modelDirectories` store, so selection
 * goes through the same service the shipped seat uses and every other surface
 * stays in sync. Catalogue-only facts (reference price, context window, input
 * modalities) are not on that store; they arrive from this plugin's own Host
 * half over `/api/model-picker/*`.
 *
 * Hand-written ModuleLoader bundle: plain JavaScript, no build step, and no
 * import beyond the React the shell already provides.
 */
window.__ModuleLoader__.load({
  id: 'dsh-model-picker',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const { createElement: h, Fragment, useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'modelPicker'

    const API = (() => {
      try {
        return new URL('api/model-picker', document.baseURI).pathname
      } catch {
        return '/api/model-picker'
      }
    })()

    // ── diagnostics ───────────────────────────────────────────────────────────
    // A shadowing entry that throws is retired by the Slot ledger and the
    // shipped seat silently takes the cell back, so a crash looks exactly like
    // "the plugin did nothing". Post the real cause to the Host half, which
    // appends it to a log beside the preference file.
    const REPORT_URL = `${API}/report`
    const report = (kind, detail) => {
      try {
        fetch(REPORT_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, registrant: 'dsh-model-picker', ...detail }),
        }).catch(() => {})
      } catch {}
    }
    const describeError = cause => {
      const error = cause instanceof Error ? cause : new Error(String(cause))
      return {
        message: error.message,
        stack: typeof error.stack === 'string' ? error.stack.slice(0, 4000) : undefined,
      }
    }
    // Build fingerprint: tells "this bundle never reached the page" apart from
    // "it loaded and then failed", and proves which generation is live.
    const BUILD = 'heartbeat-1'

    /**
     * Seat wrapper: catch a render throw, post it, then rethrow so the Slot
     * ledger still abdicates onto the shipped seat. The diagnostic must never
     * change what the user sees. Built once — a fresh component identity per
     * registration would remount the seat on every recompose.
     */
    function ModelPickerSeat(props) {
      try {
        return ModelPicker(props)
      } catch (error) {
        report('render', describeError(error))
        throw error
      }
    }

    // ── copy ──────────────────────────────────────────────────────────────────
    const DICT = {
      zh: {
        'meta.title': '模型选择器',
        'meta.description': '把输入框的模型下拉菜单换成双栏选择器：可搜索、按供应商分组、收藏与最近使用一目了然，右侧显示参考价格、上下文与能力标签。',
        'trigger.loading': '加载中…',
        'trigger.select': '选择模型',
        'trigger.aria': '当前模型 {model}，点击选择模型',
        'trigger.ariaEffort': '当前模型 {model}，推理强度 {effort}，点击选择模型',
        'dialog.title': '选择模型',
        'dialog.subtitle': '搜索或按供应商浏览，选中后切换当前会话的模型',
        'search.placeholder': '搜索模型、能力、供应商…',
        'search.clear': '清除搜索',
        'search.empty': '没有匹配的模型',
        'group.favorites': '收藏',
        'group.recents': '最近使用',
        'group.results': '搜索结果',
        'group.unavailable': '未能加载',
        'group.expand': '展开 {group}',
        'group.collapse': '收起 {group}',
        'group.count': '{count} 个模型',
        'failure.entry': '{provider}：{message}',
        'provider.account': 'DeepSeek 官方账号',
        'status.loading': '正在获取模型清单…',
        'status.error': '模型清单加载失败',
        'status.retry': '重试',
        'status.empty': '当前没有可用的模型路由',
        'status.selecting': '正在切换…',
        'error.sessionInUse': '该会话正在写入，请稍后再试。',
        'error.select': '切换失败：{message}',
        'error.default': '保存默认模型失败：{message}',
        'tag.reasoning': '推理',
        'tag.vision': '视觉',
        'price.free': '免费',
        'price.unknown': '未收录',
        'detail.price': '价格',
        'detail.noPrice': '该模型没有价格数据：Harness 的 provider 接口不提供价格，因此这里不显示金额。实际计费请查阅供应商账单。',
        'detail.capacity': '容量',
        'row.price': '{input}/{output}',
        'detail.input': '输入',
        'detail.output': '输出',
        'detail.cacheRead': '缓存读',
        'detail.cacheWrite': '缓存写',
        'detail.context': '上下文',
        'detail.maxOutput': '最大输出',
        'detail.capability': '能力',
        'detail.modality.text': '文本',
        'detail.modality.image': '图像',
        'detail.reasoning': '推理强度',
        'effort.providerDefault': '供应商默认',
        'detail.description': '说明',
        'detail.noDescription': '该供应商未提供模型说明。',
        'detail.tech': '技术信息',
        'detail.id': '模型 ID',
        'detail.providerId': '供应商路由',
        'action.apply': '使用此模型',
        'action.applyEffort': '使用此模型 · {effort}',
        'action.setDefault': '设为默认',
        'action.defaultSaved': '已设为默认',
        'action.details': '详情',
        'action.hideDetails': '收起',
        'action.copied': '已复制',
        'action.favorite': '收藏',
        'action.unfavorite': '取消收藏',
        'action.close': '关闭',
        'badge.default': '默认',
        'badge.current': '当前',
        'detail.selectHint': '点击左侧模型查看详情，回车或「使用此模型」完成切换。',
      },
      en: {
        'meta.title': 'Model Picker',
        'meta.description': 'Replaces the composer model menu with a two-pane picker: search, provider groups, favorites and recents on the left, reference pricing, context and capabilities on the right.',
        'trigger.loading': 'Loading…',
        'trigger.select': 'Choose a model',
        'trigger.aria': 'Current model {model}. Choose a model',
        'trigger.ariaEffort': 'Current model {model}, reasoning effort {effort}. Choose a model',
        'dialog.title': 'Choose a model',
        'dialog.subtitle': 'Search or browse by provider, then switch this session to the model you pick.',
        'search.placeholder': 'Search models, capabilities, providers…',
        'search.clear': 'Clear search',
        'search.empty': 'No matching models',
        'group.favorites': 'Favorites',
        'group.recents': 'Recent',
        'group.results': 'Results',
        'group.unavailable': 'Unavailable',
        'group.expand': 'Expand {group}',
        'group.collapse': 'Collapse {group}',
        'group.count': '{count} models',
        'failure.entry': '{provider}: {message}',
        'provider.account': 'DeepSeek account',
        'status.loading': 'Loading the model catalog…',
        'status.error': 'The model catalog failed to load',
        'status.retry': 'Retry',
        'status.empty': 'No model routes are available',
        'status.selecting': 'Switching…',
        'error.sessionInUse': 'This session is being written to. Try again shortly.',
        'error.select': 'Could not switch: {message}',
        'error.default': 'Could not save the default model: {message}',
        'tag.reasoning': 'Reasoning',
        'tag.vision': 'Vision',
        'price.free': 'Free',
        'price.unknown': 'Unknown',
        'detail.price': 'Price',
        'detail.noPrice': 'No price data for this model: the Harness provider interface reports no price, so no amount is shown. See the provider invoice for actual billing.',
        'detail.capacity': 'Capacity',
        'row.price': '{input}/{output}',
        'detail.input': 'Input',
        'detail.output': 'Output',
        'detail.cacheRead': 'Cache read',
        'detail.cacheWrite': 'Cache write',
        'detail.context': 'Context',
        'detail.maxOutput': 'Max output',
        'detail.capability': 'Capabilities',
        'detail.modality.text': 'Text',
        'detail.modality.image': 'Image',
        'detail.reasoning': 'Reasoning effort',
        'effort.providerDefault': 'Provider default',
        'detail.description': 'About',
        'detail.noDescription': 'This provider publishes no model description.',
        'detail.tech': 'Technical',
        'detail.id': 'Model id',
        'detail.providerId': 'Provider route',
        'action.apply': 'Use this model',
        'action.applyEffort': 'Use this model · {effort}',
        'action.setDefault': 'Set as default',
        'action.defaultSaved': 'Default saved',
        'action.details': 'Details',
        'action.hideDetails': 'Hide details',
        'action.copied': 'Copied',
        'action.favorite': 'Favorite',
        'action.unfavorite': 'Remove favorite',
        'action.close': 'Close',
        'badge.default': 'Default',
        'badge.current': 'Current',
        'detail.selectHint': 'Click a model on the left to inspect it, then Enter or “Use this model” to switch.',
      },
    }

    // ── styles ────────────────────────────────────────────────────────────────
    const CSS = `
.mp-root { min-width: 0; position: relative; }
.mp-trigger {
  display: flex; align-items: center; gap: 4px; height: 28px; min-width: 0;
  max-width: 360px; padding: 0 4px 0 8px;
  border: none; border-radius: var(--dsw-radius-sm, 6px); outline: none;
  background: transparent; color: var(--dsw-alias-label-secondary);
  font-size: 13px; font-weight: 400; line-height: 20px; cursor: pointer;
}
.mp-trigger:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mp-trigger:focus-visible { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }
.mp-trigger:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.mp-triggerLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: var(--dsh-composer-model-text-display, block); }
.mp-triggerEffort { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 1000; color: var(--dsw-alias-label-caption); display: var(--dsh-composer-model-text-display, block); }
.mp-triggerIcon { flex: none; display: var(--dsh-composer-model-icon-display, none); }
.mp-triggerChevron { flex: none; color: var(--dsw-alias-label-caption); }

.mp-backdrop {
  /* Stops below the window chrome so the title bar stays draggable. */
  position: fixed; inset: var(--dsh-frame-top-clearance, 0px) 0 0; z-index: 1200;
  padding: 32px 24px;
  display: flex; align-items: center; justify-content: center;
  background: var(--dsw-alias-bg-mask-1, rgba(15, 17, 21, 0.32));
  animation: mp-fade 120ms ease-out;
}
@keyframes mp-fade { from { opacity: 0 } to { opacity: 1 } }
.mp-card {
  display: flex; flex-direction: column; overflow: hidden;
  width: min(920px, 100%); height: min(620px, 100%);
  /* The card must stay opaque under any theme, including third-party skins.
     The stock overlay token is already translucent, and skins make it worse:
     dsh-dream-skin republishes --dsw-alias-bg-overlay as
     rgba(255,255,255,0.92), so the conversation behind the dialog bled
     through. Read, in order: the skin's own paper colour (opaque by its
     contract), the app base (a solid hex in every shipped skin), the overlay
     token, then a literal white. The first one that resolves has no alpha. */
  background: var(--dsh-dream-skin-modal-base,
    var(--dsw-alias-bg-base,
      var(--dsw-alias-bg-overlay, #fff)));
  color: var(--dsw-alias-label-primary);
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-panel, 14px);
  box-shadow: var(--dsw-elevation-prominent, 0 24px 64px rgba(0, 0, 0, 0.28));
  font-size: 13px; line-height: 20px;
}
.mp-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 16px 18px 10px; }
.mp-title { font-size: 15px; font-weight: 600; line-height: 22px; }
.mp-subtitle { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.mp-close {
  flex: none; display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
  border: none; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary); cursor: pointer;
}
.mp-close:hover { background: var(--dsw-alias-interactive-bg-hover); }
.mp-panes { display: flex; min-height: 0; flex: 1; border-top: 1px solid var(--dsw-alias-border-l1); }

.mp-left { display: flex; flex-direction: column; min-height: 0; width: 53%; border-right: 1px solid var(--dsw-alias-border-l1); }
.mp-search { position: relative; padding: 10px 12px 8px; }
.mp-searchIcon { position: absolute; top: 50%; left: 20px; transform: translateY(-50%); color: var(--dsw-alias-label-caption); pointer-events: none; }
.mp-searchInput {
  width: 100%; box-sizing: border-box; height: 30px; padding: 0 26px 0 25px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-2, transparent); color: inherit;
  font: inherit; font-size: 12px; outline: none;
}
.mp-searchInput::placeholder { color: var(--dsw-alias-label-caption); }
.mp-searchInput:focus { border-color: var(--dsw-alias-state-business-primary); }
.mp-searchClear {
  position: absolute; top: 50%; right: 18px; transform: translateY(-50%);
  width: 20px; height: 20px; display: grid; place-items: center; padding: 0;
  border: none; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer;
}
.mp-searchClear:hover { background: var(--dsw-alias-interactive-bg-hover); }

.mp-list {
  flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 10px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
/* Groups are separated by space, not by a rule. Each header now carries its own
   mark, which is the boundary readers actually use; adding a hairline as well
   would be two weak signals where one clear one already works. */
.mp-group + .mp-group { margin-top: 14px; }
.mp-sectionTitle {
  position: sticky; top: 0; z-index: 1; padding: 8px 4px 4px;
  /* Sticky, so scrolled rows pass underneath it: it needs the same opaque
     stack as the card or the rows ghost through the header. */
  background: var(--dsh-dream-skin-modal-base,
    var(--dsw-alias-bg-base,
      var(--dsw-alias-bg-overlay, #fff)));
  color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase;
}
/* A collapsible group header is a real button, so it has to keep the title's
   look while gaining a full-width hit area and a disclosure triangle. */
.mp-sectionTitle[data-toggle] {
  display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box;
  border: none; border-radius: var(--dsw-radius-sm, 4px);
  font: inherit; font-size: 11px; font-weight: 600;
  letter-spacing: 0.04em; text-transform: uppercase; text-align: left;
  cursor: pointer;
}
.mp-sectionTitle[data-toggle]:hover { color: var(--dsw-alias-label-secondary); }
.mp-sectionTitle[data-toggle]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -2px;
}
.mp-sectionLabel { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* Provider mark: a tinted tile whose hue comes from the provider id. It is a
   generated anchor, not a vendor logo — Harness exposes no provider icon. */
.mp-mark {
  flex: none; display: grid; place-items: center; box-sizing: border-box;
  font-weight: 600; line-height: 1; letter-spacing: 0;
}
/* Favorites/recents/results are not providers, so they carry a glyph instead of a
   mark. It occupies the same 22px slot, otherwise those headings would start
   their label 8px left of the provider headings above them. */
.mp-sectionGlyph { flex: none; width: 22px; opacity: 0.75; }
.mp-sectionTitle[data-toggle] .mp-mark { margin-right: 1px; }
.mp-sectionCount {
  flex: none; padding: 0 5px; border-radius: 999px;
  background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-layer-2));
  color: var(--dsw-alias-label-caption);
  font-size: 10px; font-weight: 500; letter-spacing: 0;
}
.mp-row {
  display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box;
  /* Indented to the group heading's label, not to the card edge: disclosure (10)
     + gap (6) + mark (22) + gap (6) puts that label at 48px from the card, and a
     row whose text starts anywhere else reads as a sibling of its own heading.
     The mark lives on the heading only — repeating it per row said the same
     provider name once per line. */
  padding: 6px 6px 6px 48px; border: none; border-radius: var(--dsw-radius-md, 8px);
  background: transparent; color: inherit; text-align: left; cursor: pointer;
  /* One height for every row. A model whose provider declares no capabilities
     keeps the same row as one that does, so the list reads as an even grid
     instead of alternating tall and short rows. */
  min-height: 40px;
}
/* 4px between adjacent model rows inside one group; the first row of a group
   and the section titles are left untouched. */
.mp-row + .mp-row { margin-top: 4px; }
.mp-row:hover, .mp-row[data-active] { background: var(--dsw-alias-interactive-bg-hover); }
.mp-row[data-selected] { background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }
.mp-row[data-selected] .mp-rowName { font-weight: 600; }
.mp-rowMain {
  min-width: 0; flex: 1; display: flex; flex-direction: column;
  justify-content: center; gap: 1px;
}
.mp-rowName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
/* The band keeps its height whether or not it holds tags, so the name sits at the
   same offset in every row; hiding rather than removing it keeps the geometry. */
.mp-rowTags { display: flex; align-items: center; gap: 4px; min-height: 14px; }
.mp-rowTags[data-empty] { visibility: hidden; }
.mp-tag {
  padding: 0 4px; border-radius: 4px; background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary); font-size: 10px; line-height: 14px;
}
.mp-tag[data-kind="vision"] { color: var(--dsw-alias-state-business-primary); }
.mp-rowPrice { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.mp-star {
  flex: none; display: grid; place-items: center; width: 20px; height: 20px; padding: 0;
  border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-caption); cursor: pointer;
}
.mp-star:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }
.mp-star[data-on] { color: var(--dsw-alias-state-warn-primary, var(--dsw-alias-label-primary)); }
.mp-note { padding: 12px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.mp-note[data-kind="error"] { color: var(--dsw-alias-state-error-primary); }
.mp-retry { margin-left: 6px; padding: 0; border: none; background: transparent; color: inherit; font: inherit; font-weight: 600; text-decoration: underline; cursor: pointer; }

.mp-right {
  display: flex; flex-direction: column; min-height: 0; flex: 1; overflow-y: auto;
  padding: 16px 18px 18px; gap: 12px;
  --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2);
  --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2);
}
.mp-detailHead { display: flex; align-items: flex-start; gap: 8px; }
.mp-detailName { font-size: 16px; font-weight: 600; line-height: 24px; word-break: break-word; }
.mp-detailMeta { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.mp-badges { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mp-chip {
  padding: 1px 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 16px;
}
.mp-chip[data-tone="current"] { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-state-business-primary); }
.mp-block { border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 10px; }
.mp-blockTitle { margin-bottom: 6px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.mp-grid { display: grid; grid-template-columns: 1fr auto; row-gap: 4px; column-gap: 12px; font-variant-numeric: tabular-nums; }
.mp-grid dt { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.mp-grid dd { margin: 0; text-align: right; font-size: 12px; }
.mp-desc { color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 19px; word-break: break-word; }
.mp-hint { color: var(--dsw-alias-label-caption); font-size: 11px; line-height: 16px; }
.mp-efforts { display: flex; flex-wrap: wrap; gap: 6px; }
.mp-effort {
  padding: 3px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
}
.mp-effort:hover { background: var(--dsw-alias-interactive-bg-hover); }
.mp-effort[data-on] { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-interactive-bg-hover-accent, transparent); color: var(--dsw-alias-label-primary); font-weight: 600; }
.mp-actions { display: flex; align-items: center; gap: 8px; margin-top: auto; padding-top: 12px; }
.mp-button {
  height: 30px; padding: 0 12px; border-radius: var(--dsw-radius-md, 8px); font: inherit; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: transparent; color: var(--dsw-alias-label-primary);
}
.mp-button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.mp-button:disabled { color: var(--dsw-alias-label-dimmed); cursor: default; }
.mp-button[data-variant="primary"] {
  border-color: transparent; background: var(--dsw-alias-button-primary-fill, var(--dsw-alias-state-business-primary));
  color: var(--dsw-alias-label-primary-foreground, #fff); font-weight: 600;
}
.mp-button[data-variant="primary"]:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--dsw-alias-state-business-primary)); }
.mp-button[data-variant="ghost"] { border-color: transparent; color: var(--dsw-alias-label-secondary); }
.mp-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
`

    // ── helpers ───────────────────────────────────────────────────────────────
    /** Key for one provider/model pair; mirrors the Host half. */
    const modelKey = (provider, model) => `${provider}\u0000${model}`

    /** A hung Host route must not leave the dialog waiting forever. */
    const REQUEST_TIMEOUT_MS = 8000

    /**
     * One request to this plugin's Host half.
     * @param {string} suffix - route under {@link API}.
     * @param {{method?: string, body?: unknown}} [options] - verb and JSON body.
     * @returns {Promise<any>} the parsed payload; rejects on non-2xx or timeout.
     */
    async function request(suffix, options = {}) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(`${API}${suffix}`, {
          method: options.method ?? 'GET',
          redirect: 'error',
          signal: controller.signal,
          headers: options.body === undefined
            ? { accept: 'application/json' }
            : { accept: 'application/json', 'content-type': 'application/json' },
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
        })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        return payload
      } finally {
        clearTimeout(timer)
      }
    }

    const formatTokens = value => {
      if (!Number.isInteger(value) || value <= 0) return undefined
      if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 === 0 ? 0 : 1)}M`
      if (value >= 1000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    const formatPrice = value => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value === 0) return '0'
      if (value < 0.01) return value.toFixed(3).replace(/0+$/u, '')
      if (value < 1) return value.toFixed(2).replace(/0+$/u, '')
      return value.toFixed(2).replace(/\.00$/u, '')
    }

    /** `$0.3/$1.2`, `免费`, or `未收录`. */
    /** Whether this model arrived with any price at all. */
    const hasPrice = meta => meta !== undefined && meta.cost !== null

    const priceText = (meta, t) => {
      if (!hasPrice(meta)) return t('price.unknown')
      if (meta.cost.input === 0 && meta.cost.output === 0) return t('price.free')
      return t('row.price', { input: `$${formatPrice(meta.cost.input)}`, output: `$${formatPrice(meta.cost.output)}` })
    }

    /**
     * Sort provider groups so the account and official routes lead, matching the
     * shipped seat's ordering. Model order within a group is preserved.
     */
    const orderGroups = groups => groups.toSorted((left, right) =>
      (left.id === 'deepseek-account' ? 0 : left.id === 'deepseek-official' ? 1 : 2)
      - (right.id === 'deepseek-account' ? 0 : right.id === 'deepseek-official' ? 1 : 2))

    /** The account provider has a localized title; every other group is as-is. */
    const groupName = (group, t) => (group.id === 'deepseek-account' ? t('provider.account') : group.name)

    /**
     * Capability tags for one list row, in display order.
     * @param {object} row - a picker row carrying `meta`.
     * @returns {Array<{kind: string, label: string}>} empty when the provider declared neither.
     */
    const tagsOf = (row, t) => {
      const tags = []
      if (row.meta?.reasoning !== undefined) tags.push({ kind: 'reasoning', label: t('tag.reasoning') })
      if (row.meta?.inputModalities?.includes('image') === true) tags.push({ kind: 'vision', label: t('tag.vision') })
      return tags
    }

    // Badge glyph: the first letter or digit when the provider name is Latin,
    // otherwise its first meaningful character, so a Chinese provider name keeps
    // "商" instead of collapsing to a placeholder dot.
    const letterOf = value => {
      const text = String(value ?? '')
      for (const char of text) {
        if (/[a-z0-9]/iu.test(char)) return char.toUpperCase()
      }
      for (const char of text) {
        if (/\S/u.test(char)) return char
      }
      return '·'
    }

    /**
     * Stable hue for a provider id.
     *
     * Harness exposes no provider icon: `listModels` and `resolveModelInfo` carry
     * no logo, avatar or brand field, so inventing a brand mark would be a claim
     * the data cannot back. What the list actually lacks is a repeatable anchor,
     * so this derives one from the id itself — the same provider always gets the
     * same hue and shape, and nothing is presented as the vendor's own logo.
     *
     * @param {string} id - provider id.
     * @returns {number} hue in degrees, 0..359.
     */
    const hueOf = id => {
      let hash = 0
      for (const char of String(id ?? '')) hash = (hash * 31 + char.codePointAt(0)) % 360000
      return hash % 360
    }

    /** Fill/stroke pair for a provider hue, readable in both themes. */
    const markColors = id => {
      const hue = hueOf(id)
      return {
        fill: `hsl(${hue} 62% 52% / 0.16)`,
        ink: `hsl(${hue} 58% 42%)`,
      }
    }

    /**
     * Header glyph for groups that are not a provider: favorites get a star,
     * recents a clock, results a magnifier. Without these, those three headers
     * were plain text next to provider headers that now carry a mark.
     */
    const SectionGlyph = ({ kind, size = 14 }) => {
      const common = {
        className: 'mp-sectionGlyph', width: size, height: size, viewBox: '0 0 16 16',
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.3,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        'data-kind': kind,
      }
      if (kind === 'favorites') {
        return h('svg', common, h('path', { d: 'M8 2.2l1.8 3.7 4 .6-2.9 2.85L11.6 13 8 11.2 4.4 13l.7-3.65L2.2 6.5l4-.6z' }))
      }
      if (kind === 'recents') {
        return h('svg', common,
          h('circle', { cx: 8, cy: 8, r: 5.6 }),
          h('path', { d: 'M8 4.9V8l2.2 1.5' }))
      }
      if (kind === 'results') {
        return h('svg', common,
          h('circle', { cx: 7.1, cy: 7.1, r: 4.1 }),
          h('path', { d: 'M10.2 10.2L13.4 13.4' }))
      }
      return h('svg', common, h('path', { d: 'M8 2.5v11M2.5 8h11' }))
    }

    /**
     * Provider mark: a rounded tile carrying the initial, tinted by a hue derived
     * from the provider id. Shape alternates between rounded-square and circle so
     * neighbouring groups separate even when their hues land close together.
     *
     * @param {{id: string, name: string, size?: number, className?: string}} props
     */
    const ProviderMark = ({ id, name, size = 18, className }) => {
      const { fill, ink } = markColors(id)
      return h('span', {
        className: ['mp-mark', className].filter(Boolean).join(' '),
        style: {
          width: `${size}px`,
          height: `${size}px`,
          background: fill,
          color: ink,
          fontSize: `${Math.round(size * (size >= 22 ? 0.5 : 0.58))}px`,
          borderRadius: hueOf(id) % 2 === 0 ? '50%' : '5px',
        },
        'aria-hidden': true,
      }, letterOf(name))
    }

    const matches = (haystack, needle) => {
      let at = 0
      for (const char of needle) {
        const found = haystack.indexOf(char, at)
        if (found < 0) return false
        at = found + char.length
      }
      return true
    }

    const contains = (row, query) => {
      const haystack = [
        row.model.name,
        row.model.id,
        row.providerName,
        row.provider,
        row.meta?.description ?? '',
        ...(row.meta?.inputModalities ?? []),
        row.meta?.reasoning === undefined ? '' : 'reasoning',
      ].join(' ').toLowerCase()
      return haystack.includes(query) || matches(haystack, query)
    }

    // ── icons ─────────────────────────────────────────────────────────────────
    const IconData = ({ size = 16, className }) => h('svg', {
      className, width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': true,
    },
      h('ellipse', { cx: 8, cy: 3.6, rx: 5.2, ry: 2.1 }),
      h('path', { d: 'M2.8 3.6v4.4c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1V3.6' }),
      h('path', { d: 'M2.8 8v4.4c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1V8' }),
    )

    const IconChevron = ({ size = 12, className }) => h('svg', {
      className, width: size, height: size, viewBox: '0 0 12 12', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M2.5 4.5 6 8l3.5-3.5' }))

    // Section disclosure triangle: points right when the group is collapsed,
    // rotates down when it is open.
    const IconDisclosure = ({ open, size = 10, className }) => h('svg', {
      className, width: size, height: size, viewBox: '0 0 12 12', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
      'aria-hidden': true,
      style: { transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 120ms ease' },
    }, h('path', { d: 'M4.5 2.5L8 6l-3.5 3.5' }))

    const IconStar = ({ filled, size = 14, className }) => h('svg', {
      className, width: size, height: size, viewBox: '0 0 16 16',
      fill: filled ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.2,
      strokeLinejoin: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M8 1.8l1.9 3.9 4.3.6-3.1 3 .74 4.3L8 11.6l-3.84 2 .74-4.3-3.1-3 4.3-.6z' }))

    const IconSearch = ({ size = 12, className }) => h('svg', {
      className, width: size, height: size, viewBox: '0 0 12 12', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', 'aria-hidden': true,
    }, h('circle', { cx: 5.2, cy: 5.2, r: 3.4 }), h('path', { d: 'M7.8 7.8L10.5 10.5' }))

    const IconClose = ({ size = 12, className }) => h('svg', {
      className, width: size, height: size, viewBox: '0 0 12 12', fill: 'none',
      stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', 'aria-hidden': true,
    }, h('path', { d: 'M2.5 2.5l7 7M9.5 2.5l-7 7' }))

    // ── picker ────────────────────────────────────────────────────────────────
    /**
     * The composer model seat.
     * @param props - owner `locked`, the injected face (`directory`, `load`,
     *   `select`, `available`), the standard locale seat and slot helpers.
     */
    function ModelPicker(props) {
      const { locked, available, directory, load, select, t, renderSlot } = props
      const state = React.useSyncExternalStore(
        useCallback(fn => directory.subscribe(fn), [directory]),
        useCallback(() => directory.getSnapshot(), [directory]),
      )
      const [open, setOpen] = useState(false)
      const triggerRef = useRef(null)
      const close = useCallback(() => {
        setOpen(false)
        triggerRef.current?.focus?.()
      }, [])
      const current = state.current
      const groups = state.groups ?? []

      // The trigger mirrors the shipped seat's caption: model name + effort.
      let currentModel
      let currentGroup
      for (const group of groups) {
        if (group.id !== current?.provider) continue
        for (const model of group.models) {
          if (model.id !== current.model) continue
          currentModel = model
          currentGroup = group
        }
      }
      let effortName
      if (currentModel !== undefined && current?.reasoningEffort !== undefined) {
        effortName = currentModel.reasoning?.efforts?.find(entry => entry.id === current.reasoningEffort)?.name
          // A level the catalog no longer lists still has a retained display name.
          ?? state.retainedEffort
      }
      // The label child slot lets another plugin rename a model wherever it is
      // shown, but only its declaring entry may render it — and that
      // declaration belongs to the shipped seat this registration shadows, so
      // rendering here can be refused. Probe once, then fall back to the
      // catalog name: names still render, overrides apply when they are allowed.
      const labelSlot = useRef(true)
      const labelOf = (provider, model, placement, selected) => {
        if (renderSlot === undefined || !labelSlot.current) return model.name
        try {
          return renderSlot(
            'conversation.input.model.label',
            { provider, model, placement, selected },
            { fallback: model.name },
          )
        } catch {
          labelSlot.current = false
          return model.name
        }
      }
      const label = currentModel === undefined || currentGroup === undefined
        ? (state.status === 'loading' ? t('trigger.loading') : t('trigger.select'))
        : labelOf({ id: currentGroup.id, name: groupName(currentGroup, t) }, currentModel, 'trigger', true)

      return h('div', { className: 'mp-root' },
        h('button', {
          ref: triggerRef,
          type: 'button',
          className: 'mp-trigger',
          disabled: locked === true || available === false,
          title: label,
          'aria-haspopup': 'dialog',
          'aria-expanded': open,
          'aria-label': available === false
            ? label
            : effortName === undefined
              ? t('trigger.aria', { model: label })
              : t('trigger.ariaEffort', { model: label, effort: effortName }),
          onClick: () => {
            if (!available) return
            setOpen(true)
            load()
          },
        },
          h(IconData, { className: 'mp-triggerIcon' }),
          h('span', { className: 'mp-triggerLabel' }, label),
          effortName !== undefined && h('span', { className: 'mp-triggerEffort' }, effortName),
          h(IconChevron, { className: 'mp-triggerChevron' }),
        ),
        open && available && ReactDOM.createPortal(
          h(PickerDialog, {
            state,
            select,
            load,
            t,
            labelOf,
            onClose: close,
          }),
          document.body,
        ),
      )
    }

    /**
     * The two-pane dialog body, rendered into a portal over the whole frame.
     */
    function PickerDialog({ state, select, load, t, labelOf, onClose }) {
      const [query, setQuery] = useState('')
      const [previewKey, setPreviewKey] = useState(null)
      const [effort, setEffort] = useState(undefined)
      const [activeIndex, setActiveIndex] = useState(0)
      const [meta, setMeta] = useState(null)
      const [favorites, setFavorites] = useState([])
      const [recents, setRecents] = useState([])
      const [defaultSelection, setDefaultSelection] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [showTech, setShowTech] = useState(false)
      // Every group is collapsible, so "open" can no longer be derived from the
      // section kind alone: favorites and recents open by default, provider
      // groups closed. This map records only the groups the user has toggled, so
      // unopened groups keep their own default instead of one shared default.
      const [groupOverrides, setGroupOverrides] = useState(() => new Map())
      // Flip the state the group is in right now, not a hardcoded `true`: the
      // first click on a default-open group (favorites) has to CLOSE it, and a
      // toggle that assumed "no override means closed" left it open forever.
      const toggleGroup = useCallback((id, defaultOpen) => {
        setGroupOverrides(previous => {
          const next = new Map(previous)
          const current = next.has(id) ? next.get(id) : defaultOpen === true
          next.set(id, !current)
          return next
        })
      }, [])
      const [copied, setCopied] = useState(false)
      const searchRef = useRef(null)
      const listRef = useRef(null)
      const rowRefs = useRef(new Map())

      const groups = state.groups ?? []
      const current = state.current

      // One catalog fetch per mount; the Host caches it for a short window.
      // Without it the picker still lists and switches models — it just cannot
      // show reference prices, favorites or recents.
      useEffect(() => {
        let alive = true
        request('/meta')
          .then(payload => {
            if (!alive) return
            setMeta(payload?.models ?? {})
            setFavorites(Array.isArray(payload?.favorites) ? payload.favorites : [])
            setRecents(Array.isArray(payload?.recents) ? payload.recents : [])
            setDefaultSelection(payload?.default ?? null)
          })
          .catch(() => {
            if (alive) setMeta({})
          })
        return () => {
          alive = false
        }
      }, [])

      useEffect(() => {
        searchRef.current?.focus?.()
      }, [])

      // The dialog lives in a portal, so the shell's own key handling is not on
      // the path: listen on the document and stop the page scrolling behind it.
      useEffect(() => {
        const onDocumentKeyDown = event => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        document.addEventListener('keydown', onDocumentKeyDown, true)
        return () => {
          document.removeEventListener('keydown', onDocumentKeyDown, true)
          document.body.style.overflow = previous
        }
      }, [onClose])

      const byKey = useMemo(() => {
        const map = new Map()
        for (const group of groups) {
          for (const model of group.models) map.set(modelKey(group.id, model.id), { group, model })
        }
        return map
      }, [groups])

      const rowOf = useCallback((key) => {
        const hit = byKey.get(key)
        if (hit === undefined) return null
        return {
          key,
          provider: hit.group.id,
          providerName: groupName(hit.group, t),
          model: hit.model,
          meta: meta?.[key],
        }
      }, [byKey, meta, t])

      // Sections: favorites, recents, then one per provider. A query collapses
      // everything into a single ranked result list.
      const sections = useMemo(() => {
        const trimmed = query.trim().toLowerCase()
        if (trimmed.length > 0) {
          const rows = []
          for (const [key, hit] of byKey) {
            const row = { instance: `results:${key}`, key, provider: hit.group.id, providerName: groupName(hit.group, t), model: hit.model, meta: meta?.[key] }
            if (contains(row, trimmed)) rows.push(row)
          }
          rows.sort((left, right) => {
            const leftExact = left.model.name.toLowerCase().startsWith(trimmed) ? 0 : 1
            const rightExact = right.model.name.toLowerCase().startsWith(trimmed) ? 0 : 1
            if (leftExact !== rightExact) return leftExact - rightExact
            return left.model.name.localeCompare(right.model.name)
          })
          return rows.length === 0 ? [] : [{ id: 'results', title: t('group.results'), rows, collapsible: false }]
        }
        // One model can appear in several sections at once (favorited, recent, and
        // in its provider group). The model key identifies the model; the row needs
        // its own identity as well, or the second rendering of a key overwrites the
        // first one's index and DOM node — hovering the favorite would then
        // highlight and scroll to the provider-group copy of the same row.
        const out = []
        const favoriteRows = favorites.map(rowOf).filter(Boolean)
          .map(row => ({ ...row, instance: `favorites:${row.key}` }))
        if (favoriteRows.length > 0) out.push({ id: 'favorites', title: t('group.favorites'), rows: favoriteRows, collapsible: true, defaultOpen: true, provider: null })
        const recentRows = recents.map(rowOf).filter(Boolean)
          .map(row => ({ ...row, instance: `recents:${row.key}` }))
        if (recentRows.length > 0) out.push({ id: 'recents', title: t('group.recents'), rows: recentRows, collapsible: true, defaultOpen: true, provider: null })
        for (const group of orderGroups(groups)) {
          const name = groupName(group, t)
          if (group.models.length === 0) continue
          out.push({
            id: `provider:${group.id}`,
            title: name,
            collapsible: true,
            defaultOpen: false,
            // The header renders the provider's mark, so the section has to know
            // which provider it is; the title string alone is not an id.
            provider: group.id,
            rows: group.models.map(model => ({
              instance: `provider:${group.id}:${model.id}`,
              key: modelKey(group.id, model.id),
              provider: group.id,
              providerName: name,
              model,
              meta: meta?.[modelKey(group.id, model.id)],
            })),
          })
        }
        // A provider whose catalog failed still gets a row, so the reason is
        // visible instead of looking like an empty catalog.
        const failures = state.failures ?? []
        if (failures.length > 0) {
          out.push({
            id: 'failures',
            title: t('group.unavailable'),
            rows: [],
            failures: failures.map(failure => ({
              id: failure.id,
              name: failure.id === 'deepseek-account' ? t('provider.account') : failure.name ?? failure.id,
              message: t('failure.entry', {
                provider: failure.id === 'deepseek-account' ? t('provider.account') : failure.name ?? failure.id,
                message: failure.message,
              }),
            })),
          })
        }
        return out
      }, [byKey, favorites, groups, meta, query, recents, rowOf, state.failures, t])

      // A group is open when it is not collapsible (search results) or when it is
      // open by its own default, unless the user toggled it. Only open groups
      // contribute rows to keyboard navigation, or Enter would apply a model from
      // a closed group.
      const isOpen = useCallback(
        section => {
          if (section.collapsible !== true) return true
          const override = groupOverrides.get(section.id)
          return override === undefined ? section.defaultOpen === true : override
        },
        [groupOverrides],
      )
      const flatRows = useMemo(
        () => sections.filter(isOpen).flatMap(section => section.rows),
        [isOpen, sections],
      )
      // Rows that exist regardless of collapse state. "Nothing to show" has to be
      // decided on this, or a list whose provider groups the user closed would
      // claim the catalog is empty.
      const totalRows = useMemo(
        () => sections.reduce((sum, section) => sum + section.rows.length, 0),
        [sections],
      )
      // Indexed by row instance, not by model key: a duplicate model in two
      // sections would otherwise collapse to whichever row rendered last.
      const indexOfRow = useMemo(() => {
        const map = new Map()
        flatRows.forEach((row, at) => map.set(row.instance, at))
        return map
      }, [flatRows])

      // Preview defaults to the current model, else the first row.
      useEffect(() => {
        if (previewKey !== null && byKey.has(previewKey)) return
        const own = current === null ? undefined : modelKey(current.provider, current.model)
        const fallback = own !== undefined && byKey.has(own) ? own : flatRows[0]?.key ?? null
        setPreviewKey(fallback)
      }, [byKey, current, flatRows, previewKey])

      const preview = useMemo(() => (previewKey === null ? null : rowOf(previewKey)), [previewKey, rowOf])

      // Effort follows the previewed model: its own current level, else its default.
      useEffect(() => {
        if (preview === null) {
          setEffort(undefined)
          return
        }
        if (current !== null && current.provider === preview.provider && current.model === preview.model.id && current.reasoningEffort !== undefined) {
          setEffort(current.reasoningEffort)
          return
        }
        setEffort(preview.model.reasoning?.defaultEffort)
      }, [current, preview])

      // Keep the highlighted row inside the list viewport. The ref is looked up by
      // the row actually at `activeIndex`, so hovering a favorite scrolls to that
      // favorite row rather than to its copy inside the provider group.
      useEffect(() => {
        const instance = flatRows[activeIndex]?.instance
        if (instance === undefined) return
        rowRefs.current.get(instance)?.scrollIntoView?.({ block: 'nearest' })
      }, [activeIndex, flatRows])

      const onQueryChange = value => {
        setQuery(value)
        setActiveIndex(0)
      }

      const toggleFavorite = useCallback(key => {
        const on = favorites.includes(key)
        setFavorites(list => (on ? list.filter(entry => entry !== key) : [key, ...list]))
        request('/prefs', { method: 'POST', body: { key, action: on ? 'favorite-off' : 'favorite' } }).catch(() => {})
      }, [favorites])

      const apply = useCallback(async (row, effortId) => {
        if (row === null || busy) return
        const sameModel = current !== null && current.provider === row.provider && current.model === row.model.id
        const sameEffort = effortId === undefined || effortId === current?.reasoningEffort
        if (sameModel && sameEffort) {
          onClose()
          return
        }
        setBusy(true)
        setError(null)
        try {
          const selection = { provider: row.provider, model: row.model.id }
          if (effortId !== undefined) selection.reasoningEffort = effortId
          const result = await select(selection)
          if (result !== undefined && result !== null && result.ok === false) {
            const code = result.error?.code
            setError(code === 'session/writer-held'
              ? t('error.sessionInUse')
              : t('error.select', { message: `${code ?? ''}${result.error?.message ? `: ${result.error.message}` : ''}` }))
            setBusy(false)
            return
          }
          request('/prefs', { method: 'POST', body: { key: row.key, action: 'recent' } })
            .then(payload => { if (Array.isArray(payload?.recents)) setRecents(payload.recents) })
            .catch(() => {})
          setBusy(false)
          onClose()
        } catch (failure) {
          setError(t('error.select', { message: failure instanceof Error ? failure.message : String(failure) }))
          setBusy(false)
        }
      }, [busy, current, onClose, select, t])

      const setAsDefault = useCallback(async () => {
        if (preview === null || busy) return
        setBusy(true)
        setError(null)
        try {
          const body = { provider: preview.provider, model: preview.model.id }
          if (effort !== undefined) body.reasoningEffort = effort
          await request('/default', { method: 'POST', body })
          setDefaultSelection(body)
        } catch (failure) {
          setError(t('error.default', { message: failure instanceof Error ? failure.message : String(failure) }))
        }
        setBusy(false)
      }, [busy, effort, preview, t])

      // Escape is handled on the document (the dialog is a portal), so this only
      // owns the list's cursor keys.
      const onKeyDown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          if (flatRows.length === 0) return
          event.preventDefault()
          const delta = event.key === 'ArrowDown' ? 1 : -1
          const next = (activeIndex + delta + flatRows.length) % flatRows.length
          setActiveIndex(next)
          setPreviewKey(flatRows[next].key)
          return
        }
        if (event.key === 'Enter') {
          const row = flatRows[activeIndex]
          if (row === undefined) return
          event.preventDefault()
          apply(row, effort)
        }
      }

      const status = state.status
      const loading = status === 'loading' && totalRows === 0

      const head = preview === null ? null : (() => {
        const cost = preview.meta?.cost ?? null
        const modalities = preview.meta?.inputModalities ?? []
        const isCurrent = current !== null && current.provider === preview.provider && current.model === preview.model.id
        const isDefault = defaultSelection !== null
          && defaultSelection.provider === preview.provider
          && defaultSelection.model === preview.model.id
        const efforts = preview.model.reasoning?.efforts ?? []
        const effortLabel = efforts.find(entry => entry.id === effort)?.name
        const context = preview.meta?.contextWindow
        const maxOutput = preview.meta?.maxTokens
        return h(Fragment, null,
          h('div', { className: 'mp-detailHead' },
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', { className: 'mp-detailName' },
                labelOf({ id: preview.provider, name: preview.providerName }, preview.model, 'menu', isCurrent)),
              h('div', { className: 'mp-detailMeta' }, `${preview.providerName} · ${preview.provider}`),
            ),
            h('button', {
              type: 'button',
              className: 'mp-star',
              'data-on': favorites.includes(preview.key) ? '' : undefined,
              title: favorites.includes(preview.key) ? t('action.unfavorite') : t('action.favorite'),
              'aria-label': favorites.includes(preview.key) ? t('action.unfavorite') : t('action.favorite'),
              'aria-pressed': favorites.includes(preview.key),
              onClick: () => toggleFavorite(preview.key),
            }, h(IconStar, { filled: favorites.includes(preview.key) })),
          ),
          (isCurrent || isDefault) && h('div', { className: 'mp-badges' },
            isCurrent && h('span', { className: 'mp-chip', 'data-tone': 'current' }, t('badge.current')),
            isDefault && h('span', { className: 'mp-chip' }, t('badge.default')),
          ),
          // Price and capacity are separate blocks because only capacity is a
          // spec the route can actually declare. No provider surface reports a
          // price, so an amount here would have to be borrowed from another
          // vendor's catalog — which is exactly the mistake this block avoids.
          h('div', { className: 'mp-block' },
            h('div', { className: 'mp-blockTitle' }, t('detail.price')),
            cost === null
              ? h('div', { className: 'mp-hint' }, t('detail.noPrice'))
              : h('dl', { className: 'mp-grid' },
                h('dt', null, t('detail.input')),
                h('dd', null, cost.input === 0 && cost.output === 0 ? t('price.free') : `$${formatPrice(cost.input)}`),
                h('dt', null, t('detail.output')),
                h('dd', null, cost.input === 0 && cost.output === 0 ? t('price.free') : `$${formatPrice(cost.output)}`),
                cost.cacheRead > 0 && h(Fragment, null,
                  h('dt', null, t('detail.cacheRead')),
                  h('dd', null, `$${formatPrice(cost.cacheRead)}`),
                ),
                cost.cacheWrite > 0 && h(Fragment, null,
                  h('dt', null, t('detail.cacheWrite')),
                  h('dd', null, `$${formatPrice(cost.cacheWrite)}`),
                ),
              ),
          ),
          (context !== undefined || maxOutput !== undefined) && h('div', { className: 'mp-block' },
            h('div', { className: 'mp-blockTitle' }, t('detail.capacity')),
            h('dl', { className: 'mp-grid' },
              context !== undefined && h(Fragment, null,
                h('dt', null, t('detail.context')),
                h('dd', null, formatTokens(context)),
              ),
              maxOutput !== undefined && h(Fragment, null,
                h('dt', null, t('detail.maxOutput')),
                h('dd', null, formatTokens(maxOutput)),
              ),
            ),
          ),
          h('div', { className: 'mp-block' },
            h('div', { className: 'mp-blockTitle' }, t('detail.capability')),
            h('div', { className: 'mp-badges' },
              modalities.map(modality => h('span', { key: modality, className: 'mp-chip' },
                modality === 'image' ? t('detail.modality.image')
                  : modality === 'text' ? t('detail.modality.text')
                    : modality)),
              preview.meta?.reasoning !== undefined && h('span', { className: 'mp-chip' }, t('tag.reasoning')),
            ),
          ),
          efforts.length > 0 && h('div', { className: 'mp-block' },
            h('div', { className: 'mp-blockTitle' }, t('detail.reasoning')),
            h('div', { className: 'mp-efforts' },
              // A model without a declared default still lets the provider pick;
              // the extra chip makes that choice reachable again.
              preview.model.reasoning?.defaultEffort === undefined && h('button', {
                key: 'provider-default',
                type: 'button',
                className: 'mp-effort',
                'data-on': effort === undefined ? '' : undefined,
                onClick: () => setEffort(undefined),
              }, t('effort.providerDefault')),
              efforts.map(entry => h('button', {
                key: entry.id,
                type: 'button',
                className: 'mp-effort',
                'data-on': effort === entry.id ? '' : undefined,
                title: entry.description ?? entry.name,
                onClick: () => setEffort(entry.id),
              }, entry.name)),
            ),
          ),
          h('div', { className: 'mp-block' },
            h('div', { className: 'mp-blockTitle' }, t('detail.description')),
            h('div', { className: 'mp-desc' }, preview.meta?.description ?? t('detail.noDescription')),
          ),
          showTech && h('div', { className: 'mp-block' },
            h('div', { className: 'mp-blockTitle' }, t('detail.tech')),
            h('dl', { className: 'mp-grid' },
              h('dt', null, t('detail.id')),
              h('dd', null, preview.model.id),
              h('dt', null, t('detail.providerId')),
              h('dd', null, preview.provider),
            ),
          ),
          error !== null && h('div', { className: 'mp-error' }, error),
          h('div', { className: 'mp-actions' },
            h('button', {
              type: 'button',
              className: 'mp-button',
              'data-variant': 'primary',
              disabled: busy,
              onClick: () => apply(preview, effort),
            },
              busy
                ? t('status.selecting')
                : effortLabel === undefined
                  ? t('action.apply')
                  : t('action.applyEffort', { effort: effortLabel })),
            h('button', {
              type: 'button',
              className: 'mp-button',
              disabled: busy,
              onClick: setAsDefault,
            }, defaultSelection !== null
              && defaultSelection.provider === preview.provider
              && defaultSelection.model === preview.model.id
              ? t('action.defaultSaved')
              : t('action.setDefault')),
            h('button', {
              type: 'button',
              className: 'mp-button',
              'data-variant': 'ghost',
              onClick: () => setShowTech(value => !value),
            }, showTech ? t('action.hideDetails') : t('action.details')),
            h('button', {
              type: 'button',
              className: 'mp-button',
              'data-variant': 'ghost',
              onClick: () => {
                try {
                  navigator.clipboard?.writeText?.(preview.model.id)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1200)
                } catch {}
              },
            }, copied ? t('action.copied') : t('detail.id')),
          ),
        )
      })()

      return h('div', {
        className: 'mp-backdrop',
        onMouseDown: event => {
          if (event.target === event.currentTarget) onClose()
        },
      },
        h('div', {
          className: 'mp-card',
          role: 'dialog',
          'aria-modal': true,
          'aria-label': t('dialog.title'),
          onKeyDown,
        },
          h('div', { className: 'mp-header' },
            h('div', null,
              h('div', { className: 'mp-title' }, t('dialog.title')),
              h('div', { className: 'mp-subtitle' },
                status === 'selecting' ? t('status.selecting') : t('dialog.subtitle')),
            ),
            h('button', {
              type: 'button',
              className: 'mp-close',
              'aria-label': t('action.close'),
              title: t('action.close'),
              onClick: onClose,
            }, h(IconClose)),
          ),
          h('div', { className: 'mp-panes' },
            h('div', { className: 'mp-left' },
              h('div', { className: 'mp-search' },
                h(IconSearch, { className: 'mp-searchIcon' }),
                h('input', {
                  ref: searchRef,
                  className: 'mp-searchInput',
                  type: 'search',
                  value: query,
                  placeholder: t('search.placeholder'),
                  'aria-label': t('search.placeholder'),
                  onChange: event => onQueryChange(event.target.value),
                }),
                query.length > 0 && h('button', {
                  type: 'button',
                  className: 'mp-searchClear',
                  title: t('search.clear'),
                  'aria-label': t('search.clear'),
                  onClick: () => onQueryChange(''),
                }, h(IconClose, { size: 10 })),
              ),
              h('div', { className: 'mp-list', ref: listRef, role: 'listbox', 'aria-label': t('dialog.title') },
                loading && h('div', { className: 'mp-note' }, t('status.loading')),
                status === 'error' && h('div', { className: 'mp-note', 'data-kind': 'error' },
                  t('status.error'),
                  h('button', { type: 'button', className: 'mp-retry', onClick: () => load() }, t('status.retry')),
                ),
                !loading && totalRows === 0 && h('div', { className: 'mp-note' },
                  query.length > 0 ? t('search.empty') : t('status.empty')),
                sections.map(section => {
                  const collapsible = section.collapsible === true
                  const open = isOpen(section)
                  return h('div', {
                    key: section.id,
                    className: 'mp-group',
                    'data-collapsed': collapsible && !open ? '' : undefined,
                  },
                  collapsible
                    ? h('button', {
                        type: 'button',
                        className: 'mp-sectionTitle',
                        'data-toggle': '',
                        'data-open': open ? '' : undefined,
                        'aria-expanded': open,
                        title: t(open ? 'group.collapse' : 'group.expand', { group: section.title }),
                        onClick: () => toggleGroup(section.id, section.defaultOpen),
                      },
                        h(IconDisclosure, { open }),
                        section.provider != null
                          ? h(ProviderMark, { id: section.provider, name: section.title, size: 22 })
                          : h(SectionGlyph, { kind: section.id }),
                        h('span', { className: 'mp-sectionLabel' }, section.title),
                        h('span', { className: 'mp-sectionCount' }, t('group.count', { count: section.rows.length })),
                      )
                    : h('div', { className: 'mp-sectionTitle' }, section.title),
                  (section.failures ?? []).map(failure => h('div', {
                    key: `failure:${failure.id}`,
                    className: 'mp-note',
                    'data-kind': 'error',
                  }, failure.message)),
                  open && section.rows.map(row => {
                    const index = indexOfRow.get(row.instance) ?? -1
                    const selected = current !== null && current.provider === row.provider && current.model === row.model.id
                    const isFavorite = favorites.includes(row.key)
                    return h('div', {
                      key: row.instance,
                      ref: node => {
                        if (node === null) rowRefs.current.delete(row.instance)
                        else rowRefs.current.set(row.instance, node)
                      },
                      className: 'mp-row',
                      role: 'option',
                      tabIndex: -1,
                      'aria-selected': selected,
                      'data-selected': selected ? '' : undefined,
                      'data-active': index === activeIndex ? '' : undefined,
                      onMouseEnter: () => {
                        setPreviewKey(row.key)
                        setActiveIndex(index)
                      },
                      onClick: () => {
                        setPreviewKey(row.key)
                        if (index >= 0) setActiveIndex(index)
                      },
                      onDoubleClick: () => apply(row, effortFor(row)),
                    },
                      h('span', { className: 'mp-rowMain' },
                        h('span', { className: 'mp-rowName' },
                          labelOf({ id: row.provider, name: row.providerName }, row.model, 'option', selected)),
                        // The tag band is always present so every row has the same
                        // height and the name lands at the same offset; when a model
                        // declares no capabilities the band is hidden, not removed.
                        h('span', {
                          className: 'mp-rowTags',
                          'data-empty': tagsOf(row, t).length === 0 ? '' : undefined,
                        },
                          tagsOf(row, t).map(tag => h('span', {
                            key: tag.kind,
                            className: 'mp-tag',
                            'data-kind': tag.kind === 'vision' ? 'vision' : undefined,
                          }, tag.label)),
                        ),
                      ),
                      // No provider surface reports a price, so a per-row price
                      // cell would print the same "unknown" on every line. The
                      // detail pane explains why; the list stays quiet.
                      hasPrice(row.meta) && h('span', { className: 'mp-rowPrice' }, priceText(row.meta, t)),
                      h('button', {
                        type: 'button',
                        className: 'mp-star',
                        'data-on': isFavorite ? '' : undefined,
                        title: isFavorite ? t('action.unfavorite') : t('action.favorite'),
                        'aria-label': isFavorite ? t('action.unfavorite') : t('action.favorite'),
                        'aria-pressed': isFavorite,
                        onClick: event => {
                          event.stopPropagation()
                          toggleFavorite(row.key)
                        },
                      }, h(IconStar, { filled: isFavorite })),
                    )
                  }),
                  )
                }),
              ),
            ),
            h('div', { className: 'mp-right' },
              head ?? h('div', { className: 'mp-note' }, t('detail.selectHint')),
            ),
          ),
        ),
      )

      /**
       * Which effort a click on `row` should submit: the current level for the
       * model already in use, otherwise that model's own default.
       */
      function effortFor(row) {
        if (current !== null && current.provider === row.provider && current.model === row.model.id) {
          return current.reasoningEffort
        }
        const efforts = row.model.reasoning?.efforts ?? []
        if (efforts.length === 0) return undefined
        const preferred = row.model.reasoning?.defaultEffort
        if (preferred !== undefined) return preferred
        return efforts.find(entry => entry.id === effort)?.id ?? efforts[0]?.id
      }
    }

    // ── plugin ────────────────────────────────────────────────────────────────
    function apply(ctx) {
      // The supervision channel is optional surface: only wire it when present,
      // so a leaner slots service cannot turn a diagnostic into the failure.
      const watchCrashes = () => {
        if (typeof ctx.slots?.onEntryError !== 'function') return undefined
        return ctx.slots.onEntryError((key, entry, cause, info) => {
          if (key !== 'conversation.input.model') return
          report('slot-entry', { ...describeError(cause), key, priority: entry?.options?.priority, abdicated: info?.abdicated === true })
        })
      }
      ctx.effect(watchCrashes, 'model-picker: crash reporting')
      ctx.effect(() => {
        report('boot', { build: BUILD, locale: ctx.locale?.getSnapshot?.().active })
        return undefined
      }, 'model-picker: boot heartbeat')

      ctx.effect(() => ctx.locale.register(NS, { zh: DICT.zh, en: DICT.en }), 'model-picker: dictionaries')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-plugin', 'dsh-model-picker')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => style.remove()
      }, 'model-picker: styles')

      // Only shadow where the shipped seat's own service exists: without it the
      // picker has no catalog to show, and priority 0 keeps rendering.
      // `modelDirectories` methods run bound to the CALLING context, so the
      // services its resolver reaches for (sessions, remote, remote.session)
      // must be injected here too — otherwise directoryFor() throws
      // `cannot get property "remote.session" without inject` and this
      // registration is retired onto the shipped seat.
      ctx.inject(['slots', 'modelDirectories', 'sessions', 'remote', 'remote.session'], scope => {
        const models = scope.modelDirectories
        const sessions = scope.sessions
        scope.slots.inject('conversation.input.model', () => scope.slots.register({
          name: 'conversation.input.model',
          locale: NS,
          registrant: 'dsh-model-picker',
          // No `children` table: this seat's child (`…model.label`) is declared
          // by the shipped registration, and a second declaration of the same
          // child throws while that registration stays in the table.
          priority: -1,
          inject: sessionId => {
            try {
              const directory = models.directoryFor(sessionId)
              const available = sessions === undefined || sessions.subagentAddress(sessionId) === undefined
              return {
                available,
                directory: directory.store,
                load: () => {
                  if (!available) return undefined
                  return directory.load().catch(() => {})
                },
                select: selection => (available ? directory.select(selection) : Promise.resolve({ ok: false, error: { code: 'subagent/unsupported', message: 'addressed subagent sessions cannot change model' } })),
              }
            } catch (error) {
              report('inject', describeError(error))
              throw error
            }
          },
        }, ModelPickerSeat))
      })
    }

    const inject = ['slots', 'locale', 'sessions', 'remote', 'remote.session']

    return { inject, apply, name: 'model-picker' }
  },
})
