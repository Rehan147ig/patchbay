import { defineConnector } from "../sdk";

/**
 * Vue / Nuxt connector.
 *
 * Vue 3 + Nuxt 3 breaking changes:
 * - Vue 2 options API -> Vue 3 composition API; `Vue.extend`, filters,
 *   and `$on`/`$off` removed.
 * - Nuxt 2 -> Nuxt 3: `@nuxtjs/*` modules restructured, `asyncData`
 *   -> `useAsyncData`, config (nuxt.config.js keys changed).
 * - `v-model` on components changed (modelValue).
 */
export const vueConnector = defineConnector({
  slug: "vue",
  identifiers: ["vue", "nuxt", "@vue/*", "@nuxt/*"],
  rules: [
    {
      changeType: "METHOD_REMOVED",
      oldValue: "Vue.extend / filters",
      newValue: "composition API",
      description:
        "Vue 3 removed Vue.extend, filters, and $on/$off; use composition API (setup, defineComponent).",
      affectedSymbols: ["Vue.extend", "Vue.filter", "$on", "$off", "v-model"],
      breaking: true,
      evidence: { sdk: "vue" },
    },
    {
      changeType: "METHOD_RENAMED",
      oldValue: "asyncData",
      newValue: "useAsyncData / useFetch",
      description: "Nuxt 3 replaced asyncData/fetch with useAsyncData/useFetch composables.",
      affectedSymbols: ["asyncData", "fetch", "useAsyncData", "useFetch"],
      breaking: true,
      evidence: { sdk: "nuxt" },
    },
    {
      changeType: "PARAMETER_REMOVED",
      oldValue: "v-model on components",
      description: "Component v-model changed to modelValue + update:modelValue in Vue 3.",
      affectedSymbols: ["v-model"],
      breaking: true,
      evidence: { sdk: "vue" },
    },
  ],
  patchSuggestions: {
    "Vue.extend": {
      replacement: "defineComponent",
      description: "Replace Vue.extend({...}) with defineComponent({...}) (Vue 3).",
      confidence: 88,
    },
    asyncData: {
      replacement: "useAsyncData",
      description: "Replace Nuxt asyncData with useAsyncData (or useFetch) composables.",
      confidence: 85,
    },
  },
});
