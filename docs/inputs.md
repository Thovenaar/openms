# Inputs and provenance

Original input directory: `/Users/k/Development/tensorfish/Maplestory-Client`.

Present: `Maplestory_UNPACKED.exe` (actual spelling), protected `MapleStory.exe`, original DLLs including `NameSpace.dll`, `ResMan.dll`, `Canvas.dll`, `ZLZ.dll`, `Gr2D_DX8.dll`, and WZ archives including `Map.wz`, `Character.wz`, `Base.wz`.

No original C/C++ source or original-client screenshots/capture sequences were found in the supplied original input tree. Ghidra output is decompiler evidence, **not original source**. Native original-client execution on this macOS ARM64 host has not been established.

The supplied community remake and sibling reconstructions are excluded as implementation sources. No code or format definitions are copied from them.

Ghidra installation: `/Users/k/Downloads/ghidra_12.0.4_PUBLIC`. Analysis uses separate temporary headless projects and preserves selected address-bearing reports here. Windows executables are analyzed, not executed.

Direct archive observations: `Base.wz`, `Map.wz`, and `Character.wz` begin with `PKG1`; offset 12 contains little-endian `60`; offset 60 contains bytes `ac 00`. `List.wz` has a different header and is not presumed to use the same structure. Interpretations require the accompanying Ghidra evidence and successful archive probes.
