import {
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { useData } from "vitepress";

/** Keep source readable during SSR/loading/errors; no browser dependency at build time. */
function diagramView(state, source) {
  return h(
    "figure",
    {
      class: "docs-diagram",
      "aria-label": "Flow diagram",
      "aria-busy": state.busy.value,
    },
    [
      state.svg.value
        ? h("div", { class: "docs-diagram-image", innerHTML: state.svg.value })
        : h("p", { role: "status" }, state.error.value || "Loading diagram…"),
      h("details", { open: Boolean(state.error.value) }, [
        h("summary", "Diagram source"),
        h("pre", [h("code", { class: "language-mermaid" }, source)]),
      ]),
    ],
  );
}

export default defineComponent({
  props: { source: { type: String, required: true } },
  setup(props) {
    const renderer = inject("docs-diagram-renderer");
    const { isDark } = useData();
    const state = { svg: ref(""), error: ref(""), busy: ref(true) };
    let renderedSource = null;
    let generation = 0;
    let stop = null;
    async function refresh() {
      const current = ++generation;
      state.error.value = "";
      state.busy.value = true;
      if (renderedSource !== props.source) state.svg.value = "";
      try {
        const svg = await renderer.render(props.source, isDark.value);
        if (current !== generation) return;
        state.svg.value = svg;
        renderedSource = props.source;
        state.busy.value = false;
      } catch (error) {
        if (current !== generation) return;
        state.svg.value = "";
        state.error.value = `Diagram unavailable: ${error.message}`;
        state.busy.value = false;
      }
    }
    onMounted(() => {
      stop = watch([() => props.source, isDark], refresh, { immediate: true });
    });
    onBeforeUnmount(() => {
      generation++;
      stop?.();
    });
    return () => diagramView(state, props.source);
  },
});
