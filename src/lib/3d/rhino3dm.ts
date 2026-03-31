let rhinoModulePromise: Promise<unknown> | null = null;

export async function loadRhino3dmModule() {
  rhinoModulePromise ??= import(
    "three/examples/jsm/libs/rhino3dm/rhino3dm.module.js"
  ).then((mod) => mod.default());

  return rhinoModulePromise;
}

export async function loadRhino3dmLoaderAssets() {
  const [{ Rhino3dmLoader }, rhino3dm] = await Promise.all([
    import("three/examples/jsm/loaders/3DMLoader.js"),
    loadRhino3dmModule(),
  ]);

  return {
    Rhino3dmLoader,
    rhino3dm,
  };
}
