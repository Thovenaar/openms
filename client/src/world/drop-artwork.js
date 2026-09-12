/** Original 00506bfe: <50, <100, <1000, then meso bag. */
export function currencyVariant(quantity) {
  if (quantity < 50) return 0;
  if (quantity < 100) return 1;
  return quantity < 1000 ? 2 : 3;
}

/** Variant is an authoritative appearance, independent of local drop ownership. */
export function currencyEntity(resource, artwork, variant) {
  const frames = [];
  for (const record of artwork.variants[variant]) {
    const entity = resource.manifest.entities.find(
      (entry) => entry.id === record.path,
    );
    if (!entity) throw new Error("Missing immutable currency frame");
    frames.push({
      delay: record.delay,
      parts: entity.actions.default[0].parts,
    });
  }
  return { ...resource.manifest.entities[0], actions: { default: frames } };
}

export function itemEntity(resource, template) {
  const path = template.iconRawPath ?? template.iconPath;
  const entity = resource.manifest.entities.find((entry) => entry.id === path);
  if (!entity) throw new Error("Missing immutable dropped-item icon");
  return entity;
}

/** Native canvas center,00506054..00506090; returns the packet-Y correction. */
export function centerDrop(entity) {
  const geometry = entity.current.geometry[entity.frame];
  const halfHeight = Math.trunc(geometry.height / 2);
  entity.container.pivot.set(
    geometry.x + Math.trunc(geometry.width / 2),
    geometry.y + halfHeight,
  );
  return halfHeight;
}
