import { element, field, number, button, section } from "./dom.js";

/** Frame rectangles reference exact uploaded PNG bytes; no resampling or file rewriting. */
export function spriteEditor(api, document, { changed, run, palette }) {
  const value = document.definition;
  const box = element("div");
  const file = element("input", {
    type: "file",
    accept: "image/png",
    "aria-label": "Upload sprite PNG",
    onchange: () =>
      run(async () => {
        const image = file.files[0];
        if (!image) return;
        if (image.size > 4 * 1024 * 1024) {
          throw new Error("PNG uploads are limited to 4 MiB.");
        }
        const uploaded = await api.upload(image);
        const frame = wholeImageFrame(uploaded);
        let actions = { stand: [frame] };
        if (document.kind === "mob") {
          const base = await api.resolve(value.base);
          actions = Object.fromEntries(
            Object.keys(base.template.actions).map((name) => [
              name,
              [structuredClone(frame)],
            ]),
          );
        }
        const appearance = { source: "upload", assetId: uploaded.id, actions };
        if (document.kind === "mob") value.appearance = appearance;
        palette({ appearance, name: image.name });
        drawFrames(box, appearance, () => {
          changed();
          palette({ appearance, name: image.name });
        });
        changed();
      }),
  });
  if (value.appearance?.source === "upload") {
    drawFrames(box, value.appearance, changed);
  }
  return section(
    "Custom sprite sheet",
    [
      field("PNG image", file, "Exact PNG bytes · up to 2048 × 2048 · 4 MiB"),
      box,
    ],
    document.kind === "mob"
      ? "Every action needs frame timing and a collision body. Bases with attack animations cannot replace artwork yet."
      : "Upload artwork, then use the Decoration tool to place it.",
  );
}

function wholeImageFrame({ width, height }) {
  return {
    x: 0,
    y: 0,
    width,
    height,
    originX: Math.floor(width / 2),
    originY: height,
    delay: 120,
    body: {
      left: -Math.floor(width / 2),
      top: -height,
      right: Math.max(1, Math.ceil(width / 2)),
      bottom: 0,
    },
  };
}

function drawFrames(box, appearance, changed) {
  box.replaceChildren(
    element("p", {
      class: "hint",
      text: `Uploaded image · ${appearance.assetId.slice(0, 12)}`,
    }),
  );
  for (const [name, frames] of Object.entries(appearance.actions)) {
    const rows = element("div", { class: "frame-list" });
    const repaint = () => {
      rows.replaceChildren(
        ...frames.map((frame, index) =>
          frameRow(
            frame,
            index,
            () => {
              frames.splice(index, 1);
              repaint();
              changed();
            },
            changed,
          ),
        ),
      );
    };
    repaint();
    box.append(
      element("details", {}, [
        element("summary", { text: `${name} · frames` }),
        rows,
        button("Add frame", () => {
          if (frames.length >= 128) {
            throw new Error("Use at most 128 frames per action in Studio.");
          }
          frames.push(
            structuredClone(
              frames.at(-1) ?? {
                x: 0,
                y: 0,
                width: 1,
                height: 1,
                originX: 0,
                originY: 1,
                delay: 120,
              },
            ),
          );
          repaint();
          changed();
        }),
      ]),
    );
  }
}

function frameRow(frame, index, remove, changed) {
  const controls = [element("strong", { text: `Frame ${index + 1}` })];
  for (const [key, label] of [
    ["x", "Sheet X"],
    ["y", "Sheet Y"],
    ["width", "Width"],
    ["height", "Height"],
    ["originX", "Origin X"],
    ["originY", "Origin Y"],
    ["delay", "Delay (ms)"],
  ]) {
    controls.push(
      field(
        label,
        number(frame[key], (value) => {
          frame[key] = value;
          changed();
        }),
      ),
    );
  }
  if (frame.body) {
    for (const side of ["left", "top", "right", "bottom"]) {
      controls.push(
        field(
          `Body ${side}`,
          number(frame.body[side], (value) => {
            frame.body[side] = value;
            changed();
          }),
        ),
      );
    }
  }
  controls.push(button("Remove frame", remove, "danger"));
  return element("div", { class: "frame-row" }, controls);
}
