/**007fe02e/007ffa84: the ordinary equipment link is pet equipment, not BtDetail. */
export function layoutPetEquipment(panel) {
  panel.petShow = panel.button("Equip/BtPetEquipShow", 102, 280, {
    label: "Show pet equipment",
    action: () => togglePetEquipment(panel),
  });
  panel.petHide = panel.button("Equip/BtPetEquipHide", 102, 280, {
    label: "Hide pet equipment",
    action: () => togglePetEquipment(panel),
  });
  panel.petHide.setVisible(false);
}

function togglePetEquipment(panel) {
  if (panel.petEquipment) {
    panel.petEquipment.destroy();
    panel.petEquipment = null;
  } else {
    const child = panel.layer("Pet equipment");
    child.width = 177;
    child.height = 181;
    child.element.style.width = "177px";
    child.element.style.height = "181px";
    child.element.dataset.petEquipment = "true";
    child.position(panel.width - 3, 123);
    child.image("Equip/pet", 0, 0);
    child.hit(
      "Pet equipment",
      { x: 0, y: 0, width: 177, height: 181 },
      {},
      {
        tooltip:
          "Pet equipment requires an active owned pet and its original pet-instance lifecycle. No pet is active in this local character.",
      },
    );
    panel.petEquipment = child;
  }
  panel.petShow.setVisible(!panel.petEquipment);
  panel.petHide.setVisible(Boolean(panel.petEquipment));
  panel.owner.positionWindow(panel, panel.x, panel.y);
}
