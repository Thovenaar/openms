/** Original IMG inventory, independent of the extraction recipe and generated catalog.
 * Numeric children are IDs/frames rather than property names; their types are still counted.
 */
export function inspectProperty(node, path, context) {
  const { counts, imagePath } = context;
  counts.nodeTypes[node.type] = (counts.nodeTypes[node.type] ?? 0) + 1;
  if (!node.name || /^\d+$/.test(node.name)) return;
  const properties = counts.properties;
  let entry = properties[node.name];
  if (!entry) {
    if (++counts.propertyNames > 65536) {
      throw new Error(
        "Original property-name inventory exceeds65536 per archive",
      );
    }
    entry = properties[node.name] = { count: 0, types: {}, examples: [] };
  }
  entry.count++;
  entry.types[node.type] = (entry.types[node.type] ?? 0) + 1;
  if (entry.examples.length < 3) entry.examples.push(`${imagePath}/${path}`);
}

export function propertyInventory(counts) {
  counts.imagesInventory = [];
  counts.nodeTypes = Object.create(null);
  counts.properties = Object.create(null);
  counts.propertyNames = 0;
}
